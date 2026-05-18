# Gemini Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AIChatPanel's OpenAI/Lemonade provider system with a Gemini-only agentic chat that can automatically apply multi-step timeline edits and create videos from scratch via natural language commands.

**Architecture:** A new `agentLoop.ts` orchestrates the edit session: it snapshots history for undo, builds a JSON context of the timeline + media library via `contextBuilder.ts`, sends to Gemini 2.0 Flash via `geminiService.ts`, then dispatches returned function calls through the existing `executeAITool()` entry point in a loop until Gemini stops calling tools.

**Tech Stack:** TypeScript, React, Zustand, Gemini REST API (`generativelanguage.googleapis.com`), existing `aiTools/` infrastructure (76 tools, OpenAI function-calling format → converted to Gemini schema inside `geminiService`)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/services/apiKeyManager.ts` | Add `'gemini'` key type |
| Modify | `src/stores/settingsStore.ts` | Add `gemini` field to `APIKeys` |
| Create | `src/services/geminiService.ts` | Gemini REST client + OpenAI→Gemini schema conversion |
| Create | `src/services/contextBuilder.ts` | Serialize timeline + media library to JSON context string |
| Create | `src/services/agentLoop.ts` | Multi-step tool-call loop with progress callbacks |
| Modify | `src/components/panels/AIChatPanel.tsx` | Replace all providers with Gemini; wire agentLoop; show progress |
| Create | `tests/unit/geminiService.test.ts` | Unit tests for schema conversion + response parsing |
| Create | `tests/unit/contextBuilder.test.ts` | Unit tests for context serialization |
| Create | `tests/unit/agentLoop.test.ts` | Unit tests for loop termination + error rollback |

---

## Task 1: Add Gemini API key type

**Files:**
- Modify: `src/services/apiKeyManager.ts:14-27`
- Modify: `src/stores/settingsStore.ts:58-68`
- Test: `tests/unit/geminiService.test.ts` (created here for the type check)

- [ ] **Step 1: Add `gemini` to `ApiKeyType` union and `KEY_IDS` map in `apiKeyManager.ts`**

In `src/services/apiKeyManager.ts`, change:
```typescript
export type ApiKeyType = 'openai' | 'assemblyai' | 'deepgram' | 'piapi' | 'kieai' | 'youtube' | 'klingAccessKey' | 'klingSecretKey';

const KEY_IDS: Record<ApiKeyType, string> = {
  openai: 'openai-api-key',
  assemblyai: 'assemblyai-api-key',
  deepgram: 'deepgram-api-key',
  piapi: 'piapi-api-key',
  kieai: 'kieai-api-key',
  youtube: 'youtube-api-key',
  klingAccessKey: 'kling-access-key',
  klingSecretKey: 'kling-secret-key',
};
```
to:
```typescript
export type ApiKeyType = 'openai' | 'assemblyai' | 'deepgram' | 'piapi' | 'kieai' | 'youtube' | 'klingAccessKey' | 'klingSecretKey' | 'gemini';

const KEY_IDS: Record<ApiKeyType, string> = {
  openai: 'openai-api-key',
  assemblyai: 'assemblyai-api-key',
  deepgram: 'deepgram-api-key',
  piapi: 'piapi-api-key',
  kieai: 'kieai-api-key',
  youtube: 'youtube-api-key',
  klingAccessKey: 'kling-access-key',
  klingSecretKey: 'kling-secret-key',
  gemini: 'gemini-api-key',
};
```

Also update `getAllKeys()` default object to include `gemini: ''`.

- [ ] **Step 2: Add `gemini` field to `APIKeys` interface and initial state in `settingsStore.ts`**

In `src/stores/settingsStore.ts`, change `APIKeys` interface:
```typescript
interface APIKeys {
  openai: string;
  assemblyai: string;
  deepgram: string;
  piapi: string;
  kieai: string;
  youtube: string;
  klingAccessKey: string;
  klingSecretKey: string;
  gemini: string;
}
```

In the initial state (around line 221), add `gemini: ''` to `apiKeys`:
```typescript
apiKeys: {
  openai: '',
  assemblyai: '',
  deepgram: '',
  piapi: '',
  kieai: '',
  youtube: '',
  klingAccessKey: '',
  klingSecretKey: '',
  gemini: '',
},
```

Also update the `loadApiKeys` restored keys object (around line 276) to include `gemini: ''`.

- [ ] **Step 3: Write the type test**

Create `tests/unit/geminiService.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { ApiKeyType } from '../../src/services/apiKeyManager';

describe('gemini api key type', () => {
  it('includes gemini in ApiKeyType', () => {
    const key: ApiKeyType = 'gemini';
    expect(key).toBe('gemini');
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- tests/unit/geminiService.test.ts
```
Expected: PASS

- [ ] **Step 5: Build check**

```bash
npm run build
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/apiKeyManager.ts src/stores/settingsStore.ts tests/unit/geminiService.test.ts
git commit -m "feat: add gemini api key type to apiKeyManager and settingsStore"
```

---

## Task 2: GeminiService

**Files:**
- Create: `src/services/geminiService.ts`
- Modify: `tests/unit/geminiService.test.ts`

The Gemini REST API uses a different schema than OpenAI. This service converts OpenAI-format tool definitions to Gemini's `functionDeclarations` format and parses Gemini responses back into a normalized shape.

Gemini request format:
```json
{
  "contents": [...],
  "tools": [{ "functionDeclarations": [...] }],
  "generationConfig": { "temperature": 0.2 }
}
```

Gemini response format:
```json
{
  "candidates": [{
    "content": {
      "parts": [
        { "text": "I'll delete that clip." },
        { "functionCall": { "name": "deleteClip", "args": { "clipId": "clip_1" } } }
      ]
    }
  }]
}
```

- [ ] **Step 1: Write failing tests for schema conversion**

Add to `tests/unit/geminiService.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test -- tests/unit/geminiService.test.ts
```
Expected: FAIL — `convertToolsToGeminiFormat` and `parseGeminiResponse` not found

- [ ] **Step 3: Create `src/services/geminiService.ts`**

```typescript
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
  const textParts = parts.filter((p) => p.text !== undefined);
  const toolCallParts = parts.filter((p) => p.functionCall !== undefined);

  return {
    text: textParts.map((p) => p.text ?? '').join(''),
    toolCalls: toolCallParts.map((p) => ({
      name: p.functionCall!.name,
      args: p.functionCall!.args,
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

  const data = await response.json();
  log.debug('Gemini response received', { data });
  return parseGeminiResponse(data);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test -- tests/unit/geminiService.test.ts
```
Expected: PASS

- [ ] **Step 5: Build check**

```bash
npm run build
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/geminiService.ts tests/unit/geminiService.test.ts
git commit -m "feat: add GeminiService with OpenAI→Gemini schema conversion"
```

---

## Task 3: ContextBuilder

**Files:**
- Create: `src/services/contextBuilder.ts`
- Create: `tests/unit/contextBuilder.test.ts`

The context builder serializes the current editor state into a JSON string that Gemini receives as part of the system prompt. It reads from `useTimelineStore` and `useMediaStore`.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/contextBuilder.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildContext } from '../../src/services/contextBuilder';

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({
      tracks: [{ id: 'track_1', name: 'Main', type: 'video', visible: true, muted: false }],
      clips: [{
        id: 'clip_1', trackId: 'track_1', name: 'intro.mp4',
        startTime: 0, duration: 10, inPoint: 0,
        transcriptStatus: 'ready',
        transcript: [{ word: 'Hello', start: 0.1, end: 0.5 }],
      }],
      playheadPosition: 2.5,
      duration: 10,
    }),
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({
      files: [
        { id: 'media_1', name: 'intro.mp4', type: 'video', duration: 30 },
        { id: 'media_2', name: 'logo.png', type: 'image' },
      ],
    }),
  },
}));

describe('buildContext', () => {
  it('includes timeline track and clip info', () => {
    const ctx = buildContext();
    const parsed = JSON.parse(ctx);
    expect(parsed.timeline.tracks).toHaveLength(1);
    expect(parsed.timeline.tracks[0].clips[0].id).toBe('clip_1');
  });

  it('includes media library files', () => {
    const ctx = buildContext();
    const parsed = JSON.parse(ctx);
    expect(parsed.mediaLibrary).toHaveLength(2);
    expect(parsed.mediaLibrary[0].name).toBe('intro.mp4');
  });

  it('truncates long transcripts to 500 chars', () => {
    const ctx = buildContext();
    const parsed = JSON.parse(ctx);
    const clip = parsed.timeline.tracks[0].clips[0];
    expect(typeof clip.transcript).toBe('string');
    expect(clip.transcript.length).toBeLessThanOrEqual(500);
  });

  it('includes playhead position and total duration', () => {
    const ctx = buildContext();
    const parsed = JSON.parse(ctx);
    expect(parsed.timeline.playheadPosition).toBe(2.5);
    expect(parsed.timeline.duration).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test -- tests/unit/contextBuilder.test.ts
```
Expected: FAIL — `buildContext` not found

- [ ] **Step 3: Create `src/services/contextBuilder.ts`**

```typescript
import { useTimelineStore } from '../stores/timeline';
import { useMediaStore } from '../stores/mediaStore';

const MAX_TRANSCRIPT_CHARS = 500;
const MAX_MEDIA_ITEMS = 200;

interface ContextClip {
  id: string;
  name: string;
  trackId: string;
  startTime: number;
  endTime: number;
  duration: number;
  inPoint: number;
  hasTranscript: boolean;
  transcript?: string;
}

interface ContextTrack {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  muted: boolean;
  clips: ContextClip[];
}

interface ContextMediaItem {
  id: string;
  name: string;
  type: string;
  duration?: number;
}

interface Context {
  timeline: {
    playheadPosition: number;
    duration: number;
    tracks: ContextTrack[];
  };
  mediaLibrary: ContextMediaItem[];
}

function buildTranscriptText(clip: { transcript?: Array<{ word: string }> }): string | undefined {
  if (!clip.transcript?.length) return undefined;
  const full = clip.transcript.map((w) => w.word).join(' ');
  return full.length > MAX_TRANSCRIPT_CHARS ? full.slice(0, MAX_TRANSCRIPT_CHARS) + '…' : full;
}

export function buildContext(): string {
  const timeline = useTimelineStore.getState();
  const media = useMediaStore.getState();

  const tracks: ContextTrack[] = timeline.tracks.map((track) => {
    const trackClips = timeline.clips.filter((c) => c.trackId === track.id);
    return {
      id: track.id,
      name: track.name,
      type: track.type,
      visible: track.visible,
      muted: track.muted,
      clips: trackClips.map((clip) => {
        const hasTranscript =
          clip.transcriptStatus === 'ready' || (clip.transcript?.length ?? 0) > 0;
        const contextClip: ContextClip = {
          id: clip.id,
          name: clip.name,
          trackId: clip.trackId,
          startTime: clip.startTime,
          endTime: clip.startTime + clip.duration,
          duration: clip.duration,
          inPoint: clip.inPoint ?? 0,
          hasTranscript,
        };
        if (hasTranscript) {
          contextClip.transcript = buildTranscriptText(clip);
        }
        return contextClip;
      }),
    };
  });

  const mediaLibrary: ContextMediaItem[] = media.files
    .slice(0, MAX_MEDIA_ITEMS)
    .map((file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      ...(file.duration !== undefined && { duration: file.duration }),
    }));

  const context: Context = {
    timeline: {
      playheadPosition: timeline.playheadPosition,
      duration: timeline.duration,
      tracks,
    },
    mediaLibrary,
  };

  return JSON.stringify(context);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test -- tests/unit/contextBuilder.test.ts
```
Expected: PASS

- [ ] **Step 5: Build check**

```bash
npm run build
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/contextBuilder.ts tests/unit/contextBuilder.test.ts
git commit -m "feat: add contextBuilder — serialize timeline + media library for Gemini"
```

---

## Task 4: AgentLoop

**Files:**
- Create: `src/services/agentLoop.ts`
- Create: `tests/unit/agentLoop.test.ts`

The agent loop is the orchestrator. It:
1. Calls `captureSnapshot` before starting (undo checkpoint)
2. Builds context and sends the user message to Gemini
3. If Gemini returns tool calls, dispatches them via `executeAITool` and feeds results back
4. Repeats until no tool calls or max steps reached
5. On error, calls `undo()` to roll back all changes

- [ ] **Step 1: Write failing tests**

Create `tests/unit/agentLoop.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop } from '../../src/services/agentLoop';

vi.mock('../../src/stores/historyStore', () => ({
  captureSnapshot: vi.fn(),
  undo: vi.fn(),
}));

vi.mock('../../src/services/contextBuilder', () => ({
  buildContext: () => JSON.stringify({ timeline: { tracks: [], clips: [], playheadPosition: 0, duration: 0 }, mediaLibrary: [] }),
}));

vi.mock('../../src/services/aiTools', () => ({
  AI_TOOLS: [],
  executeAITool: vi.fn().mockResolvedValue({ success: true, data: 'ok' }),
}));

const mockSend = vi.fn();
vi.mock('../../src/services/geminiService', () => ({
  sendGeminiMessage: (...args: unknown[]) => mockSend(...args),
}));

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns text response when no tool calls', async () => {
    mockSend.mockResolvedValueOnce({ text: 'Done!', toolCalls: [], rawContent: [] });
    const progress: string[] = [];
    const result = await runAgentLoop('hello', 'test-key', (msg) => progress.push(msg));
    expect(result.text).toBe('Done!');
    expect(result.error).toBeUndefined();
  });

  it('dispatches tool calls and loops until no more calls', async () => {
    const { executeAITool } = await import('../../src/services/aiTools');
    mockSend
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'deleteClip', args: { clipId: 'clip_1' } }],
        rawContent: [],
      })
      .mockResolvedValueOnce({ text: 'Deleted.', toolCalls: [], rawContent: [] });

    const result = await runAgentLoop('delete clip_1', 'test-key', () => {});
    expect(executeAITool).toHaveBeenCalledWith('deleteClip', { clipId: 'clip_1' }, 'chat');
    expect(result.text).toBe('Deleted.');
  });

  it('calls undo and returns error when tool call fails', async () => {
    const { executeAITool } = await import('../../src/services/aiTools');
    const { undo } = await import('../../src/stores/historyStore');
    (executeAITool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: 'clip not found',
    });
    mockSend.mockResolvedValueOnce({
      text: '',
      toolCalls: [{ name: 'deleteClip', args: { clipId: 'bad_id' } }],
      rawContent: [],
    });

    const result = await runAgentLoop('delete bad', 'test-key', () => {});
    expect(undo).toHaveBeenCalled();
    expect(result.error).toContain('clip not found');
  });

  it('stops after MAX_STEPS and returns error', async () => {
    mockSend.mockResolvedValue({
      text: '',
      toolCalls: [{ name: 'deleteClip', args: { clipId: 'clip_1' } }],
      rawContent: [],
    });
    const { executeAITool } = await import('../../src/services/aiTools');
    (executeAITool as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    const result = await runAgentLoop('loop forever', 'test-key', () => {});
    expect(result.error).toContain('maksimum');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test -- tests/unit/agentLoop.test.ts
```
Expected: FAIL — `runAgentLoop` not found

- [ ] **Step 3: Create `src/services/agentLoop.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- tests/unit/agentLoop.test.ts
```
Expected: PASS

- [ ] **Step 5: Build check**

```bash
npm run build
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/agentLoop.ts tests/unit/agentLoop.test.ts
git commit -m "feat: add agentLoop — multi-step Gemini tool orchestration with undo on error"
```

---

## Task 5: Rewrite AIChatPanel for Gemini

**Files:**
- Modify: `src/components/panels/AIChatPanel.tsx`

This task replaces the entire multi-provider chat UI with a Gemini-only interface. Key changes:
- Remove all OpenAI model constants, Lemonade imports, cloud AI service
- Add Gemini API key input (reads/writes via `apiKeyManager`)
- Send messages through `runAgentLoop` instead of the existing streaming logic
- Show tool execution progress inline in chat

- [ ] **Step 1: Read the current AIChatPanel structure**

Run: `wc -l src/components/panels/AIChatPanel.tsx` to note the line count.
Then scan from line 180 downward to understand the `Message` interface and render logic before editing.

- [ ] **Step 2: Replace the component**

Replace `src/components/panels/AIChatPanel.tsx` with the following. Keep the existing `AIChatPanel.css` import and file unchanged.

```typescript
// AI Chat Panel — Gemini-powered agentic video editor

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiKeyManager } from '../../services/apiKeyManager';
import { runAgentLoop } from '../../services/agentLoop';
import './AIChatPanel.css';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'progress' | 'error';
  content: string;
  timestamp: Date;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function AIChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const progressIdRef = useRef<string | null>(null);

  useEffect(() => {
    apiKeyManager.getKeyByType('gemini').then((key) => {
      if (key) setApiKey(key);
      setApiKeyLoaded(true);
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSaveApiKey = useCallback(async (key: string) => {
    await apiKeyManager.storeKeyByType('gemini', key);
  }, []);

  const appendMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    const full: Message = { ...msg, id: generateId(), timestamp: new Date() };
    setMessages((prev) => [...prev, full]);
    return full.id;
  }, []);

  const updateMessage = useCallback((id: string, content: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content } : m))
    );
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;
    if (!apiKey) {
      appendMessage({ role: 'error', content: 'Gemini API anahtarı giriniz.' });
      return;
    }

    setInput('');
    appendMessage({ role: 'user', content: text });
    setIsRunning(true);

    const progressId = generateId();
    progressIdRef.current = progressId;
    setMessages((prev) => [
      ...prev,
      { id: progressId, role: 'progress', content: '⏳ Çalışıyor...', timestamp: new Date() },
    ]);

    const result = await runAgentLoop(text, apiKey, (progressMsg) => {
      if (progressIdRef.current) {
        updateMessage(progressIdRef.current, progressMsg);
      }
    });

    // Remove progress message
    setMessages((prev) => prev.filter((m) => m.id !== progressIdRef.current));
    progressIdRef.current = null;
    setIsRunning(false);

    if (result.error) {
      appendMessage({ role: 'error', content: result.error });
    } else {
      appendMessage({
        role: 'assistant',
        content: result.text || `✅ Tamamlandı — ${result.stepsUsed} adım uygulandı.`,
      });
    }
  }, [input, isRunning, apiKey, appendMessage, updateMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!apiKeyLoaded) return null;

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-api-key-row">
        <input
          type="password"
          className="ai-chat-api-key-input"
          placeholder="Gemini API anahtarı (Google AI Studio)"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            handleSaveApiKey(e.target.value);
          }}
        />
      </div>

      <div className="ai-chat-messages">
        {messages.length === 0 && (
          <div className="ai-chat-empty">
            <p>Bir komut yazın. Örneğin:</p>
            <ul>
              <li>"Bu klipten 60 saniyelik bir video yap"</li>
              <li>"2. dakikadaki sahneyi sil"</li>
              <li>"Tüm kesmelere crossfade ekle"</li>
              <li>"Medya kütüphanesindeki kliplerden bir tanıtım videosu oluştur"</li>
            </ul>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`ai-chat-message ai-chat-message--${msg.role}`}>
            <span className="ai-chat-message-content">{msg.content}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-chat-input-row">
        <textarea
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Komut yazın..."
          disabled={isRunning}
          rows={2}
        />
        <button
          className="ai-chat-send-btn"
          onClick={handleSend}
          disabled={isRunning || !input.trim()}
        >
          {isRunning ? '⏳' : '→'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add minimal CSS for new classes to `AIChatPanel.css`**

Append to the end of `src/components/panels/AIChatPanel.css`:
```css
.ai-chat-api-key-row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #333);
}

.ai-chat-api-key-input {
  width: 100%;
  background: var(--input-bg, #1a1a1a);
  border: 1px solid var(--border-color, #444);
  border-radius: 4px;
  color: var(--text-primary, #fff);
  font-size: 12px;
  padding: 4px 8px;
  box-sizing: border-box;
}

.ai-chat-empty {
  color: var(--text-secondary, #888);
  font-size: 13px;
  padding: 24px 16px;
}

.ai-chat-empty ul {
  margin: 8px 0 0 16px;
  line-height: 1.8;
}

.ai-chat-message--progress {
  color: var(--text-secondary, #aaa);
  font-style: italic;
  font-size: 12px;
}

.ai-chat-message--error {
  color: #ff6b6b;
}
```

- [ ] **Step 4: Build check**

```bash
npm run build
```
Expected: 0 errors (TypeScript will catch any import issues from the removed providers)

- [ ] **Step 5: Run all tests**

```bash
npm run test
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/AIChatPanel.tsx src/components/panels/AIChatPanel.css
git commit -m "feat: rewrite AIChatPanel as Gemini-only agent chat with multi-step tool execution"
```

---

## Task 6: Integration smoke test

**Files:**
- No new files — manual test against a running dev server

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open the app and navigate to AI Chat panel**

Open `http://localhost:5173` in the browser. Click the AI Chat panel tab.

- [ ] **Step 3: Enter a Gemini API key**

Get a free key from `https://aistudio.google.com/apikey`. Paste it into the key input.

- [ ] **Step 4: Test a read-only command**

Type: `Bana timeline hakkında bilgi ver`

Expected: Gemini responds with a text summary of the current timeline. No tool execution progress shown (no edits).

- [ ] **Step 5: Test a single tool command**

Import any video file. Select it on the timeline. Type: `Seçili klibi 2 eşit parçaya böl`

Expected:
- Progress message appears: `🔧 splitClipEvenly çalışıyor...`
- Timeline updates with the clip split in two
- Confirmation message appears

- [ ] **Step 6: Test undo**

Press Ctrl+Z.
Expected: The split is undone, clip returns to original state.

- [ ] **Step 7: Final commit**

```bash
git add -p  # review any stray changes
git commit -m "chore: verify Gemini agent chat integration smoke test passes"
```
