# Auto Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Auto Reframe" dock panel that analyzes a horizontal video clip for faces and motion, generates smooth position keyframes, and outputs a new 9:16 / 1:1 / 4:5 composition — without touching the original clip.

**Architecture:** `reframeAnalyzer.ts` extracts frames and detects attention center per frame (MediaPipe face detection → motion column center → fallback 0.5). `reframeCropPathBuilder.ts` smooths these values and produces `{scale, keyframes[]}`. `AutoReframePanel.tsx` orchestrates analyze → preview → create composition, writing scale + position.x keyframes into a new composition.

**Tech Stack:** React, Zustand (`useTimelineStore`, `useMediaStore`), `@mediapipe/tasks-vision` (FaceDetector), Vitest, existing `addKeyframe` / `addCompClip` / `updateClipTransform` timeline APIs.

**Spec:** `docs/superpowers/specs/2026-05-20-auto-reframe-design.md`

---

## File Map

| Action | File |
|--------|------|
| Create | `src/services/reframeCropPathBuilder.ts` |
| Create | `src/services/reframeAnalyzer.ts` |
| Create | `src/components/panels/AutoReframePanel.tsx` |
| Create | `src/components/panels/AutoReframePanel.css` |
| Modify | `src/types/index.ts` (add 2 fields + 1 interface) |
| Modify | `src/types/dock.ts` (add panel type + config) |
| Modify | `src/components/dock/DockPanelContent.tsx` (add 1 case) |
| Test | `tests/unit/reframeCropPathBuilder.test.ts` |
| Test | `tests/unit/reframeMotionCenter.test.ts` |

---

## Task 1: Types and dock registration

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/types/dock.ts`

- [ ] **Step 1: Extend FrameAnalysisData in `src/types/index.ts`**

Find the `FrameAnalysisData` interface (around line 590) and add two optional fields at the end:

```ts
export interface FrameAnalysisData {
  timestamp: number;
  motion: number;
  globalMotion: number;
  localMotion: number;
  focus: number;
  brightness: number;
  faceCount: number;
  isSceneCut?: boolean;
  attentionX?: number;        // 0–1 normalised horizontal subject position
  attentionSource?: 'face' | 'motion' | 'default';
}
```

- [ ] **Step 2: Add `ReframeAnalysis` interface to `src/types/index.ts`**

Add directly after `FrameAnalysisData`:

```ts
export interface ReframeAnalysisFrame {
  timestamp: number;
  attentionX: number;
  attentionSource: 'face' | 'motion' | 'default';
  isSceneCut: boolean;
}

export interface ReframeAnalysis {
  clipId: string;
  sampleIntervalMs: number;
  frames: ReframeAnalysisFrame[];
}
```

- [ ] **Step 3: Add `'auto-reframe'` to `PanelType` in `src/types/dock.ts`**

Find line 11:
```ts
export type PanelType = 'preview' | 'multi-preview' | 'timeline' | 'clip-properties' | 'color-workspace' | 'media' | 'export' | 'midi-mapping' | 'multicam' | 'ai-chat' | 'ai-video' | 'ai-segment' | 'scene-description' | 'youtube' | 'download' | 'transitions' | 'scope-waveform' | 'scope-histogram' | 'scope-vectorscope';
```

Replace with:
```ts
export type PanelType = 'preview' | 'multi-preview' | 'timeline' | 'clip-properties' | 'color-workspace' | 'media' | 'export' | 'midi-mapping' | 'multicam' | 'ai-chat' | 'ai-video' | 'ai-segment' | 'scene-description' | 'youtube' | 'download' | 'transitions' | 'scope-waveform' | 'scope-histogram' | 'scope-vectorscope' | 'auto-reframe';
```

- [ ] **Step 4: Add entry to `PANEL_CONFIGS` in `src/types/dock.ts`**

Inside `PANEL_CONFIGS`, after the last entry (before the closing `}`), add:

```ts
  'auto-reframe': {
    type: 'auto-reframe',
    title: 'Auto Reframe',
    minWidth: 240,
    minHeight: 400,
    closable: false,
  },
```

- [ ] **Step 5: Build to verify types compile**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/types/dock.ts
git commit -m "feat(auto-reframe): add types and dock panel registration"
```

---

## Task 2: reframeCropPathBuilder.ts (pure logic, TDD)

**Files:**
- Create: `src/services/reframeCropPathBuilder.ts`
- Create: `tests/unit/reframeCropPathBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/reframeCropPathBuilder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildCropPath,
  getTargetDimensions,
  type TargetAspectRatio,
  type SmoothingLevel,
} from '../../src/services/reframeCropPathBuilder';
import type { ReframeAnalysis } from '../../src/types/index';

function makeAnalysis(attentionValues: number[], sceneCuts: number[] = []): ReframeAnalysis {
  return {
    clipId: 'test',
    sampleIntervalMs: 500,
    frames: attentionValues.map((attentionX, i) => ({
      timestamp: i * 0.5,
      attentionX,
      attentionSource: 'motion' as const,
      isSceneCut: sceneCuts.includes(i),
    })),
  };
}

describe('getTargetDimensions', () => {
  it('returns 1080×1920 for 9:16', () => {
    expect(getTargetDimensions('9:16')).toEqual({ width: 1080, height: 1920 });
  });
  it('returns 1080×1080 for 1:1', () => {
    expect(getTargetDimensions('1:1')).toEqual({ width: 1080, height: 1080 });
  });
  it('returns 1080×1350 for 4:5', () => {
    expect(getTargetDimensions('4:5')).toEqual({ width: 1080, height: 1350 });
  });
});

describe('buildCropPath', () => {
  it('scale fills height for 9:16 given 1920×1080 source', () => {
    const path = buildCropPath(makeAnalysis([0.5]), 1920, 1080, '9:16', 'low');
    expect(path.scale).toBeCloseTo(1920 / 1080);
  });

  it('positionX ≈ 0 when attentionX = 0.5 (center)', () => {
    const path = buildCropPath(makeAnalysis([0.5, 0.5, 0.5]), 1920, 1080, '9:16', 'low');
    path.keyframes.forEach(kf => expect(kf.positionX).toBeCloseTo(0, 1));
  });

  it('positionX < 0 when attentionX = 0 (left)', () => {
    const path = buildCropPath(makeAnalysis([0, 0, 0]), 1920, 1080, '9:16', 'low');
    path.keyframes.forEach(kf => expect(kf.positionX).toBeLessThan(0));
  });

  it('positionX > 0 when attentionX = 1 (right)', () => {
    const path = buildCropPath(makeAnalysis([1, 1, 1]), 1920, 1080, '9:16', 'low');
    path.keyframes.forEach(kf => expect(kf.positionX).toBeGreaterThan(0));
  });

  it('emits fewer keyframes than frames for constant attention', () => {
    const path = buildCropPath(makeAnalysis(new Array(20).fill(0.5)), 1920, 1080, '9:16', 'low');
    expect(path.keyframes.length).toBeLessThan(20);
  });

  it('scene cut produces a jump: first keyframe after cut differs from last before cut', () => {
    // 3 frames left (0.0), then scene cut, 3 frames right (1.0)
    const analysis = makeAnalysis([0, 0, 0, 1, 1, 1], [3]);
    const path = buildCropPath(analysis, 1920, 1080, '9:16', 'high');
    const beforeCut = path.keyframes.filter(kf => kf.time < 1.5);
    const afterCut = path.keyframes.filter(kf => kf.time >= 1.5);
    if (beforeCut.length > 0 && afterCut.length > 0) {
      const lastBefore = beforeCut[beforeCut.length - 1].positionX;
      const firstAfter = afterCut[0].positionX;
      expect(firstAfter).toBeGreaterThan(lastBefore);
    }
  });

  it('all keyframes use ease-in-out easing', () => {
    const path = buildCropPath(makeAnalysis([0, 0.5, 1, 0.5, 0]), 1920, 1080, '9:16', 'medium');
    path.keyframes.forEach(kf => expect(kf.easing).toBe('ease-in-out'));
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test -- tests/unit/reframeCropPathBuilder.test.ts 2>&1 | tail -10
```

Expected: `Cannot find module '../../src/services/reframeCropPathBuilder'`

- [ ] **Step 3: Implement `src/services/reframeCropPathBuilder.ts`**

```ts
import type { ReframeAnalysis } from '../types/index';

export type TargetAspectRatio = '9:16' | '1:1' | '4:5';
export type SmoothingLevel = 'low' | 'medium' | 'high';

export interface CropKeyframe {
  time: number;
  positionX: number;
  easing: 'ease-in-out';
}

export interface CropPath {
  scale: number;
  keyframes: CropKeyframe[];
}

const DIMENSIONS: Record<TargetAspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1':  { width: 1080, height: 1080 },
  '4:5':  { width: 1080, height: 1350 },
};

const SMOOTHING_WINDOW_SEC: Record<SmoothingLevel, number> = {
  low: 0.5,
  medium: 1.5,
  high: 3.0,
};

// Threshold in pixels below which we skip emitting a new keyframe
const KEYFRAME_THRESHOLD_PX = 4;

export function getTargetDimensions(ratio: TargetAspectRatio): { width: number; height: number } {
  return DIMENSIONS[ratio];
}

export function buildCropPath(
  analysis: ReframeAnalysis,
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: TargetAspectRatio,
  smoothing: SmoothingLevel
): CropPath {
  const { width: compW, height: compH } = getTargetDimensions(targetRatio);
  const scale = compH / sourceHeight;
  const scaledW = sourceWidth * scale;
  const maxOffset = (scaledW - compW) / 2;

  // Split frames into segments at scene cuts, smooth each segment independently
  const segments: ReframeAnalysis['frames'][] = [];
  let current: ReframeAnalysis['frames'] = [];
  for (const frame of analysis.frames) {
    if (frame.isSceneCut && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push(frame);
  }
  if (current.length > 0) segments.push(current);

  const windowSec = SMOOTHING_WINDOW_SEC[smoothing];
  const smoothedPositions: Array<{ time: number; positionX: number }> = [];

  for (const segment of segments) {
    const windowSamples = Math.max(1, Math.round((windowSec * 1000) / analysis.sampleIntervalMs));
    const half = Math.floor(windowSamples / 2);

    for (let i = 0; i < segment.length; i++) {
      const start = Math.max(0, i - half);
      const end = Math.min(segment.length - 1, i + half);
      let sum = 0;
      for (let j = start; j <= end; j++) sum += segment[j].attentionX;
      const smoothed = sum / (end - start + 1);
      const positionX = (smoothed - 0.5) * 2 * maxOffset;
      smoothedPositions.push({ time: segment[i].timestamp, positionX });
    }
  }

  // Reduce keyframes: only emit when positionX changes > threshold
  const keyframes: CropKeyframe[] = [];
  let lastEmittedX: number | null = null;

  for (let i = 0; i < smoothedPositions.length; i++) {
    const { time, positionX } = smoothedPositions[i];
    const isFirst = i === 0;
    const isLast = i === smoothedPositions.length - 1;
    const changed = lastEmittedX === null || Math.abs(positionX - lastEmittedX) > KEYFRAME_THRESHOLD_PX;

    if (isFirst || isLast || changed) {
      keyframes.push({ time, positionX, easing: 'ease-in-out' });
      lastEmittedX = positionX;
    }
  }

  return { scale, keyframes };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test -- tests/unit/reframeCropPathBuilder.test.ts 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/reframeCropPathBuilder.ts tests/unit/reframeCropPathBuilder.test.ts
git commit -m "feat(auto-reframe): add reframeCropPathBuilder with smoothing and scene-cut reset"
```

---

## Task 3: reframeAnalyzer.ts (frame extraction + face/motion detection)

**Files:**
- Create: `src/services/reframeAnalyzer.ts`
- Create: `tests/unit/reframeMotionCenter.test.ts`

- [ ] **Step 1: Install MediaPipe**

```bash
npm install @mediapipe/tasks-vision
```

Expected: package added to `node_modules`, `package.json` updated.

- [ ] **Step 2: Write failing tests for the motion center helper**

Create `tests/unit/reframeMotionCenter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeMotionCenterX } from '../../src/services/reframeAnalyzer';

function makeFrame(width: number, height: number, fillValue = 0): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(fillValue);
  return new ImageData(data, width, height);
}

describe('computeMotionCenterX', () => {
  it('returns 0.5 when no motion between frames', () => {
    const frame = makeFrame(160, 90, 128);
    expect(computeMotionCenterX(frame, frame)).toBe(0.5);
  });

  it('returns < 0.5 when motion is only in the left quarter', () => {
    const width = 160, height = 90;
    const curr = makeFrame(width, height, 0);
    const prev = makeFrame(width, height, 0);
    // Illuminate left 40 pixels in curr only
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 40; x++) {
        const i = (y * width + x) * 4;
        curr.data[i] = curr.data[i + 1] = curr.data[i + 2] = 255;
        curr.data[i + 3] = 255;
      }
    }
    expect(computeMotionCenterX(curr, prev)).toBeLessThan(0.5);
  });

  it('returns > 0.5 when motion is only in the right quarter', () => {
    const width = 160, height = 90;
    const curr = makeFrame(width, height, 0);
    const prev = makeFrame(width, height, 0);
    for (let y = 0; y < height; y++) {
      for (let x = 120; x < 160; x++) {
        const i = (y * width + x) * 4;
        curr.data[i] = curr.data[i + 1] = curr.data[i + 2] = 255;
        curr.data[i + 3] = 255;
      }
    }
    expect(computeMotionCenterX(curr, prev)).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm run test -- tests/unit/reframeMotionCenter.test.ts 2>&1 | tail -10
```

Expected: `Cannot find module '../../src/services/reframeAnalyzer'`

- [ ] **Step 4: Implement `src/services/reframeAnalyzer.ts`**

```ts
import type { ReframeAnalysis, ReframeAnalysisFrame } from '../types/index';
import { useMediaStore } from '../stores/mediaStore';
import { Logger } from './logger';

const log = Logger.create('ReframeAnalyzer');

const CANVAS_WIDTH = 160;
const CANVAS_HEIGHT = 90;
const MOTION_THRESHOLD = 800; // sum of diff below this → no meaningful motion
const MOTION_GRID_COLS = 4;

// ─── MediaPipe singleton ──────────────────────────────────────────────────────

let faceDetector: import('@mediapipe/tasks-vision').FaceDetector | null = null;
let faceDetectorLoading = false;
let faceDetectorFailed = false;

async function getFaceDetector(): Promise<import('@mediapipe/tasks-vision').FaceDetector | null> {
  if (faceDetector) return faceDetector;
  if (faceDetectorFailed) return null;
  if (faceDetectorLoading) {
    // Wait for concurrent load to finish
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (!faceDetectorLoading) { clearInterval(interval); resolve(); }
      }, 100);
    });
    return faceDetector;
  }

  faceDetectorLoading = true;
  try {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
    });
    log.info('MediaPipe FaceDetector loaded');
  } catch (err) {
    log.warn('MediaPipe FaceDetector unavailable, using motion-only mode', err);
    faceDetectorFailed = true;
  } finally {
    faceDetectorLoading = false;
  }
  return faceDetector;
}

// HMR safety
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    faceDetector = null;
    faceDetectorLoading = false;
    faceDetectorFailed = false;
  });
}

// ─── Motion center helper (exported for tests) ───────────────────────────────

export function computeMotionCenterX(curr: ImageData, prev: ImageData): number {
  const { width, height } = curr;
  const colWidth = Math.floor(width / MOTION_GRID_COLS);
  const colMotion = new Array(MOTION_GRID_COLS).fill(0) as number[];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const diff =
        Math.abs(curr.data[i]     - prev.data[i]) +
        Math.abs(curr.data[i + 1] - prev.data[i + 1]) +
        Math.abs(curr.data[i + 2] - prev.data[i + 2]);
      const col = Math.min(Math.floor(x / colWidth), MOTION_GRID_COLS - 1);
      colMotion[col] += diff;
    }
  }

  const total = colMotion.reduce((a, b) => a + b, 0);
  if (total < MOTION_THRESHOLD) return 0.5; // static scene → center

  // Weighted centre of mass, normalised to 0–1
  const weightedSum = colMotion.reduce((sum, m, i) => sum + m * ((i + 0.5) / MOTION_GRID_COLS), 0);
  return weightedSum / total;
}

// ─── Frame extraction ─────────────────────────────────────────────────────────

async function extractFrame(
  video: HTMLVideoElement,
  timestampSec: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): Promise<ImageData> {
  return new Promise(resolve => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = timestampSec;
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    }, 1000);
  });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface ReframeAnalyzeOptions {
  sampleIntervalMs?: number;
}

export async function analyzeClipForReframe(
  clipId: string,
  onProgress?: (pct: number) => void,
  options?: ReframeAnalyzeOptions
): Promise<ReframeAnalysis> {
  const sampleIntervalMs = options?.sampleIntervalMs ?? 500;

  const mediaFile = useMediaStore.getState().files.find(f => f.id === clipId);
  if (!mediaFile?.file) throw new Error(`Media file not found: ${clipId}`);

  const detector = await getFaceDetector(); // null = motion-only mode

  const video = document.createElement('video');
  const videoUrl = URL.createObjectURL(mediaFile.file);
  video.src = videoUrl;
  video.muted = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Video load failed'));
    setTimeout(() => reject(new Error('Video load timeout')), 30000);
  });

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const duration = mediaFile.duration ?? video.duration;
  const totalSamples = Math.ceil((duration * 1000) / sampleIntervalMs);
  const frames: ReframeAnalysisFrame[] = [];
  let prevFrame: ImageData | null = null;

  try {
    for (let i = 0; i < totalSamples; i++) {
      const timestamp = (i * sampleIntervalMs) / 1000;
      const frame = await extractFrame(video, timestamp, canvas, ctx);

      let attentionX = 0.5;
      let attentionSource: ReframeAnalysisFrame['attentionSource'] = 'default';
      let isSceneCut = false;

      // 1. Face detection
      if (detector) {
        try {
          const result = detector.detect(canvas);
          if (result.detections.length > 0) {
            const bbox = result.detections[0].boundingBox!;
            attentionX = Math.max(0, Math.min(1, (bbox.originX + bbox.width / 2) / canvas.width));
            attentionSource = 'face';
          }
        } catch { /* face detection failure is non-fatal */ }
      }

      // 2. Motion fallback
      if (attentionSource !== 'face' && prevFrame) {
        const motionX = computeMotionCenterX(frame, prevFrame);
        if (motionX !== 0.5) {
          attentionX = motionX;
          attentionSource = 'motion';
        }
        // Detect scene cut: very high total pixel diff
        const totalDiff = Array.from(frame.data).reduce((sum, v, idx) => {
          return idx % 4 === 3 ? sum : sum + Math.abs(v - prevFrame!.data[idx]);
        }, 0);
        isSceneCut = totalDiff / (canvas.width * canvas.height) > 50;
      }

      frames.push({ timestamp, attentionX, attentionSource, isSceneCut });
      prevFrame = frame;
      onProgress?.(Math.round(((i + 1) / totalSamples) * 100));
    }
  } finally {
    URL.revokeObjectURL(videoUrl);
  }

  return { clipId, sampleIntervalMs, frames };
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm run test -- tests/unit/reframeMotionCenter.test.ts 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 6: Build check**

```bash
npm run build 2>&1 | grep -E "^.*error" | head -10
```

Expected: no errors (MediaPipe type errors may show as warnings — that's fine).

- [ ] **Step 7: Commit**

```bash
git add src/services/reframeAnalyzer.ts tests/unit/reframeMotionCenter.test.ts package.json package-lock.json
git commit -m "feat(auto-reframe): add reframeAnalyzer with MediaPipe face detection + motion fallback"
```

---

## Task 4: AutoReframePanel.tsx + CSS

**Files:**
- Create: `src/components/panels/AutoReframePanel.tsx`
- Create: `src/components/panels/AutoReframePanel.css`

This task has no unit tests (UI component). Manual testing instructions are at the end.

- [ ] **Step 1: Create `src/components/panels/AutoReframePanel.css`**

```css
.auto-reframe-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 12px;
  gap: 12px;
  font-size: 12px;
  color: var(--text-primary, #ccc);
  background: var(--panel-bg, #1a1a2e);
}

.auto-reframe-panel .arp-section-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary, #888);
  margin-bottom: 5px;
}

.auto-reframe-panel .arp-pills {
  display: flex;
  gap: 4px;
}

.auto-reframe-panel .arp-pill {
  flex: 1;
  border: 1px solid #333;
  background: transparent;
  color: #666;
  border-radius: 4px;
  padding: 5px 0;
  text-align: center;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.15s, color 0.15s;
}

.auto-reframe-panel .arp-pill.active {
  background: #e94560;
  border-color: #e94560;
  color: #fff;
  font-weight: 600;
}

.auto-reframe-panel .arp-analyze-btn {
  width: 100%;
  padding: 8px;
  background: #e94560;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}

.auto-reframe-panel .arp-analyze-btn:disabled {
  background: #444;
  color: #666;
  cursor: not-allowed;
}

.auto-reframe-panel .arp-hint {
  color: #555;
  font-size: 10px;
  text-align: center;
  margin-top: 2px;
}

/* Progress bar */
.auto-reframe-panel .arp-progress-wrap {
  background: #111;
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}

.auto-reframe-panel .arp-progress-bar {
  height: 100%;
  background: #e94560;
  transition: width 0.2s;
}

/* Split preview */
.auto-reframe-panel .arp-preview-row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.auto-reframe-panel .arp-preview-orig {
  flex: 1;
}

.auto-reframe-panel .arp-preview-orig-label,
.auto-reframe-panel .arp-preview-result-label {
  font-size: 9px;
  color: #555;
  margin-bottom: 3px;
}

.auto-reframe-panel .arp-preview-orig-frame {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #111;
  border-radius: 3px;
  overflow: hidden;
}

.auto-reframe-panel .arp-preview-orig-frame img,
.auto-reframe-panel .arp-preview-orig-frame video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.auto-reframe-panel .arp-crop-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  border: 2px solid #e94560;
  border-radius: 1px;
  pointer-events: none;
  transition: left 0.1s, width 0.1s;
}

.auto-reframe-panel .arp-preview-result-wrap {
  width: 52px;
  flex-shrink: 0;
}

.auto-reframe-panel .arp-preview-result-frame {
  background: #111;
  border-radius: 3px;
  overflow: hidden;
}

/* Mini crop path timeline */
.auto-reframe-panel .arp-crop-path {
  background: #0d0d1a;
  border-radius: 4px;
  padding: 6px;
}

.auto-reframe-panel .arp-crop-path svg {
  display: block;
  width: 100%;
}

.auto-reframe-panel .arp-time-labels {
  display: flex;
  justify-content: space-between;
  font-size: 8px;
  color: #444;
  margin-top: 2px;
}

/* Quick correction bar */
.auto-reframe-panel .arp-correction {
  background: #16213e;
  border-radius: 4px;
  padding: 8px;
}

.auto-reframe-panel .arp-correction-label {
  font-size: 9px;
  color: #888;
  margin-bottom: 5px;
}

.auto-reframe-panel .arp-correction-source {
  color: #e94560;
}

.auto-reframe-panel .arp-correction-buttons {
  display: flex;
  gap: 4px;
}

.auto-reframe-panel .arp-correction-buttons button {
  flex: 1;
  padding: 4px 0;
  background: #1a1a2e;
  border: 1px solid #333;
  color: #666;
  border-radius: 3px;
  font-size: 10px;
  cursor: pointer;
}

.auto-reframe-panel .arp-correction-buttons button.active {
  background: #e94560;
  border-color: #e94560;
  color: #fff;
  font-weight: 600;
}

/* Apply buttons */
.auto-reframe-panel .arp-apply-btn {
  width: 100%;
  padding: 8px;
  background: #2d9a57;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.auto-reframe-panel .arp-apply-btn:disabled {
  background: #444;
  color: #666;
  cursor: not-allowed;
}

.auto-reframe-panel .arp-open-comp-btn {
  width: 100%;
  padding: 6px;
  background: transparent;
  border: 1px solid #333;
  color: #888;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}

.auto-reframe-panel .arp-open-comp-btn:hover {
  border-color: #555;
  color: #aaa;
}

.auto-reframe-panel .arp-error {
  color: #e94560;
  font-size: 11px;
  background: #2a0d12;
  border: 1px solid #e9456040;
  border-radius: 4px;
  padding: 8px;
}
```

- [ ] **Step 2: Create `src/components/panels/AutoReframePanel.tsx`**

```tsx
import { useState, useCallback, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { analyzeClipForReframe } from '../../services/reframeAnalyzer';
import {
  buildCropPath,
  getTargetDimensions,
  type TargetAspectRatio,
  type SmoothingLevel,
  type CropPath,
} from '../../services/reframeCropPathBuilder';
import type { ReframeAnalysis } from '../../types/index';
import type { Composition } from '../../stores/mediaStore/types';
import './AutoReframePanel.css';

type PanelState = 'idle' | 'analyzing' | 'ready' | 'applying' | 'error';

export function AutoReframePanel() {
  const selectedClipIds = useTimelineStore(s => s.selectedClipIds);
  const clips = useTimelineStore(s => s.clips);
  const files = useMediaStore(s => s.files);

  const [targetRatio, setTargetRatio] = useState<TargetAspectRatio>('9:16');
  const [smoothing, setSmoothing] = useState<SmoothingLevel>('medium');
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<ReframeAnalysis | null>(null);
  const [cropPath, setCropPath] = useState<CropPath | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [createdCompId, setCreatedCompId] = useState<string | null>(null);

  const cancelRef = useRef(false);

  // Resolve the selected video clip + its source media file
  const selectedClip = useMemo(() => {
    const id = selectedClipIds[0];
    return id ? clips.find(c => c.id === id) : undefined;
  }, [selectedClipIds, clips]);

  const mediaFile = useMemo(() => {
    if (!selectedClip?.mediaFileId) return undefined;
    return files.find(f => f.id === selectedClip.mediaFileId);
  }, [selectedClip, files]);

  const isVideoClip = !!mediaFile?.file && mediaFile.type === 'video';

  // ── Analyze ───────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!mediaFile?.id) return;
    cancelRef.current = false;
    setPanelState('analyzing');
    setProgress(0);
    setErrorMsg('');
    setAnalysis(null);
    setCropPath(null);

    try {
      const result = await analyzeClipForReframe(mediaFile.id, pct => {
        if (!cancelRef.current) setProgress(pct);
      });

      if (cancelRef.current) return;

      const srcW = mediaFile.width ?? 1920;
      const srcH = mediaFile.height ?? 1080;
      const path = buildCropPath(result, srcW, srcH, targetRatio, smoothing);

      setAnalysis(result);
      setCropPath(path);
      setPanelState('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPanelState('error');
    }
  }, [mediaFile, targetRatio, smoothing]);

  // Recompute crop path when format/smoothing changes after analysis
  const recomputeCropPath = useCallback((ratio: TargetAspectRatio, smooth: SmoothingLevel) => {
    if (!analysis || !mediaFile) return;
    const srcW = mediaFile.width ?? 1920;
    const srcH = mediaFile.height ?? 1080;
    setCropPath(buildCropPath(analysis, srcW, srcH, ratio, smooth));
  }, [analysis, mediaFile]);

  const handleRatioChange = (r: TargetAspectRatio) => {
    setTargetRatio(r);
    if (panelState === 'ready') recomputeCropPath(r, smoothing);
  };

  const handleSmoothingChange = (s: SmoothingLevel) => {
    setSmoothing(s);
    if (panelState === 'ready') recomputeCropPath(targetRatio, s);
  };

  // ── Quick position override at playhead ───────────────────────────────────

  const playheadTime = useTimelineStore(s => s.playheadPosition);

  const handleQuickCorrection = useCallback((xFraction: number) => {
    if (!cropPath || !mediaFile) return;
    const srcW = mediaFile.width ?? 1920;
    const srcH = mediaFile.height ?? 1080;
    const { width: compW, height: compH } = getTargetDimensions(targetRatio);
    const scale = compH / srcH;
    const maxOffset = (srcW * scale - compW) / 2;
    const positionX = (xFraction - 0.5) * 2 * maxOffset;

    // Insert or replace keyframe nearest to playhead
    const clipLocalTime = selectedClip
      ? Math.max(0, playheadTime - selectedClip.startTime)
      : playheadTime;

    setCropPath(prev => {
      if (!prev) return prev;
      const filtered = prev.keyframes.filter(kf => Math.abs(kf.time - clipLocalTime) > 0.1);
      const updated = [...filtered, { time: clipLocalTime, positionX, easing: 'ease-in-out' as const }]
        .sort((a, b) => a.time - b.time);
      return { ...prev, keyframes: updated };
    });
  }, [cropPath, mediaFile, targetRatio, playheadTime, selectedClip]);

  // ── Create composition ────────────────────────────────────────────────────

  const handleApply = useCallback(async () => {
    if (!cropPath || !mediaFile?.file || !selectedClip) return;
    setPanelState('applying');
    setErrorMsg('');

    try {
      const { width, height } = getTargetDimensions(targetRatio);
      const compName = `Reframe ${targetRatio} — ${mediaFile.name.replace(/\.[^.]+$/, '')}`;

      // 1. Remember current composition
      const mediaState = useMediaStore.getState();
      const previousCompId = mediaState.activeCompositionId;

      // 2. Create composition
      const comp: Composition = mediaState.createComposition(compName, {
        width,
        height,
        duration: mediaFile.duration ?? 60,
      });

      // 3. Open + activate composition
      useMediaStore.setState(s => ({
        openCompositionIds: s.openCompositionIds.includes(comp.id)
          ? s.openCompositionIds
          : [...s.openCompositionIds, comp.id],
      }));
      mediaState.setActiveComposition(comp.id);

      // 4. Wait for timeline to load
      await new Promise<void>(resolve => setTimeout(resolve, 150));

      // 5. Add clip to composition
      const ts = useTimelineStore.getState();
      const videoTrack = ts.tracks.find(t => t.type === 'video');
      if (!videoTrack) throw new Error('No video track in composition');

      await ts.addClip(videoTrack.id, mediaFile.file!, 0, mediaFile.duration ?? 60, mediaFile.id);

      // 6. Find the newly-added clip
      const addedClip = useTimelineStore.getState().clips
        .filter(c => c.trackId === videoTrack.id)
        .sort((a, b) => b.startTime - a.startTime)[0];
      if (!addedClip) throw new Error('Clip not found after adding');

      // 7. Set scale
      useTimelineStore.getState().updateClipTransform(addedClip.id, {
        scale: { x: cropPath.scale, y: cropPath.scale },
      });

      // 8. Write position.x keyframes
      for (const kf of cropPath.keyframes) {
        useTimelineStore.getState().addKeyframe(
          addedClip.id,
          'position.x',
          kf.positionX,
          kf.time,
          kf.easing
        );
      }

      // 9. Save timeline state back to composition
      const timelineData = useTimelineStore.getState().getSerializableState();
      useMediaStore.setState(s => ({
        compositions: s.compositions.map(c =>
          c.id === comp.id ? { ...c, timelineData } : c
        ),
      }));

      // 10. Restore previous composition
      if (previousCompId) {
        useMediaStore.getState().setActiveComposition(previousCompId);
        await new Promise<void>(resolve => setTimeout(resolve, 50));
      }

      // 11. Add comp clip to main timeline at the source clip's position
      const mainTs = useTimelineStore.getState();
      const mainVideoTrack = mainTs.tracks.find(t => t.type === 'video');
      if (mainVideoTrack) {
        mainTs.addCompClip(mainVideoTrack.id, comp, selectedClip.startTime);
      }

      setCreatedCompId(comp.id);
      setPanelState('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPanelState('error');
    }
  }, [cropPath, mediaFile, selectedClip, targetRatio]);

  // ── Open composition in timeline ──────────────────────────────────────────

  const handleOpenComp = useCallback(() => {
    if (!createdCompId) return;
    const comp = useMediaStore.getState().compositions.find(c => c.id === createdCompId);
    if (!comp) return;
    useMediaStore.setState(s => ({
      openCompositionIds: s.openCompositionIds.includes(comp.id)
        ? s.openCompositionIds
        : [...s.openCompositionIds, comp.id],
    }));
    useMediaStore.getState().setActiveComposition(comp.id);
  }, [createdCompId]);

  // ── Crop overlay position (for split preview) ─────────────────────────────

  const cropOverlayStyle = useMemo(() => {
    if (!cropPath || !mediaFile) return { left: '25%', width: '50%' };
    const srcW = mediaFile.width ?? 1920;
    const srcH = mediaFile.height ?? 1080;
    const { width: compW, height: compH } = getTargetDimensions(targetRatio);
    const scale = compH / srcH;
    const scaledW = srcW * scale;
    const cropWidthPct = (compW / scaledW) * 100;
    // Use first keyframe as representative position
    const firstKf = cropPath.keyframes[0];
    const maxOffset = (scaledW - compW) / 2;
    const centerX = firstKf ? 0.5 + firstKf.positionX / (2 * maxOffset) : 0.5;
    const leftPct = Math.max(0, Math.min(100 - cropWidthPct, (centerX - cropWidthPct / 200) * 100));
    return { left: `${leftPct}%`, width: `${cropWidthPct}%` };
  }, [cropPath, mediaFile, targetRatio]);

  // ── Mini crop path SVG ────────────────────────────────────────────────────

  const svgPath = useMemo(() => {
    if (!cropPath || cropPath.keyframes.length === 0) return '';
    const kfs = cropPath.keyframes;
    const duration = kfs[kfs.length - 1].time || 1;
    const svgW = 200;
    const svgH = 32;
    const maxOffset = Math.max(...kfs.map(k => Math.abs(k.positionX))) || 1;

    const points = kfs.map(kf => {
      const x = (kf.time / duration) * svgW;
      const y = svgH / 2 - (kf.positionX / maxOffset) * (svgH / 2 - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${points.join(' L')}`;
  }, [cropPath]);

  // ── Render ────────────────────────────────────────────────────────────────

  const estimatedSeconds = mediaFile
    ? Math.round((mediaFile.duration ?? 0) * 0.08)
    : 0;

  return (
    <div className="auto-reframe-panel">
      <div>
        <div className="arp-section-label">Hedef Format</div>
        <div className="arp-pills">
          {(['9:16', '1:1', '4:5'] as TargetAspectRatio[]).map(r => (
            <button
              key={r}
              className={`arp-pill ${targetRatio === r ? 'active' : ''}`}
              onClick={() => handleRatioChange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="arp-section-label">Geçiş Yumuşatma</div>
        <div className="arp-pills">
          {(['low', 'medium', 'high'] as SmoothingLevel[]).map((s, i) => (
            <button
              key={s}
              className={`arp-pill ${smoothing === s ? 'active' : ''}`}
              onClick={() => handleSmoothingChange(s)}
            >
              {['Az', 'Orta', 'Çok'][i]}
            </button>
          ))}
        </div>
      </div>

      {panelState === 'idle' || panelState === 'error' ? (
        <>
          <button
            className="arp-analyze-btn"
            onClick={handleAnalyze}
            disabled={!isVideoClip}
          >
            {isVideoClip ? '▶ Analiz Et' : 'Video clip seç'}
          </button>
          {isVideoClip && (
            <div className="arp-hint">
              ~{estimatedSeconds}s · {Math.ceil(((mediaFile?.duration ?? 0) * 1000) / 500)} frame
            </div>
          )}
          {!isVideoClip && (
            <div className="arp-hint">Timeline'dan bir video clip seç</div>
          )}
          {panelState === 'error' && (
            <div className="arp-error">{errorMsg}</div>
          )}
        </>
      ) : null}

      {panelState === 'analyzing' && (
        <div>
          <div className="arp-section-label">Analiz ediliyor… {progress}%</div>
          <div className="arp-progress-wrap">
            <div className="arp-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {(panelState === 'ready' || panelState === 'applying') && cropPath && mediaFile && (
        <>
          {/* Split preview */}
          <div>
            <div className="arp-preview-row">
              <div className="arp-preview-orig">
                <div className="arp-preview-orig-label">Orijinal</div>
                <div className="arp-preview-orig-frame">
                  <div className="arp-crop-overlay" style={cropOverlayStyle} />
                </div>
              </div>
              <div className="arp-preview-result-wrap">
                <div className="arp-preview-result-label">
                  {targetRatio}
                </div>
                <div
                  className="arp-preview-result-frame"
                  style={{ aspectRatio: targetRatio === '9:16' ? '9/16' : targetRatio === '1:1' ? '1/1' : '4/5' }}
                />
              </div>
            </div>
          </div>

          {/* Mini crop path timeline */}
          <div className="arp-crop-path">
            <div className="arp-section-label">Kadraj Yolu</div>
            <svg viewBox={`0 0 200 32`} height="32">
              <line x1="0" y1="16" x2="200" y2="16" stroke="#222" strokeWidth="1" />
              {svgPath && (
                <path d={svgPath} stroke="#e94560" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              )}
              {cropPath.keyframes.map((kf, i) => {
                const duration = cropPath.keyframes[cropPath.keyframes.length - 1].time || 1;
                const maxOffset = Math.max(...cropPath.keyframes.map(k => Math.abs(k.positionX))) || 1;
                const x = (kf.time / duration) * 200;
                const y = 16 - (kf.positionX / maxOffset) * 12;
                return (
                  <circle key={i} cx={x} cy={y} r="3" fill="#e94560" stroke="#fff" strokeWidth="1" />
                );
              })}
            </svg>
            <div className="arp-time-labels">
              <span>0s</span>
              <span>{((mediaFile.duration ?? 0) / 2).toFixed(0)}s</span>
              <span>{(mediaFile.duration ?? 0).toFixed(0)}s</span>
            </div>
          </div>

          {/* Quick correction */}
          <div className="arp-correction">
            <div className="arp-correction-label">
              Bu an — <span className="arp-correction-source">hızlı düzelt</span>
            </div>
            <div className="arp-correction-buttons">
              <button onClick={() => handleQuickCorrection(0.15)}>◀ Sol</button>
              <button onClick={() => handleQuickCorrection(0.5)}>Orta</button>
              <button onClick={() => handleQuickCorrection(0.85)}>Sağ ▶</button>
            </div>
          </div>

          <button
            className="arp-apply-btn"
            onClick={handleApply}
            disabled={panelState === 'applying'}
          >
            {panelState === 'applying' ? 'Oluşturuluyor…' : '✓ Kompozisyon Oluştur'}
          </button>

          {createdCompId && (
            <button className="arp-open-comp-btn" onClick={handleOpenComp}>
              ⬡ Kompozisyonda Aç →
            </button>
          )}

          {panelState === 'error' && (
            <div className="arp-error">{errorMsg}</div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build to verify no type errors**

```bash
npm run build 2>&1 | grep -E "error TS" | head -10
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/panels/AutoReframePanel.tsx src/components/panels/AutoReframePanel.css
git commit -m "feat(auto-reframe): add AutoReframePanel UI with analyze, preview, and composition creation"
```

---

## Task 5: Dock wiring

**Files:**
- Modify: `src/components/dock/DockPanelContent.tsx`

- [ ] **Step 1: Add the import and case to `DockPanelContent.tsx`**

At the top of the file, add the import alongside other panel imports:

```ts
import { AutoReframePanel } from '../panels/AutoReframePanel';
```

In the `switch` statement, add before the `default` case:

```ts
    case 'auto-reframe':
      return <Suspense fallback={<PanelLoading />}><AutoReframePanel /></Suspense>;
```

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | grep -E "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
npm run test 2>&1 | tail -8
```

Expected: all tests pass (including the new ones from Tasks 2 and 3).

- [ ] **Step 4: Run lint**

```bash
npx eslint . 2>&1 | grep -E "^\s.*error" | head -10
```

Expected: 0 errors.

- [ ] **Step 5: Manual test**

1. `npm run dev`
2. Open http://localhost:5173
3. Go to **View → Panels → Auto Reframe** to open the panel
4. Import a landscape (16:9) video into the Media panel
5. Place it on the timeline, click to select it
6. In the Auto Reframe panel: select **9:16**, smoothing **Orta**, click **Analiz Et**
7. Verify the progress bar fills and panel switches to "ready" state
8. Verify the crop overlay on the split preview and the SVG crop path appear
9. Click **Kompozisyon Oluştur**
10. Verify a new composition clip appears on the timeline
11. Click **Kompozisyonda Aç** — the composition timeline should open with the clip scaled and position.x keyframes visible

- [ ] **Step 6: Commit**

```bash
git add src/components/dock/DockPanelContent.tsx
git commit -m "feat(auto-reframe): wire AutoReframePanel into dock system"
```

---

## Self-Review Checklist

After all tasks are complete, verify:
- [ ] `npm run build` — no errors
- [ ] `npx eslint .` — 0 errors
- [ ] `npm run test` — all tests pass
- [ ] Panel opens from View → Panels → Auto Reframe
- [ ] Analyze runs on a selected video clip
- [ ] Composition is created with correct aspect ratio
- [ ] Composition clip is placed on main timeline at source clip position
- [ ] Position.x keyframes exist in the composition (visible in keyframe editor)
- [ ] Sol/Orta/Sağ correction buttons modify the crop path
