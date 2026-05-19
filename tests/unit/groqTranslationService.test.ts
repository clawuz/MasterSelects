import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { translateSubtitles, TRANSLATION_LANGUAGES } from '../../src/services/groqTranslationService';

const SAMPLE_ENTRIES = [
  { start: 0, end: 2, text: 'Merhaba dünya' },
  { start: 2, end: 4, text: 'Nasılsın' },
];

describe('translateSubtitles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns translated entries preserving timing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ translations: ['Hello world', 'How are you'] }),
          },
        }],
      }),
    });

    const result = await translateSubtitles(SAMPLE_ENTRIES, 'en', 'English', 'test-key');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ start: 0, end: 2, text: 'Hello world' });
    expect(result[1]).toEqual({ start: 2, end: 4, text: 'How are you' });
  });

  it('throws when translation count mismatches', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ translations: ['Hello world'] }), // only 1, expected 2
          },
        }],
      }),
    });

    await expect(
      translateSubtitles(SAMPLE_ENTRIES, 'en', 'English', 'test-key')
    ).rejects.toThrow('Çeviri sayısı eşleşmedi');
  });

  it('throws on Groq API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      translateSubtitles(SAMPLE_ENTRIES, 'en', 'English', 'bad-key')
    ).rejects.toThrow('Groq hatası: Unauthorized');
  });

  it('handles batching for large inputs', async () => {
    const manyEntries = Array.from({ length: 250 }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 1,
      text: `Cümle ${i}`,
    }));

    // Two batches: 200 + 50
    const batch1 = Array.from({ length: 200 }, (_, i) => `Sentence ${i}`);
    const batch2 = Array.from({ length: 50 }, (_, i) => `Sentence ${200 + i}`);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ translations: batch1 }) } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ translations: batch2 }) } }],
        }),
      });

    const result = await translateSubtitles(manyEntries, 'en', 'English', 'test-key');

    expect(result).toHaveLength(250);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result[0].text).toBe('Sentence 0');
    expect(result[249].text).toBe('Sentence 249');
    // Timing must be preserved
    expect(result[0].start).toBe(0);
    expect(result[249].start).toBe(498);
  });

  it('TRANSLATION_LANGUAGES includes Turkish and English', () => {
    const codes = TRANSLATION_LANGUAGES.map(l => l.code);
    expect(codes).toContain('tr');
    expect(codes).toContain('en');
  });
});
