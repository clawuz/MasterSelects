import type { ReframeAnalysis, ReframeAnalysisFrame } from '../types/index';
import { useMediaStore } from '../stores/mediaStore';
import { Logger } from './logger';

const log = Logger.create('ReframeAnalyzer');

const CANVAS_WIDTH = 160;
const CANVAS_HEIGHT = 90;
const MOTION_THRESHOLD = 800;
const MOTION_GRID_COLS = 4;

// ─── MediaPipe singleton ──────────────────────────────────────────────────────

let faceDetector: import('@mediapipe/tasks-vision').FaceDetector | null = null;
let faceDetectorLoading = false;
let faceDetectorFailed = false;

async function getFaceDetector(): Promise<import('@mediapipe/tasks-vision').FaceDetector | null> {
  if (faceDetector) return faceDetector;
  if (faceDetectorFailed) return null;
  if (faceDetectorLoading) {
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (!faceDetectorLoading) { clearInterval(interval); resolve(); }
      }, 100);
    });
    return faceDetector;
  }

  faceDetectorLoading = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision') as any;
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
    faceDetector?.close?.();
    faceDetector = null;
    faceDetectorLoading = false;
    faceDetectorFailed = false;
  });
}

// ─── Motion center helper (exported for tests) ───────────────────────────────

export function computeMotionCenterX(curr: ImageData, prev: ImageData): number | null {
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
  if (total < MOTION_THRESHOLD) return null;

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

  const detector = await getFaceDetector();

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = (detector as any).detect(canvas);
          if (result.detections.length > 0) {
            const bbox = result.detections[0].boundingBox!;
            attentionX = Math.max(0, Math.min(1, (bbox.originX + bbox.width / 2) / canvas.width));
            attentionSource = 'face';
          }
        } catch { /* face detection failure is non-fatal */ }
      }

      // 2. Scene cut detection (independent of face detection)
      if (prevFrame) {
        const totalDiff = Array.from(frame.data).reduce((sum, v, idx) => {
          return idx % 4 === 3 ? sum : sum + Math.abs(v - prevFrame!.data[idx]);
        }, 0);
        isSceneCut = totalDiff / (canvas.width * canvas.height) > 50;
      }

      // 3. Motion fallback (only when no face detected)
      if (attentionSource !== 'face' && prevFrame) {
        const motionX = computeMotionCenterX(frame, prevFrame);
        if (motionX !== null) {
          attentionX = motionX;
          attentionSource = 'motion';
        }
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
