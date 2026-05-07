import { describe, it, expect } from 'vitest';
import type { ApiKeyType } from '../../src/services/apiKeyManager';
import { convertToolsToGeminiFormat, parseGeminiResponse } from '../../src/services/geminiService';
import type { ToolDefinition } from '../../src/services/aiTools/types';

describe('gemini api key type', () => {
  it('includes gemini in ApiKeyType', () => {
    const key: ApiKeyType = 'gemini';
    expect(key).toBe('gemini');
  });
});

describe('convertToolsToGeminiFormat', () => {
  it('converts OpenAI tool definition to Gemini functionDeclaration', () => {
    const openAiTool: ToolDefinition = {
      type: 'function',
      function: {
        name: 'deleteClip',
        description: 'Delete a clip from the timeline',
        parameters: {
          type: 'object',
          properties: { clipId: { type: 'string', description: 'The clip ID' } },
          required: ['clipId'],
        },
      },
    };
    const result = convertToolsToGeminiFormat([openAiTool]);
    expect(result).toEqual([{
      name: 'deleteClip',
      description: 'Delete a clip from the timeline',
      parameters: {
        type: 'object',
        properties: { clipId: { type: 'string', description: 'The clip ID' } },
        required: ['clipId'],
      },
    }]);
  });
});

describe('parseGeminiResponse', () => {
  it('parses text-only response', () => {
    const response = {
      candidates: [{
        content: { parts: [{ text: 'Done.' }] },
      }],
    };
    const parsed = parseGeminiResponse(response);
    expect(parsed.text).toBe('Done.');
    expect(parsed.toolCalls).toHaveLength(0);
  });

  it('parses response with function call', () => {
    const response = {
      candidates: [{
        content: {
          parts: [
            { text: "I'll delete it." },
            { functionCall: { name: 'deleteClip', args: { clipId: 'clip_1' } } },
          ],
        },
      }],
    };
    const parsed = parseGeminiResponse(response);
    expect(parsed.text).toBe("I'll delete it.");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].name).toBe('deleteClip');
    expect(parsed.toolCalls[0].args).toEqual({ clipId: 'clip_1' });
  });
});
