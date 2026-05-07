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
  buildFunctionResponsePart: (name: string, response: unknown) => ({ functionResponse: { name, response } }),
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

  it('calls undo and returns error when sendGeminiMessage throws', async () => {
    const { undo } = await import('../../src/stores/historyStore');
    mockSend.mockRejectedValueOnce(new Error('network timeout'));

    const result = await runAgentLoop('test', 'test-key', () => {});
    expect(undo).toHaveBeenCalled();
    expect(result.error).toContain('network timeout');
  });
});
