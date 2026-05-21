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

// Minimum UV change to emit a new keyframe (≈4px out of 1920)
const KEYFRAME_THRESHOLD_UV = 0.002;

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

  // The compositor shader applies aspect-ratio correction independently, so the
  // scale that achieves "fill height" is sourceAspect / outputAspect, not compH/srcH.
  // positionX is a UV-space offset: posX = 0.5 − smoothedAttentionX
  // (positive posX pans the visible crop window left; negative pans right).
  const sourceAspect = sourceWidth / sourceHeight;
  const outputAspect = compW / compH;
  const scale = sourceAspect / outputAspect;

  // Maximum UV pan before the crop window would go out of source bounds
  const halfVisible = 0.5 / scale;
  const maxPan = Math.max(0, 0.5 - halfVisible);

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
      // UV offset: 0 = centered, positive = pan left, negative = pan right
      const positionX = Math.max(-maxPan, Math.min(maxPan, 0.5 - smoothed));
      smoothedPositions.push({ time: segment[i].timestamp, positionX });
    }
  }

  // Reduce keyframes: only emit when positionX changes > UV threshold
  const keyframes: CropKeyframe[] = [];
  let lastEmittedX: number | null = null;

  for (let i = 0; i < smoothedPositions.length; i++) {
    const { time, positionX } = smoothedPositions[i];
    const isFirst = i === 0;
    const isLast = i === smoothedPositions.length - 1;
    const changed = lastEmittedX === null || Math.abs(positionX - lastEmittedX) > KEYFRAME_THRESHOLD_UV;

    if (isFirst || isLast || changed) {
      keyframes.push({ time, positionX, easing: 'ease-in-out' });
      lastEmittedX = positionX;
    }
  }

  return { scale, keyframes };
}
