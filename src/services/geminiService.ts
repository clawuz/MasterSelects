import { Logger } from './logger';
import type { ToolDefinition } from './aiTools/types';

const log = Logger.create('GeminiService');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export interface GeminiToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiParsedResponse {
  text: string;
  toolCalls: GeminiToolCall[];
  rawContent: GeminiContentPart[];
}

interface GeminiContentPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
}

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export function convertToolsToGeminiFormat(tools: ToolDefinition[]): GeminiFunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

export function parseGeminiResponse(response: unknown): GeminiParsedResponse {
  const resp = response as {
    candidates?: Array<{ content?: { parts?: GeminiContentPart[] } }>;
  };
  const parts = resp?.candidates?.[0]?.content?.parts ?? [];
  const textParts = parts.filter((p): p is GeminiContentPart & { text: string } => p.text !== undefined);
  const toolCallParts = parts.filter(
    (p): p is GeminiContentPart & { functionCall: { name: string; args: Record<string, unknown> } } =>
      p.functionCall !== undefined
  );

  return {
    text: textParts.map((p) => p.text).join(''),
    toolCalls: toolCallParts.map((p) => ({
      name: p.functionCall.name,
      args: p.functionCall.args,
    })),
    rawContent: parts,
  };
}

export function buildFunctionResponsePart(name: string, response: unknown): GeminiContentPart {
  return { functionResponse: { name, response } };
}

export async function sendGeminiMessage(
  apiKey: string,
  messages: GeminiMessage[],
  tools: ToolDefinition[],
  systemPrompt: string,
): Promise<GeminiParsedResponse> {
  const functionDeclarations = convertToolsToGeminiFormat(tools);

  const systemInstruction = { parts: [{ text: systemPrompt }] };

  const body = {
    system_instruction: systemInstruction,
    contents: messages,
    tools: [{ functionDeclarations }],
    generationConfig: { temperature: 0.2 },
  };

  log.debug('Sending to Gemini', { messageCount: messages.length, toolCount: tools.length });

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error('Gemini API error', { status: response.status, body: errorText });
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    log.error('Failed to parse Gemini JSON response', error);
    throw new Error(`Gemini API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  log.debug('Gemini response received', { data });
  return parseGeminiResponse(data);
}
