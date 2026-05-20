# Auto Reframe — Design Spec

**Date:** 2026-05-20  
**Status:** Approved

---

## Overview

Auto Reframe converts a horizontal (16:9) video clip into a vertical (9:16) or square (1:1 / 4:5) composition by intelligently detecting where the subject is at each moment and generating animated position keyframes. The result is a new composition added to the timeline — the original clip is never modified.

Supports all content types: talking heads, planes, crowds, action — anything.

---

## Detection Pipeline

For each sampled frame (every ~500ms), subject position is resolved in this priority order:

1. **Face detection** — MediaPipe Face Detector (`@mediapipe/tasks-vision`, ~2MB WASM model, loaded lazily on first use). If one or more faces are detected, the bounding-box center of the largest face becomes `attentionX`.
2. **Motion center of mass** — If no face, compute the weighted center of the 4×4 local-motion grid (same grid already computed in `clipAnalyzer.ts`). The column with highest local motion weight determines `attentionX`.
3. **Default (center)** — If motion is below threshold (static scene / landscape), `attentionX = 0.5`.

`attentionSource` records which branch was used, shown in the panel ("yüz tespiti", "hareket", "varsayılan").

### New types (added to `src/types/index.ts`)

```ts
// Extended FrameAnalysisData (two optional fields added — backwards compatible)
interface FrameAnalysisData {
  // ... existing fields unchanged ...
  attentionX?: number;        // 0–1 normalised horizontal subject position
  attentionSource?: 'face' | 'motion' | 'default';
}

// Stored separately from ClipAnalysis — only created when user runs Auto Reframe
interface ReframeAnalysis {
  clipId: string;
  sampleIntervalMs: number;
  frames: Array<{
    timestamp: number;       // seconds, relative to clip source
    attentionX: number;      // 0–1
    attentionSource: 'face' | 'motion' | 'default';
    isSceneCut: boolean;
  }>;
}
```

---

## Crop Path Generation

`reframeCropPathBuilder.ts` converts `ReframeAnalysis` into timeline keyframes:

1. **Smooth** — Apply a Gaussian rolling average over `attentionX` values. Window sizes:
   - Az (Low): 0.5s window
   - Orta (Medium): 1.5s window  
   - Çok (High): 3.0s window
2. **Scene cut reset** — When `isSceneCut=true`, flush the smoothing window; the crop jumps immediately (no pan across a cut).
3. **Keyframe reduction** — Only emit a keyframe when `positionX` changes by more than 4px vs. the previous keyframe (avoids thousands of micro-keyframes).
4. **positionX mapping** — Given target comp dimensions `(compW, compH)` and source clip dimensions `(srcW, srcH)`:
   - `scale = compH / srcH` (fills height, clips width)
   - `scaledW = srcW * scale`
   - `maxOffset = (scaledW - compW) / 2`
   - `positionX = (attentionX - 0.5) * 2 * maxOffset`
   - Example: 1920×1080 → 1080×1920: scale=1.778, scaledW=3413px, maxOffset=±1166px

Returns: `{ scale: number; keyframes: Array<{ time: number; positionX: number; easing: 'ease-in-out' }> }`

---

## New Files

### `src/services/reframeAnalyzer.ts`

```ts
export interface ReframeAnalyzeOptions {
  sampleIntervalMs?: number;   // default 500
}

export async function analyzeClipForReframe(
  clipId: string,
  onProgress?: (pct: number) => void,
  options?: ReframeAnalyzeOptions
): Promise<ReframeAnalysis>
```

- Extracts frames via a hidden `<canvas>` + `<video>` element (same approach as `clipAnalyzer.ts`)
- Loads MediaPipe Face Detector model once, caches instance (HMR-safe singleton pattern)
- Reuses `isSceneCut` from existing `ClipAnalysis` if available in mediaStore, otherwise computes it inline

### `src/services/reframeCropPathBuilder.ts`

```ts
export type SmoothingLevel = 'low' | 'medium' | 'high';
export type TargetAspectRatio = '9:16' | '1:1' | '4:5';

export interface CropPath {
  scale: number;
  keyframes: Array<{ time: number; positionX: number; easing: 'ease-in-out' }>;
}

export function buildCropPath(
  analysis: ReframeAnalysis,
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: TargetAspectRatio,
  smoothing: SmoothingLevel
): CropPath

export function getTargetDimensions(ratio: TargetAspectRatio): { width: number; height: number }
// 9:16 → 1080×1920, 1:1 → 1080×1080, 4:5 → 1080×1350
```

### `src/components/panels/AutoReframePanel.tsx`

States: `idle | analyzing | ready | applying | error`

Sub-sections:
- **Format selector**: 9:16 / 1:1 / 4:5 pill buttons
- **Smoothing selector**: Az / Orta / Çok pill buttons (default: Orta)
- **Analiz Et button** (idle state): shows estimated frame count and time (~8s for a 2-min clip)
- **Progress bar** (analyzing state): `onProgress` callback drives it
- **Split preview** (ready state): left = 16:9 with red crop window overlay, right = reframed preview (uses CSS `object-fit` + `object-position` to simulate)
- **Mini crop path timeline** (ready state): SVG path showing attentionX curve over time, with draggable keyframe dots
- **Quick correction bar** (ready state): "◀ Sol / Orta / Sağ ▶" buttons — sets a manual override keyframe at the current playhead time
- **Kompozisyon Oluştur** button (ready state): creates composition and adds to timeline
- **Kompozisyonda Aç** link: activates the new composition in the main timeline for full keyframe editing

### `src/components/panels/AutoReframePanel.css`

Styles for panel, split preview, mini timeline SVG, crop path animation, button states.

---

## Modified Files

### `src/types/index.ts`
- Add `attentionX?: number` and `attentionSource?: 'face' | 'motion' | 'default'` to `FrameAnalysisData`
- Add `ReframeAnalysis` interface

### `src/types/dock.ts`
- Add `'auto-reframe'` to `PanelType` union
- Add entry to `PANEL_CONFIGS`: `{ title: 'Auto Reframe', icon: '⬡' }`

### `src/components/dock/DockPanelContent.tsx`
- Add `case 'auto-reframe': return <AutoReframePanel />;`

### `src/components/common/Toolbar.tsx`
- Add "Auto Reframe" to the panels toggle menu with `togglePanelType('auto-reframe')`

---

## Composition Creation Flow

When user clicks "Kompozisyon Oluştur":

1. `getTargetDimensions(ratio)` → e.g. `{ width: 1080, height: 1920 }`
2. `mediaStore.createComposition(name, { width, height })` — name: `"Reframe 9:16 — <clipName>"`
3. Add original clip to the composition at `startTime=0` via `timelineStore.addVideoClip(trackId, clipSourceId, 0)`
4. `timelineStore.updateClipTransform(clipId, { scale: { x: scale, y: scale } })`
5. For each keyframe in `cropPath.keyframes`: `timelineStore.addKeyframe(clipId, 'position.x', positionX, time, 'ease-in-out')`
6. Add a composition clip to the main timeline track via `timelineStore.addCompClip(...)` pointing to the new composition
7. Panel shows a success toast; "Kompozisyonda Aç" becomes the primary CTA

---

## Error Handling

| Error | User message |
|-------|-------------|
| No clip selected | Analiz Et butonu disabled, "Önce timeline'dan bir clip seç" hint |
| MediaPipe model load fails | Fall back to motion-only mode silently; log warn |
| Clip has no video track (audio-only) | "Bu clip video içermiyor" toast |
| analyzeClipForReframe throws | "Analiz başarısız: {detail}" error state with retry button |
| Composition creation fails | "Kompozisyon oluşturulamadı" toast |

---

## What Is NOT in Scope

- Vertical-to-horizontal reframing
- Multiple clips batch reframing (one clip at a time)
- AI/cloud vision API for detection (local only)
- Y-axis (vertical) panning (only horizontal pan needed for landscape→portrait)
- Exporting the reframe metadata as FCPXML transform data

---

## Files Summary

| Action | File |
|--------|------|
| Create | `src/services/reframeAnalyzer.ts` |
| Create | `src/services/reframeCropPathBuilder.ts` |
| Create | `src/components/panels/AutoReframePanel.tsx` |
| Create | `src/components/panels/AutoReframePanel.css` |
| Modify | `src/types/index.ts` |
| Modify | `src/types/dock.ts` |
| Modify | `src/components/dock/DockPanelContent.tsx` |
| Modify | `src/components/common/Toolbar.tsx` |
