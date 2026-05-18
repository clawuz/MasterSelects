# Groq Transcription + Subtitle Translation — Design Spec

**Date:** 2026-05-16  
**Status:** Approved

---

## Overview

Two independent features ported from the subtitle-app project:

1. **Groq Transcription** — Add Groq (`whisper-large-v3`) as a transcription provider alongside the existing OpenAI/AssemblyAI/Deepgram options.
2. **Subtitle Translation** — Translate any subtitle track (from any source: Groq, OpenAI, SRT import, etc.) into a new timeline track using Groq LLaMA 3.3 70B.

Both features use direct browser → Groq API calls (Approach A). API key is stored encrypted in IndexedDB via the existing `apiKeyManager.ts` — same key used for AI Chat.

---

## Feature 1: Groq Transcription Provider

### What changes

**`src/stores/settingsStore.ts`**
- Add `'groq'` to `TranscriptionProvider` union type:
  ```ts
  export type TranscriptionProvider = 'local' | 'server' | 'openai' | 'assemblyai' | 'deepgram' | 'groq';
  ```

**`src/services/clipTranscriber.ts`**
- Add `transcribeWithGroq(clipId, audioBlob, language, apiKey, rangeStart)` function
- Endpoint: `POST https://api.groq.com/openai/v1/audio/transcriptions`
- Request: `FormData` with `file`, `model=whisper-large-v3`, `response_format=verbose_json`, `timestamp_granularities[]=word`
- Language: pass `language` param if not `'auto'`, otherwise omit (Groq auto-detects)
- Response: parse `words[]` array → map to `TranscriptWord[]` with `startMs/endMs` offsets from `rangeStart`
- Wire into the existing `case 'groq':` branch in `transcribeClip()`

**`src/components/common/settings/TranscriptionSettings.tsx`**
- Add `{ id: 'groq', label: 'Groq (Whisper Large v3)', description: 'Cloud — hızlı, yüksek kalite' }` to the `providers` array
- Groq key status indicator uses existing `localKeys['groq']` check (same pattern as openai)

**No changes needed to `ApiKeysSettings.tsx`** — Groq key input already exists for the AI Chat feature.

### Data flow

```
clipTranscriber.transcribeClip()
  → transcribeWithGroq(audioBlob, language, groqApiKey, rangeStart)
    → POST api.groq.com/openai/v1/audio/transcriptions
    → parse verbose_json → TranscriptWord[]
  → saveTranscriptWords() → mediaStore
```

---

## Feature 2: Subtitle Translation

### New file: `src/services/groqTranslationService.ts`

```ts
interface TranslationEntry { startMs: number; endMs: number; text: string }

translateSubtitles(
  entries: TranslationEntry[],
  targetLanguage: string,       // e.g. 'en'
  targetLanguageName: string,   // e.g. 'English'
  apiKey: string,
  onProgress?: (pct: number) => void
): Promise<TranslationEntry[]>
```

- Endpoint: `POST https://api.groq.com/openai/v1/chat/completions`
- Model: `llama-3.3-70b-versatile`
- Batching: split entries into chunks of 200; send each chunk sequentially; merge results in order. `onProgress` fires after each chunk (e.g. 3 chunks → 33%, 66%, 100%)
- Request body: JSON with `response_format: { type: 'json_object' }`, `temperature: 0.1`
- Prompt pattern (ported from subtitle-app):
  ```
  Translate the following subtitle texts to {targetLanguageName} (language code: {targetLanguage}).
  Return a JSON object with key "translations" containing an array of translated strings.
  Same count and order as input. Do not add explanations or change timing.
  Input: [...]
  ```
- Validate response: `translations.length === entries.length`, else throw
- Return: original entries with `text` replaced by translated strings (timing unchanged)

After translation, call `addSubtitlesToTimeline(translatedEntries, offset, preset)` from `subtitleTrackBuilder.ts` — this creates a new track named `"Subtitles [EN]"` (or whatever target lang code).

### Track naming

`subtitleTrackBuilder.ts` — update `addSubtitlesToTimeline` to accept an optional `trackName` parameter:
```ts
addSubtitlesToTimeline(entries, timelineOffset, preset, trackName?)
```
Default remains `'Subtitles'`. Translation passes `'Subtitles [' + targetLanguage.toUpperCase() + ']'`.

### Supported languages

28 languages ported from subtitle-app:
Turkish, English, German, French, Spanish, Italian, Portuguese, Dutch, Russian, Japanese, Chinese, Korean, Arabic, Hindi, Polish, Swedish, Norwegian, Danish, Finnish, Greek, Czech, Romanian, Hungarian, Ukrainian, Thai, Vietnamese, Indonesian, Malay.

### UI — TranscriptPanel

- "Çevir" button + language dropdown appear when the timeline has at least one subtitle track (track name contains `"Subtitles"` or track type is `video` with text clips)
- Button is disabled + tooltip "Groq API key gerekli" if no Groq key stored
- On click: show inline progress bar, call `groqTranslationService.translateSubtitles()`, then `addSubtitlesToTimeline()` with new track name
- Source entries: read text clips from the selected/active subtitle track → build `TranslationEntry[]`

### UI — Timeline context menu

- `TimelineContextMenu.tsx`: when right-clicking a track whose name contains `"Subtitles"`, show "Çevir..." menu item
- Opens a small modal with language dropdown + "Çevir" confirm button
- Same flow as panel button

### Error handling

| Error | User message |
|-------|-------------|
| No Groq key | "Groq API key eksik — Ayarlar > API Keys" |
| Groq API error (4xx/5xx) | "Groq hatası: {detail}" |
| Translation count mismatch | "Çeviri sayısı eşleşmedi, tekrar deneyin" |
| Empty subtitle track | Button disabled, no error shown |

---

## What is NOT in scope

- Translation of non-subtitle text clips (title cards, lower thirds)
- Speaker diarization
- SRT file export after translation (already handled by existing SRT export)
- Offline/local translation model

---

## Files to create / modify

| Action | File |
|--------|------|
| Modify | `src/stores/settingsStore.ts` |
| Modify | `src/services/clipTranscriber.ts` |
| Modify | `src/components/common/settings/TranscriptionSettings.tsx` |
| Modify | `src/services/subtitleTrackBuilder.ts` |
| Modify | `src/components/panels/TranscriptPanel.tsx` |
| Modify | `src/components/timeline/TimelineContextMenu.tsx` |
| Create | `src/services/groqTranslationService.ts` |
