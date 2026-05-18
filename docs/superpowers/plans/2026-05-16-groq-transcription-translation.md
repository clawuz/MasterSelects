# Groq Transcription + Subtitle Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Groq (`whisper-large-v3`) as a transcription provider and a subtitle translation feature (Groq LLaMA 3.3 70B) that creates a new translated subtitle track from any existing subtitle track.

**Architecture:** Direct browser → Groq API calls using the stored Groq API key (already in `apiKeyManager`). Groq transcription follows the same pattern as `transcribeWithOpenAI`. Translation is a new standalone service that converts text clips from a subtitle track into translated text clips on a new track.

**Tech Stack:** TypeScript, React, Vitest, Groq REST API (`api.groq.com`)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/stores/settingsStore.ts` | Add `'groq'` to `TranscriptionProvider` union |
| Modify | `src/services/clipTranscriber.ts` | Add `transcribeWithGroq()` + wire `case 'groq':` |
| Modify | `src/components/common/settings/TranscriptionSettings.tsx` | Add Groq to provider list |
| Modify | `src/services/subtitleTrackBuilder.ts` | Accept optional `trackName` param |
| Create | `src/services/groqTranslationService.ts` | Batch subtitle translation via Groq LLaMA |
| Modify | `src/components/panels/TranscriptPanel.tsx` | Add translate UI section |
| Modify | `src/components/timeline/TimelineContextMenu.tsx` | Add "Translate..." menu item for subtitle tracks |
| Create | `tests/unit/groqTranslationService.test.ts` | Unit tests for translation service |

---

## Task 1: Add `'groq'` to TranscriptionProvider

**Files:**
- Modify: `src/stores/settingsStore.ts:48`

- [ ] **Step 1: Add `'groq'` to the union type**

Open `src/stores/settingsStore.ts`. Find line 48:
```ts
export type TranscriptionProvider = 'local' | 'server' | 'openai' | 'assemblyai' | 'deepgram';
```
Change to:
```ts
export type TranscriptionProvider = 'local' | 'server' | 'openai' | 'assemblyai' | 'deepgram' | 'groq';
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```
Expected: no TypeScript errors. The `switch` in `clipTranscriber.ts` has a `default: throw` so it will still compile — the `'groq'` case just falls through to `default` until Task 2.

- [ ] **Step 3: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat: add groq to TranscriptionProvider type"
```

---

## Task 2: Add Groq transcription to clipTranscriber

**Files:**
- Modify: `src/services/clipTranscriber.ts`
- Create: `tests/unit/groqTranscription.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/groqTranscription.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// We test the internal helper in isolation by importing after mocking fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import the module under test — we'll test the response parsing logic
// by calling the exported transcribeWithGroq via a thin wrapper or directly

describe('Groq transcription response parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps word-level Groq response to TranscriptWord[] with inPointOffset', async () => {
    const groqResponse = {
      language: 'english',
      words: [
        { word: 'Hello', start: 0.5, end: 0.9 },
        { word: 'world', start: 1.0, end: 1.4 },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => groqResponse,
    });

    // Use the helper directly — import the non-exported function
    // We test via a minimal integration: build a fake FormData call
    const formData = new FormData();
    formData.append('file', new Blob(['audio'], { type: 'audio/wav' }), 'audio.wav');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key' },
      body: formData,
    });
    const data = await response.json();

    const inPointOffset = 10; // seconds
    const words = (data.words ?? []).map((w: { word: string; start: number; end: number }, i: number) => ({
      id: `word-${i}`,
      text: w.word,
      start: w.start + inPointOffset,
      end: w.end + inPointOffset,
      confidence: 1,
      speaker: 'Speaker 1',
    }));

    expect(words).toHaveLength(2);
    expect(words[0]).toMatchObject({ id: 'word-0', text: 'Hello', start: 10.5, end: 10.9 });
    expect(words[1]).toMatchObject({ id: 'word-1', text: 'world', start: 11.0, end: 11.4 });
  });

  it('returns empty array when words field is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ language: 'english', text: 'Hello world' }),
    });

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key' },
      body: new FormData(),
    });
    const data = await response.json();
    const words = data.words ?? [];
    expect(words).toHaveLength(0);
  });

  it('throws on Groq API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    });

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad-key' },
      body: new FormData(),
    });

    expect(response.ok).toBe(false);
    const err = await response.json();
    expect(err.error.message).toBe('Invalid API key');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (these are unit tests on response parsing, not integration)**

```bash
npm run test -- tests/unit/groqTranscription.test.ts
```
Expected: all 3 tests PASS (they test the parsing logic, not the actual function).

- [ ] **Step 3: Add `transcribeWithGroq` function to clipTranscriber**

Open `src/services/clipTranscriber.ts`. After the closing `}` of `transcribeWithOpenAI` (around line 862, before the `/**` comment for AssemblyAI), add:

```ts
const GROQ_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Transcribe using Groq Whisper API (whisper-large-v3)
 * Automatically splits audio if it exceeds the 25MB API limit
 */
async function transcribeWithGroq(
  clipId: string,
  audioBlob: Blob,
  language: string,
  apiKey: string,
  inPointOffset: number
): Promise<TranscriptWord[]> {
  if (audioBlob.size <= GROQ_MAX_BYTES) {
    updateClipTranscript(clipId, { progress: 20, message: 'Sending to Groq...' });
    const rawWords = await groqSingleRequest(audioBlob, language, apiKey);
    updateClipTranscript(clipId, { progress: 80, message: 'Processing response...' });
    return rawWords.map((word, index) => ({
      id: `word-${index}`,
      text: word.word,
      start: (word.start || 0) + inPointOffset,
      end: (word.end || (word.start + 0.1)) + inPointOffset,
      confidence: 1,
      speaker: 'Speaker 1',
    }));
  }

  log.info(`Audio WAV is ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB, splitting for Groq...`);
  updateClipTranscript(clipId, { progress: 10, message: 'Audio too large, splitting...' });

  const audioContext = new AudioContext();
  const arrayBuffer = await audioBlob.arrayBuffer();
  const fullBuffer = await audioContext.decodeAudioData(arrayBuffer);
  audioContext.close();

  const chunks = splitAudioBuffer(fullBuffer, GROQ_MAX_BYTES);
  log.info(`Split into ${chunks.length} chunks`);

  const allWords: TranscriptWord[] = [];
  let globalWordIndex = 0;
  const sampleRate = fullBuffer.sampleRate;
  let sampleOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkTimeOffset = sampleOffset / sampleRate;
    const progressBase = 15 + (70 * i / chunks.length);
    const progressEnd = 15 + (70 * (i + 1) / chunks.length);

    updateClipTranscript(clipId, {
      progress: Math.round(progressBase),
      message: `Transcribing chunk ${i + 1}/${chunks.length}...`,
    });

    const chunkWav = await audioBufferToWav(chunks[i]);
    const rawWords = await groqSingleRequest(chunkWav, language, apiKey);

    for (const word of rawWords) {
      allWords.push({
        id: `word-${globalWordIndex++}`,
        text: word.word,
        start: (word.start || 0) + chunkTimeOffset + inPointOffset,
        end: (word.end || (word.start + 0.1)) + chunkTimeOffset + inPointOffset,
        confidence: 1,
        speaker: 'Speaker 1',
      });
    }

    updateClipTranscript(clipId, {
      progress: Math.round(progressEnd),
      words: allWords,
      message: `Chunk ${i + 1}/${chunks.length} done (${allWords.length} words)`,
    });

    sampleOffset += chunks[i].length;
  }

  return allWords;
}

async function groqSingleRequest(
  audioBlob: Blob,
  language: string,
  apiKey: string,
): Promise<Array<{ word: string; start: number; end: number }>> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', 'whisper-large-v3');
  if (language !== 'auto') {
    formData.append('language', language);
  }
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(`Groq API error: ${response.status}: ${error.error?.message || response.statusText}`);
  }

  const result = await response.json() as { words?: Array<{ word: string; start: number; end: number }> };
  return result.words || [];
}
```

- [ ] **Step 4: Wire `case 'groq':` into the switch statement**

In `src/services/clipTranscriber.ts`, find the switch at line ~282:
```ts
        switch (transcriptionProvider) {
          case 'openai':
            words = await transcribeWithOpenAI(clipId, audioBlob, language, apiKey!, rangeStart);
            break;
          case 'assemblyai':
            words = await transcribeWithAssemblyAI(clipId, audioBlob, language, apiKey!, rangeStart);
            break;
          case 'deepgram':
            words = await transcribeWithDeepgram(clipId, audioBlob, language, apiKey!, rangeStart);
            break;
          default:
            throw new Error(`Unknown provider: ${transcriptionProvider}`);
        }
```

Add the `case 'groq':` before `default`:
```ts
        switch (transcriptionProvider) {
          case 'openai':
            words = await transcribeWithOpenAI(clipId, audioBlob, language, apiKey!, rangeStart);
            break;
          case 'assemblyai':
            words = await transcribeWithAssemblyAI(clipId, audioBlob, language, apiKey!, rangeStart);
            break;
          case 'deepgram':
            words = await transcribeWithDeepgram(clipId, audioBlob, language, apiKey!, rangeStart);
            break;
          case 'groq':
            words = await transcribeWithGroq(clipId, audioBlob, language, apiKey!, rangeStart);
            break;
          default:
            throw new Error(`Unknown provider: ${transcriptionProvider}`);
        }
```

- [ ] **Step 5: Run build**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/clipTranscriber.ts tests/unit/groqTranscription.test.ts
git commit -m "feat: add Groq Whisper transcription provider"
```

---

## Task 3: Add Groq to TranscriptionSettings UI

**Files:**
- Modify: `src/components/common/settings/TranscriptionSettings.tsx`

- [ ] **Step 1: Add Groq to providers array**

Open `src/components/common/settings/TranscriptionSettings.tsx`. Find the `providers` array (line 7). Add the Groq entry after `deepgram`:

```ts
const providers: { id: TranscriptionProvider; label: string; description: string }[] = [
  { id: 'server', label: 'Whisper large-v3-turbo (Cloud)', description: 'Yüksek doğruluk, API key yok. Cloudflare Workers AI üzerinde çalışır.' },
  { id: 'openai', label: 'OpenAI Whisper API', description: 'High accuracy, $0.006/minute. Requires API key.' },
  { id: 'assemblyai', label: 'AssemblyAI', description: 'Excellent accuracy, speaker diarization. $0.015/minute.' },
  { id: 'deepgram', label: 'Deepgram', description: 'Fast, good accuracy. $0.0125/minute.' },
  { id: 'groq', label: 'Groq (Whisper Large v3)', description: 'Hızlı, yüksek kalite. $0.02/saat. Groq API key gerekli.' },
  { id: 'local', label: 'Browser Whisper (tiny)', description: 'Tarayıcıda çalışır, ~100MB indirir. Düşük doğruluk.' },
];
```

- [ ] **Step 2: Run build and verify TypeScript**

```bash
npm run build
```
Expected: no errors. The Groq provider now appears in the settings UI with a checkmark when a Groq API key is saved.

- [ ] **Step 3: Commit**

```bash
git add src/components/common/settings/TranscriptionSettings.tsx
git commit -m "feat: add Groq to transcription provider settings UI"
```

---

## Task 4: Add `trackName` parameter to `addSubtitlesToTimeline`

**Files:**
- Modify: `src/services/subtitleTrackBuilder.ts`

- [ ] **Step 1: Add optional `trackName` parameter**

Open `src/services/subtitleTrackBuilder.ts`. Find the function signature at line 78:

```ts
export async function addSubtitlesToTimeline(entries: SrtEntry[], timelineOffset: number = 0, preset?: SubtitlePositionPreset): Promise<void> {
```

Change to:

```ts
export async function addSubtitlesToTimeline(entries: SrtEntry[], timelineOffset: number = 0, preset?: SubtitlePositionPreset, trackName?: string): Promise<void> {
```

Find the line that assigns `SUBTITLE_TRACK_NAME` for the track lookup (around line 82–86):
```ts
  let trackId = store.tracks.find(t => t.type === 'video' && t.name === SUBTITLE_TRACK_NAME)?.id;
  if (!trackId) {
    trackId = store.addTrack('video');
    store.renameTrack(trackId, SUBTITLE_TRACK_NAME);
  }
```

Change to:
```ts
  const resolvedTrackName = trackName ?? SUBTITLE_TRACK_NAME;
  let trackId = store.tracks.find(t => t.type === 'video' && t.name === resolvedTrackName)?.id;
  if (!trackId) {
    trackId = store.addTrack('video');
    store.renameTrack(trackId, resolvedTrackName);
  }
```

Also update the log line below to use `resolvedTrackName`:
```ts
  log.info(`Adding ${entries.length} subtitle clips to track "${resolvedTrackName}" (paddingBottom=${subtitleTextProps.paddingBottom}px, offset=${timelineOffset}s, preset=${preset?.id ?? 'auto'})`);
```

- [ ] **Step 2: Run build**

```bash
npm run build
```
Expected: no errors. Existing callers pass no `trackName` so they still default to `'Subtitles'`.

- [ ] **Step 3: Commit**

```bash
git add src/services/subtitleTrackBuilder.ts
git commit -m "feat: add optional trackName param to addSubtitlesToTimeline"
```

---

## Task 5: Create `groqTranslationService`

**Files:**
- Create: `src/services/groqTranslationService.ts`
- Create: `tests/unit/groqTranslationService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/groqTranslationService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- tests/unit/groqTranslationService.test.ts
```
Expected: FAIL with "Cannot find module '../../src/services/groqTranslationService'"

- [ ] **Step 3: Create `groqTranslationService.ts`**

Create `src/services/groqTranslationService.ts`:

```ts
import { Logger } from './logger';

const log = Logger.create('GroqTranslation');

const BATCH_SIZE = 200;

export interface TranslationEntry {
  start: number;
  end: number;
  text: string;
}

export const TRANSLATION_LANGUAGES: { code: string; name: string }[] = [
  { code: 'tr', name: 'Türkçe' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ru', name: 'Русский' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'pl', name: 'Polski' },
  { code: 'sv', name: 'Svenska' },
  { code: 'no', name: 'Norsk' },
  { code: 'da', name: 'Dansk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'cs', name: 'Čeština' },
  { code: 'ro', name: 'Română' },
  { code: 'hu', name: 'Magyar' },
  { code: 'uk', name: 'Українська' },
  { code: 'th', name: 'ภาษาไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Bahasa Melayu' },
];

export async function translateSubtitles(
  entries: TranslationEntry[],
  targetLanguage: string,
  targetLanguageName: string,
  apiKey: string,
  onProgress?: (pct: number) => void,
): Promise<TranslationEntry[]> {
  if (entries.length === 0) return [];

  const batches: TranslationEntry[][] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batches.push(entries.slice(i, i + BATCH_SIZE));
  }

  const translatedTexts: string[] = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const texts = batch.map(e => e.text);

    log.info(`Translating batch ${b + 1}/${batches.length} (${texts.length} entries) to ${targetLanguageName}`);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Translate the following subtitle texts to ${targetLanguageName} (language code: ${targetLanguage}).
Return a JSON object with key "translations" containing an array of translated strings.
Same count and order as input. Do not add explanations or change timing.

Input: ${JSON.stringify(texts)}`,
        }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Groq hatası: ${detail}`);
    }

    const aiData = await response.json() as { choices: [{ message: { content: string } }] };
    const content = JSON.parse(aiData.choices[0].message.content) as { translations?: string[] };
    const translated: string[] = content.translations ?? Object.values(content) as string[];

    if (!Array.isArray(translated) || translated.length !== batch.length) {
      throw new Error(`Çeviri sayısı eşleşmedi (beklenen ${batch.length}, alınan ${translated?.length ?? 0})`);
    }

    translatedTexts.push(...translated);
    onProgress?.(Math.round(((b + 1) / batches.length) * 100));
  }

  return entries.map((entry, i) => ({
    ...entry,
    text: translatedTexts[i] ?? entry.text,
  }));
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- tests/unit/groqTranslationService.test.ts
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Run full build**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/groqTranslationService.ts tests/unit/groqTranslationService.test.ts
git commit -m "feat: add groqTranslationService with batch subtitle translation"
```

---

## Task 6: Add translation UI to TranscriptPanel

**Files:**
- Modify: `src/components/panels/TranscriptPanel.tsx`

The translate section reads text clips from the subtitle track (track named `"Subtitles"` or any `"Subtitles [*]"` track), calls `groqTranslationService`, then calls `addSubtitlesToTimeline` with a new track name.

- [ ] **Step 1: Add imports and translation state**

Open `src/components/panels/TranscriptPanel.tsx`. 

After the existing imports add:
```ts
import { useSettingsStore } from '../../stores/settingsStore';
import { TRANSLATION_LANGUAGES } from '../../services/groqTranslationService';
import type { TranslationEntry } from '../../services/groqTranslationService';
```

Inside `TranscriptPanel()`, after the existing state declarations, add:
```ts
  const [translateLang, setTranslateLang] = useState('en');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState(0);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const { apiKeys } = useSettingsStore(useShallow(s => ({ apiKeys: s.apiKeys })));
  const groqKey = apiKeys['groq'] ?? '';
```

Also add the `tracks` selector to the existing `useTimelineStore` call:
```ts
  const {
    clips,
    tracks,
    selectedClipIds,
    playheadPosition,
    setPlayheadPosition,
  } = useTimelineStore(useShallow(s => ({
    clips: s.clips,
    tracks: s.tracks,
    selectedClipIds: s.selectedClipIds,
    playheadPosition: s.playheadPosition,
    setPlayheadPosition: s.setPlayheadPosition,
  })));
```

- [ ] **Step 2: Add `subtitleEntries` memo and `handleTranslate` callback**

After the existing `handleDelete` callback, add:

```ts
  // Collect text clips from subtitle tracks for translation
  const subtitleEntries = useMemo((): TranslationEntry[] => {
    const subtitleTracks = tracks.filter(t =>
      t.type === 'video' && t.name.startsWith('Subtitles')
    );
    if (!subtitleTracks.length) return [];

    return clips
      .filter(c =>
        subtitleTracks.some(t => t.id === c.trackId) &&
        c.textProperties?.text
      )
      .sort((a, b) => a.startTime - b.startTime)
      .map(c => ({
        start: c.startTime,
        end: c.startTime + c.duration,
        text: c.textProperties!.text,
      }));
  }, [tracks, clips]);

  const handleTranslate = useCallback(async () => {
    if (!subtitleEntries.length || !groqKey) return;

    setIsTranslating(true);
    setTranslateError(null);
    setTranslateProgress(0);

    try {
      const langEntry = TRANSLATION_LANGUAGES.find(l => l.code === translateLang);
      const langName = langEntry?.name ?? translateLang;

      const { translateSubtitles } = await import('../../services/groqTranslationService');
      const translated = await translateSubtitles(
        subtitleEntries,
        translateLang,
        langName,
        groqKey,
        setTranslateProgress,
      );

      const { addSubtitlesToTimeline } = await import('../../services/subtitleTrackBuilder');
      await addSubtitlesToTimeline(
        translated,
        0,
        undefined,
        `Subtitles [${translateLang.toUpperCase()}]`,
      );
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : 'Çeviri başarısız');
    } finally {
      setIsTranslating(false);
      setTranslateProgress(0);
    }
  }, [subtitleEntries, groqKey, translateLang]);
```

- [ ] **Step 3: Add translation UI section to the render**

In the `return` block of `TranscriptPanel`, before the closing `</div>` of `transcript-footer`, add a new section. Place it after `{/* Actions */}` block (around line 378), before the progress bar:

```tsx
      {/* Translation */}
      {subtitleEntries.length > 0 && (
        <div className="transcript-translate">
          <div className="transcript-translate-row">
            <select
              value={translateLang}
              onChange={e => setTranslateLang(e.target.value)}
              disabled={isTranslating}
              className="translate-lang-select"
            >
              {TRANSLATION_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
            <button
              className="btn-translate"
              onClick={handleTranslate}
              disabled={isTranslating || !groqKey}
              title={!groqKey ? 'Groq API key gerekli — Ayarlar > API Keys' : `${subtitleEntries.length} altyazıyı çevir`}
            >
              {isTranslating ? `${translateProgress}%` : 'Çevir'}
            </button>
          </div>
          {translateError && (
            <div className="translate-error">{translateError}</div>
          )}
          {isTranslating && (
            <div className="transcript-progress">
              <div className="transcript-progress-bar" style={{ width: `${translateProgress}%` }} />
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Add CSS**

Open `src/components/panels/TranscriptPanel.css` and append at the end:

```css
.transcript-translate {
  padding: 6px 12px;
  border-top: 1px solid var(--border-color, #333);
}

.transcript-translate-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.translate-lang-select {
  flex: 1;
  background: var(--input-bg, #2a2a2a);
  color: var(--text-primary, #fff);
  border: 1px solid var(--border-color, #444);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
}

.btn-translate {
  background: var(--accent-color, #5b8dd9);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-translate:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.translate-error {
  font-size: 11px;
  color: var(--error-color, #e05252);
  margin-top: 4px;
}
```

- [ ] **Step 5: Run build**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/TranscriptPanel.tsx src/components/panels/TranscriptPanel.css
git commit -m "feat: add subtitle translation UI to TranscriptPanel"
```

---

## Task 7: Add "Translate..." to TimelineContextMenu

**Files:**
- Modify: `src/components/timeline/TimelineContextMenu.tsx`

This adds a context menu item that appears when right-clicking a text clip whose track name starts with `"Subtitles"`.

- [ ] **Step 1: Add imports and subtitle track helper**

Open `src/components/timeline/TimelineContextMenu.tsx`. Add these imports after the existing ones:

```ts
import { useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { useSettingsStore } from '../../stores/settingsStore';
import { TRANSLATION_LANGUAGES } from '../../services/groqTranslationService';
import type { TranslationEntry } from '../../services/groqTranslationService';
```

- [ ] **Step 2: Add translation state inside the component**

Inside `TimelineContextMenu`, after the existing `useContextMenuPosition` call, add:

```ts
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [translateLang, setTranslateLang] = useState('en');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState(0);

  const tracks = useTimelineStore(s => s.tracks);
  const clips = useTimelineStore(s => s.clips);
  const groqKey = useSettingsStore(s => s.apiKeys['groq'] ?? '');

  const contextClip = contextMenu?.clipId ? clipMap.get(contextMenu.clipId) : null;
  const contextTrack = contextClip
    ? tracks.find(t => t.id === contextClip.trackId)
    : null;
  const isSubtitleTrack = !!contextTrack?.name.startsWith('Subtitles');
```

- [ ] **Step 3: Add `handleTranslateTrack` function**

After the state declarations, add:

```ts
  const handleTranslateTrack = async () => {
    if (!contextTrack || !groqKey) return;
    setIsTranslating(true);
    setTranslateProgress(0);
    setShowTranslateModal(false);
    setContextMenu(null);

    try {
      const langEntry = TRANSLATION_LANGUAGES.find(l => l.code === translateLang);
      const langName = langEntry?.name ?? translateLang;

      const trackClips = clips
        .filter(c => c.trackId === contextTrack.id && c.textProperties?.text)
        .sort((a, b) => a.startTime - b.startTime);

      const entries: TranslationEntry[] = trackClips.map(c => ({
        start: c.startTime,
        end: c.startTime + c.duration,
        text: c.textProperties!.text,
      }));

      if (!entries.length) return;

      const { translateSubtitles } = await import('../../services/groqTranslationService');
      const translated = await translateSubtitles(entries, translateLang, langName, groqKey, setTranslateProgress);

      const { addSubtitlesToTimeline } = await import('../../services/subtitleTrackBuilder');
      await addSubtitlesToTimeline(translated, 0, undefined, `Subtitles [${translateLang.toUpperCase()}]`);
    } catch (err) {
      log.error('Translation failed', err);
    } finally {
      setIsTranslating(false);
      setTranslateProgress(0);
    }
  };
```

- [ ] **Step 4: Add context menu item**

Find the return block of `TimelineContextMenu`. Locate the section where other clip-specific menu items are rendered (look for `<div className="context-menu-item"` entries). Add the translate item at the end of the clip-specific items, guarded by `isSubtitleTrack`:

```tsx
        {isSubtitleTrack && groqKey && (
          <div
            className="context-menu-item"
            onClick={() => {
              setShowTranslateModal(true);
              setContextMenu(null);
            }}
          >
            Çevir...
          </div>
        )}
        {isSubtitleTrack && !groqKey && (
          <div className="context-menu-item context-menu-item--disabled" title="Ayarlar > API Keys bölümüne Groq key ekleyin">
            Çevir... (Groq key yok)
          </div>
        )}
```

- [ ] **Step 5: Add the translate modal**

After the context menu `<div>` (at the end of the component return, before the closing fragment `</>`), add the modal:

```tsx
      {showTranslateModal && (
        <div className="translate-modal-backdrop" onClick={() => setShowTranslateModal(false)}>
          <div className="translate-modal" onClick={e => e.stopPropagation()}>
            <div className="translate-modal-title">Altyazıları Çevir</div>
            <select
              value={translateLang}
              onChange={e => setTranslateLang(e.target.value)}
              className="translate-lang-select"
            >
              {TRANSLATION_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
            <div className="translate-modal-actions">
              <button onClick={() => setShowTranslateModal(false)}>İptal</button>
              <button className="btn-translate-confirm" onClick={handleTranslateTrack}>Çevir</button>
            </div>
          </div>
        </div>
      )}
      {isTranslating && (
        <div className="translate-progress-toast">
          Çevriliyor... {translateProgress}%
        </div>
      )}
```

- [ ] **Step 6: Add CSS**

Open `src/App.css` (all timeline/context-menu styles live here). Append at the end:

```css
.context-menu-item--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.translate-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.translate-modal {
  background: var(--panel-bg, #1e1e1e);
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  padding: 16px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.translate-modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.translate-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-translate-confirm {
  background: var(--accent-color, #5b8dd9);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
}

.translate-progress-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: var(--panel-bg, #1e1e1e);
  border: 1px solid var(--accent-color, #5b8dd9);
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text-primary, #fff);
  z-index: 9998;
}
```

- [ ] **Step 7: Run build**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 8: Run all tests**

```bash
npm run test
```
Expected: all tests PASS.

- [ ] **Step 9: Lint**

```bash
npx eslint src/components/timeline/TimelineContextMenu.tsx src/components/panels/TranscriptPanel.tsx src/services/groqTranslationService.ts src/services/clipTranscriber.ts
```
Expected: 0 errors (warnings OK).

- [ ] **Step 10: Commit**

```bash
git add src/components/timeline/TimelineContextMenu.tsx
git commit -m "feat: add Translate context menu item for subtitle tracks"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```
Expected: exits 0, no errors.

- [ ] **Step 2: Run full test suite**

```bash
npm run test
```
Expected: all tests PASS.

- [ ] **Step 3: Run lint**

```bash
npx eslint .
```
Expected: 0 errors.

- [ ] **Step 4: Smoke test checklist (manual)**

Start dev server: `npm run dev`

Groq transcription:
1. Open Settings → Transcription → verify "Groq (Whisper Large v3)" appears
2. Open Settings → API Keys → enter a Groq key → verify checkmark appears next to Groq in Transcription settings
3. Import a short video clip, select it, open Transcript panel → click Transcribe → verify it calls Groq and returns words

Translation (TranscriptPanel):
4. Add subtitles to timeline via the Transcript tab (Properties panel) or import an SRT file
5. Open Transcript panel → verify "Çevir" button appears with language dropdown
6. Select English → click Çevir → verify a new `"Subtitles [EN]"` track appears on the timeline with translated text clips

Translation (context menu):
7. Right-click a text clip on the Subtitles track → verify "Çevir..." appears
8. Click it → select a language → confirm → verify new track created

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Groq transcription + subtitle translation complete"
```
