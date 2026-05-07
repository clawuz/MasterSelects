import { Logger } from './logger';
import { captureSnapshot, undo } from '../stores/historyStore';
import { buildContext } from './contextBuilder';
import { sendGeminiMessage, buildFunctionResponsePart } from './geminiService';
import { executeAITool, AI_TOOLS } from './aiTools';
import { createLemonadeChatCompletionStream, DEFAULT_LEMONADE_ENDPOINT, DEFAULT_LEMONADE_MODEL } from './lemonadeProvider';
import type { GeminiMessage, GeminiContentPart } from './geminiService';
import type { LemonadeMessage } from './lemonadeProvider';

const log = Logger.create('AgentLoop');
const MAX_STEPS = 20;

const SYSTEM_PROMPT = `You are a video editing AI. Use tools to edit the timeline. State: {{CONTEXT}}
Rules: Use executeBatch for multiple edits. Time in seconds. Reply briefly in the user's language.`;

export interface AgentResult {
  text: string;
  stepsUsed: number;
  error?: string;
}

export async function runLemonadeAgentLoop(
  userMessage: string,
  onProgress: (message: string) => void,
  endpoint: string = DEFAULT_LEMONADE_ENDPOINT,
  model: string = DEFAULT_LEMONADE_MODEL,
): Promise<AgentResult> {
  captureSnapshot('AI agent run');

  const context = buildContext();
  const systemPrompt = SYSTEM_PROMPT.replace('{{CONTEXT}}', context);

  const messages: LemonadeMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let step = 0;
  let finalText = '';

  try {
    while (step < MAX_STEPS) {
      const response = await createLemonadeChatCompletionStream({
        endpoint,
        model,
        messages,
        tools: AI_TOOLS,
      });
      step++;

      if (response.content) {
        finalText = response.content;
      }

      if (response.toolCalls.length === 0) {
        log.info(`Lemonade agent finished in ${step} step(s)`);
        return { text: finalText, stepsUsed: step };
      }

      // Append assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool call
      for (const toolCall of response.toolCalls) {
        onProgress(`🔧 ${toolCall.name} çalışıyor... (${step}/${MAX_STEPS})`);
        log.debug(`Executing tool: ${toolCall.name}`);

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
        } catch {
          // ignore parse errors, pass empty args
        }

        const result = await executeAITool(toolCall.name, args, 'chat');

        if (!result.success) {
          log.warn(`Tool ${toolCall.name} failed: ${result.error}`);
          undo();
          return {
            text: '',
            stepsUsed: step,
            error: `${toolCall.name} aracı başarısız oldu: ${result.error}. Değişiklikler geri alındı.`,
          };
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        });
      }
    }

    undo();
    return {
      text: '',
      stepsUsed: step,
      error: `Agent maksimum ${MAX_STEPS} adıma ulaştı. Değişiklikler geri alındı.`,
    };
  } catch (error) {
    log.error('Lemonade agent loop error', error);
    undo();
    return {
      text: '',
      stepsUsed: step,
      error: `Hata: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}. Değişiklikler geri alındı.`,
    };
  }
}

export async function runAgentLoop(
  userMessage: string,
  apiKey: string,
  onProgress: (message: string) => void,
): Promise<AgentResult> {
  captureSnapshot('AI agent run');

  const context = buildContext();
  const systemPrompt = SYSTEM_PROMPT.replace('{{CONTEXT}}', context);

  const messages: GeminiMessage[] = [
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  let step = 0;
  let finalText = '';

  try {
    while (step < MAX_STEPS) {
      const response = await sendGeminiMessage(apiKey, messages, AI_TOOLS, systemPrompt);
      step++;

      if (response.text) {
        finalText = response.text;
      }

      if (response.toolCalls.length === 0) {
        log.info(`Agent finished in ${step} step(s)`);
        return { text: finalText, stepsUsed: step };
      }

      // Append model message with all parts
      messages.push({ role: 'model', parts: response.rawContent });

      // Execute each tool call and collect results
      const responseParts: GeminiContentPart[] = [];
      for (const toolCall of response.toolCalls) {
        onProgress(`🔧 ${toolCall.name} çalışıyor... (${step}/${MAX_STEPS})`);
        log.debug(`Executing tool: ${toolCall.name}`, toolCall.args);

        const result = await executeAITool(toolCall.name, toolCall.args, 'chat');

        if (!result.success) {
          log.warn(`Tool ${toolCall.name} failed: ${result.error}`);
          undo();
          return {
            text: '',
            stepsUsed: step,
            error: `${toolCall.name} aracı başarısız oldu: ${result.error}. Değişiklikler geri alındı.`,
          };
        }

        responseParts.push(buildFunctionResponsePart(toolCall.name, result));
      }

      // Feed results back as a user message
      messages.push({ role: 'user', parts: responseParts });
    }

    undo();
    return {
      text: '',
      stepsUsed: step,
      error: `Agent maksimum ${MAX_STEPS} adıma ulaştı. Değişiklikler geri alındı.`,
    };
  } catch (error) {
    log.error('Agent loop error', error);
    undo();
    return {
      text: '',
      stepsUsed: step,
      error: `Hata: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}. Değişiklikler geri alındı.`,
    };
  }
}

function compactParams(params: Record<string, unknown>): Record<string, unknown> {
  const props = params.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return params;
  const stripped: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(props)) {
    const { description: _desc, ...rest } = v;
    stripped[k] = rest;
  }
  return { ...params, properties: stripped };
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

const GROQ_ESSENTIAL_TOOLS = new Set([
  'executeBatch', 'deleteClip', 'deleteClips', 'trimClip', 'splitClip',
  'splitClipAtTimes', 'moveClip', 'addVideoClip', 'addAudioClip', 'addImageClip',
  'addTextClip', 'createTrack', 'deleteTrack', 'setClipSpeed', 'setClipVolume',
  'addEffect', 'removeEffect', 'addTransition', 'removeTransition',
  'setTransform', 'setPlayhead', 'reorderClips', 'setInOutPoints',
]);

interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export async function runGroqAgentLoop(
  userMessage: string,
  apiKey: string,
  onProgress: (message: string) => void,
): Promise<AgentResult> {
  captureSnapshot('AI agent run');

  const context = buildContext();
  const systemPrompt = SYSTEM_PROMPT.replace('{{CONTEXT}}', context);

  const messages: GroqMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const tools = AI_TOOLS
    .filter((t) => GROQ_ESSENTIAL_TOOLS.has(t.function.name))
    .map((t) => ({
    type: 'function' as const,
    function: {
      name: t.function.name,
      description: t.function.description.slice(0, 60),
      parameters: compactParams(t.function.parameters),
    },
  }));

  let step = 0;
  let finalText = '';

  try {
    while (step < MAX_STEPS) {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: GROQ_MODEL, messages, tools, temperature: 0.2 }),
        });
        if (response.status === 429 || response.status === 413) {
          const errText = await response.text();
          const waitMatch = errText.match(/try again in ([\d.]+)s/);
          const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) * 1000 + 500 : 20000;
          onProgress(`⏳ Rate limit — ${Math.ceil(waitMs / 1000)}s bekleniyor...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        break;
      }
      if (!response!.ok) {
        const errorText = await response!.text();
        throw new Error(`Groq API error ${response!.status}: ${errorText}`);
      }

      const data = await response!.json() as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      step++;
      const msg = data.choices[0]?.message;
      if (!msg) break;

      if (msg.content) finalText = msg.content;

      const toolCalls = msg.tool_calls ?? [];

      if (toolCalls.length === 0) {
        log.info(`Groq agent finished in ${step} step(s)`);
        return { text: finalText, stepsUsed: step };
      }

      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const toolCall of toolCalls) {
        onProgress(`🔧 ${toolCall.function.name} çalışıyor... (${step}/${MAX_STEPS})`);
        log.debug(`Executing tool: ${toolCall.function.name}`);

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch { /* ignore */ }

        const result = await executeAITool(toolCall.function.name, args, 'chat');

        if (!result.success) {
          log.warn(`Tool ${toolCall.function.name} failed: ${result.error}`);
          undo();
          return {
            text: '',
            stepsUsed: step,
            error: `${toolCall.function.name} aracı başarısız oldu: ${result.error}. Değişiklikler geri alındı.`,
          };
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        });
      }
    }

    undo();
    return {
      text: '',
      stepsUsed: step,
      error: `Agent maksimum ${MAX_STEPS} adıma ulaştı. Değişiklikler geri alındı.`,
    };
  } catch (error) {
    log.error('Groq agent loop error', error);
    undo();
    return {
      text: '',
      stepsUsed: step,
      error: `Hata: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}. Değişiklikler geri alındı.`,
    };
  }
}
