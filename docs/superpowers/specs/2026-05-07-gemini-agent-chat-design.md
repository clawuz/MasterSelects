1# Gemini Agent Chat — Design Spec

**Date:** 2026-05-07
**Status:** Approved

---

## Goal

Replace the existing AIChatPanel's multi-provider setup with a single Gemini-only agentic chat that can fully automate timeline editing **and video creation from scratch**. Users give natural language commands ("make a 20-second intro with these clips", "convert this image to a video", "build this storyboard") and Gemini orchestrates the existing aiTools to apply changes automatically.

---

## Architecture

```
User message
    ↓
AgentLoop
    ├── 1. historyStore.snapshot()         — automatic undo checkpoint
    ├── 2. ContextBuilder.build()          — timeline state + media library + transcripts
    ├── 3. geminiService.chat(messages, tools)
    ├── 4. Tool call received → aiTools handler dispatch
    ├── 5. Result fed back to Gemini → loop continues
    └── 6. Stop on "finish" response or max 20 steps
```

The existing `aiTools/` handlers (76 tools, 15 definition files) are **unchanged**. Only the orchestration layer is new.

---

## Components

### New files

| File | Responsibility |
|------|----------------|
| `src/services/geminiService.ts` | Gemini API client — sends messages + tool definitions, receives streaming responses and tool call blocks |
| `src/services/agentLoop.ts` | Orchestrates multi-step tool use loop: snapshot → context → send → dispatch → repeat |
| `src/services/contextBuilder.ts` | Assembles current project state into a Gemini-readable JSON context (tracks, clips, media library, transcripts) |

### Modified files

| File | Change |
|------|--------|
| `src/components/panels/ai/AIChatPanel.tsx` | Remove OpenAI/Claude provider logic; wire to agentLoop; add tool execution progress UI |
| `src/stores/settingsStore.ts` | Add `geminiApiKey` field (encrypted, like existing API keys) |

---

## GeminiService

- Model: `gemini-2.0-flash` (free tier via Google AI Studio API key)
- API: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
- Auth: `?key=<apiKey>` query param
- Tool use: Gemini function calling format (convert existing OpenAI tool definitions to Gemini schema)
- Streaming: Server-sent events for text tokens; tool calls come as complete blocks

---

## AgentLoop

```typescript
async function runAgent(userMessage: string, onProgress: (msg: string) => void): Promise<void>
```

1. Call `historyStore.getState().pushSnapshot()` — undo checkpoint
2. Call `contextBuilder.build()` — returns serialized project state
3. Build message array: `[systemPrompt + context, ...chatHistory, userMessage]`
4. Send to Gemini with all 76 tool definitions
5. If response contains `functionCall`:
   - Show progress: `🔧 ${toolName} çalışıyor... (${step}/${maxSteps})`
   - Dispatch to `aiToolsHandler.execute(toolName, args)`
   - Append `functionResponse` to messages
   - Go to step 4 (loop)
6. If response is text with no tool calls → stream to chat UI
7. Stop conditions: no more tool calls, or step > 20, or error

**On error:** call `historyStore.getState().undo()` and report to user.

---

## ContextBuilder

Serializes current state to a compact JSON string included in the system prompt.

### Timeline context (existing clips)
```json
{
  "duration": 124.5,
  "tracks": [
    {
      "id": "track_1", "name": "Main", "type": "video",
      "clips": [
        { "id": "clip_1", "start": 0, "end": 30.2, "label": "interview.mp4",
          "hasTranscript": true, "transcript": "Hello, today we..." }
      ]
    }
  ],
  "playhead": 14.3
}
```

### Media library context (new)
```json
{
  "mediaLibrary": [
    { "id": "media_1", "name": "intro.mp4", "type": "video", "duration": 12.4 },
    { "id": "media_2", "name": "logo.png",  "type": "image" },
    { "id": "media_3", "name": "bg.psd",    "type": "image" },
    { "id": "media_4", "name": "music.mp3", "type": "audio", "duration": 180.0 }
  ]
}
```

Transcript text is included only if available and truncated at 500 chars per clip to stay within context limits. PSD files are exposed as `type: "image"` — Gemini can place them on the timeline as flattened images.

---

## Creation Modes

### Editing existing content
User has clips on timeline. Commands like:
- "2. dakikadaki sahneyi sil"
- "Tüm kesmelere crossfade ekle"
- "Bu konuşmayı kısalt"

### Creation from scratch
Timeline is empty or user wants a new video. Commands like:
- "Bu 5 klipten 60 saniyelik tanıtım yap"
- "10 saniyelik video yap, başta logo, sonra intro klip, sonda müzik"
- "Bu görseli 5 saniyelik videoya dönüştür"

AI workflow for creation:
1. Reads media library from context
2. Selects appropriate files
3. Creates tracks via `addTrack` tool
4. Places clips via `addVideoClip` / `addAudioClip` / `addImageClip` tools with specified start/end times
5. Adds transitions, effects, text clips as needed

### Storyboard execution
User provides a storyboard description (text). Gemini maps each scene to:
- A media library item or a generated text/solid clip
- A start time and duration
- Transitions between scenes
- Any text overlays

Example input: "Sahne 1: Logo 3sn fade in. Sahne 2: Ürün videosu 8sn. Sahne 3: Fiyat yazısı 4sn fade out."

### Image / PSD to video
User provides an image or PSD file already in media library. AI:
1. Places it on timeline as an image clip with specified duration
2. Optionally adds Ken Burns zoom effect if requested
3. PSD treated as flattened image (layer animation is out of scope)

---

## UI / UX

- **API key input**: Single Gemini API key field at top of panel (stored encrypted in settingsStore)
- **Chat interface**: Unchanged — streaming text responses, chat history
- **Tool execution progress**: Inline messages in chat during agent run:
  ```
  🔧 addVideoClip çalışıyor... (2/12)
  🔧 addTransition çalışıyor... (5/12)
  ✅ Tamamlandı — 12 adım uygulandı
  ```
- **Error state**: Red message "Adım N'de hata oluştu, değişiklikler geri alındı"
- **Removed**: Provider selector, model dropdown, OpenAI/Claude API key fields

---

## Constraints

- Max 20 tool calls per agent run (prevents infinite loops)
- Context builder caps transcript at 500 chars/clip to stay under Gemini token limit
- Media library list capped at 200 items in context (name + type + duration only, no binary data)
- Undo snapshot taken before every agent run — user can always Ctrl+Z
- Gemini 2.0 Flash free tier: 15 RPM, 1M TPM — sufficient for editing sessions

---

## Out of Scope

- AI-generated video frames (Sora/Runway-style generative video)
- PSD layer-by-layer animation
- Sending actual video frames/thumbnails to Gemini Vision
- Multi-turn tool use memory across separate chat sessions
- Real-time collaboration / shared agent sessions
