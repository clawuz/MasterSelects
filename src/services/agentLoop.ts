import { Logger } from './logger';
import { captureSnapshot, undo } from '../stores/historyStore';
import { buildContext } from './contextBuilder';
import { sendGeminiMessage, buildFunctionResponsePart } from './geminiService';
import { executeAITool, AI_TOOLS } from './aiTools';
import type { GeminiMessage } from './geminiService';

const log = Logger.create('AgentLoop');
const MAX_STEPS = 20;

const SYSTEM_PROMPT = `You are an AI video editing assistant with full access to the timeline and media library.
You can edit existing clips, create new tracks, add effects and transitions, place media library items on the timeline, and build entire videos from scratch.

CURRENT PROJECT STATE:
{{CONTEXT}}

RULES:
1. Use executeBatch when performing multiple edits — it creates one undo point and is faster.
2. Time values are always in seconds.
3. Media library items have IDs you can use with addVideoClip, addAudioClip, addImageClip tools.
4. After all tool calls are done, give a short human-readable summary of what you did.
5. If a tool call fails, stop and report the error — do not try to work around it.`;

export interface AgentResult {
  text: string;
  stepsUsed: number;
  error?: string;
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
      const responseParts = [];
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
