export type ScrubPattern = 'short' | 'long' | 'random' | 'custom';
export type ScrubSpeed = 'slow' | 'normal' | 'fast' | 'wild';

export interface ScrubPlan {
  pattern: ScrubPattern;
  speed: ScrubSpeed;
  currentTime: number;
  minTime: number;
  maxTime: number;
  totalDurationMs: number;
  segmentDurationMs: number;
  points: number[];
  seed: number;
}

const DEFAULT_DURATION_MS: Record<ScrubPattern, number> = {
  short: 1400,
  long: 3200,
  random: 2600,
  custom: 1800,
};

const DEFAULT_SEGMENT_MS: Record<ScrubSpeed, number> = {
  slow: 520,
  normal: 260,
  fast: 140,
  wild: 80,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function roundMillis(value: number): number {
  return Math.max(16, Math.round(value));
}

function normalizePattern(value: unknown): ScrubPattern {
  return value === 'short' || value === 'long' || value === 'random' || value === 'custom'
    ? value
    : 'short';
}

function normalizeSpeed(value: unknown): ScrubSpeed {
  return value === 'slow' || value === 'normal' || value === 'fast' || value === 'wild'
    ? value
    : 'normal';
}

function sanitizeSeed(value: unknown): number {
  const fallback = 12345;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return (Math.floor(value) >>> 0) || fallback;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeCustomPoints(
  points: unknown,
  currentTime: number,
  minTime: number,
  maxTime: number
): number[] {
  const safePoints = Array.isArray(points)
    ? points
      .map((value) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, minTime, maxTime) : null))
      .filter((value): value is number => value !== null)
    : [];

  const normalized = safePoints.length > 0 ? safePoints : [currentTime];
  if (Math.abs(normalized[0] - currentTime) > 0.001) {
    normalized.unshift(currentTime);
  }
  if (normalized.length === 1) {
    normalized.push(normalized[0]);
  }
  return normalized;
}

function buildPresetPoints(
  pattern: Exclude<ScrubPattern, 'custom'>,
  currentTime: number,
  minTime: number,
  maxTime: number,
  pointCount: number,
  seed: number
): number[] {
  const safePointCount = Math.max(2, pointCount);
  const points = [currentTime];
  const range = Math.max(0, maxTime - minTime);
  const random = createSeededRandom(seed);

  if (range <= 0.0001) {
    while (points.length < safePointCount) {
      points.push(minTime);
    }
    return points;
  }

  if (pattern === 'random') {
    const minDelta = Math.max(range * 0.12, 0.35);
    let previous = currentTime;
    while (points.length < safePointCount) {
      let next = previous;
      for (let attempt = 0; attempt < 6; attempt++) {
        next = minTime + random() * range;
        if (Math.abs(next - previous) >= minDelta || attempt === 5) {
          break;
        }
      }
      points.push(clamp(next, minTime, maxTime));
      previous = points[points.length - 1];
    }
    return points;
  }

  const prefersMax = Math.abs(currentTime - minTime) <= Math.abs(currentTime - maxTime);
  let useMax = prefersMax;
  while (points.length < safePointCount) {
    points.push(useMax ? maxTime : minTime);
    useMax = !useMax;
  }
  return points;
}

function deriveBounds(
  pattern: ScrubPattern,
  args: Record<string, unknown>,
  currentTime: number,
  durationSeconds: number
): { minTime: number; maxTime: number } {
  const safeDuration = Math.max(0, finiteOr(durationSeconds, 0));
  const requestedMin = typeof args.minTime === 'number' ? args.minTime : undefined;
  const requestedMax = typeof args.maxTime === 'number' ? args.maxTime : undefined;

  if (requestedMin !== undefined || requestedMax !== undefined) {
    const minTime = clamp(finiteOr(requestedMin, 0), 0, safeDuration);
    const maxTime = clamp(finiteOr(requestedMax, safeDuration), minTime, safeDuration);
    return { minTime, maxTime };
  }

  const shortRange = clamp(finiteOr(args.rangeSeconds, 4), 0.5, Math.max(0.5, safeDuration));
  if (pattern === 'short') {
    return {
      minTime: clamp(currentTime - shortRange, 0, safeDuration),
      maxTime: clamp(currentTime + shortRange, 0, safeDuration),
    };
  }

  return {
    minTime: 0,
    maxTime: safeDuration,
  };
}

export function createScrubPlan(
  args: Record<string, unknown>,
  currentTime: number,
  durationSeconds: number
): ScrubPlan {
  const pattern = normalizePattern(args.pattern);
  const speed = normalizeSpeed(args.speed);
  const safeDurationSeconds = Math.max(0, finiteOr(durationSeconds, 0));
  const safeCurrentTime = clamp(finiteOr(currentTime, 0), 0, safeDurationSeconds);
  const { minTime, maxTime } = deriveBounds(pattern, args, safeCurrentTime, safeDurationSeconds);
  const seed = sanitizeSeed(args.seed);

  if (pattern === 'custom') {
    const points = normalizeCustomPoints(args.points, safeCurrentTime, minTime, maxTime);
    const totalDurationMs = roundMillis(
      finiteOr(args.durationMs, DEFAULT_DURATION_MS.custom)
    );
    const segmentDurationMs = roundMillis(totalDurationMs / Math.max(points.length - 1, 1));
    return {
      pattern,
      speed,
      currentTime: safeCurrentTime,
      minTime,
      maxTime,
      totalDurationMs: segmentDurationMs * Math.max(points.length - 1, 1),
      segmentDurationMs,
      points,
      seed,
    };
  }

  const baseSegmentMs = roundMillis(
    finiteOr(args.segmentMs, DEFAULT_SEGMENT_MS[speed])
  );
  const requestedDurationMs = roundMillis(
    finiteOr(args.durationMs, DEFAULT_DURATION_MS[pattern])
  );
  const pointCount = Math.max(2, Math.round(requestedDurationMs / baseSegmentMs) + 1);
  const points = buildPresetPoints(pattern, safeCurrentTime, minTime, maxTime, pointCount, seed);
  const totalDurationMs = baseSegmentMs * Math.max(points.length - 1, 1);

  return {
    pattern,
    speed,
    currentTime: safeCurrentTime,
    minTime,
    maxTime,
    totalDurationMs,
    segmentDurationMs: baseSegmentMs,
    points,
    seed,
  };
}

function easeInOutSine(progress: number): number {
  return -(Math.cos(Math.PI * progress) - 1) / 2;
}

export function sampleScrubPlan(plan: ScrubPlan, elapsedMs: number): number {
  if (plan.points.length === 0) {
    return plan.currentTime;
  }
  if (plan.points.length === 1 || elapsedMs <= 0) {
    return plan.points[0];
  }

  const totalDurationMs = Math.max(plan.totalDurationMs, plan.segmentDurationMs);
  if (elapsedMs >= totalDurationMs) {
    return plan.points[plan.points.length - 1];
  }

  const segmentIndex = Math.min(
    plan.points.length - 2,
    Math.floor(elapsedMs / plan.segmentDurationMs)
  );
  const segmentStartMs = segmentIndex * plan.segmentDurationMs;
  const localProgress = clamp(
    (elapsedMs - segmentStartMs) / plan.segmentDurationMs,
    0,
    1
  );
  const eased = easeInOutSine(localProgress);
  const from = plan.points[segmentIndex];
  const to = plan.points[segmentIndex + 1];
  return from + (to - from) * eased;
}
