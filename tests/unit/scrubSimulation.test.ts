import { describe, expect, it } from 'vitest';
import {
  createScrubPlan,
  sampleScrubPlan,
} from '../../src/services/aiTools/scrubSimulation';

describe('scrubSimulation', () => {
  it('builds a short scrub around the current playhead with the selected speed', () => {
    const plan = createScrubPlan(
      {
        pattern: 'short',
        speed: 'fast',
        rangeSeconds: 3,
        durationMs: 900,
      },
      12,
      60
    );

    expect(plan.pattern).toBe('short');
    expect(plan.speed).toBe('fast');
    expect(plan.minTime).toBe(9);
    expect(plan.maxTime).toBe(15);
    expect(plan.segmentDurationMs).toBe(140);
    expect(plan.points[0]).toBe(12);
    expect(plan.points).toContain(9);
    expect(plan.points).toContain(15);
  });

  it('builds deterministic random scrubs from the same seed', () => {
    const first = createScrubPlan(
      {
        pattern: 'random',
        speed: 'wild',
        durationMs: 500,
        minTime: 5,
        maxTime: 25,
        seed: 99,
      },
      10,
      30
    );
    const second = createScrubPlan(
      {
        pattern: 'random',
        speed: 'wild',
        durationMs: 500,
        minTime: 5,
        maxTime: 25,
        seed: 99,
      },
      10,
      30
    );

    expect(first.points).toEqual(second.points);
    expect(first.points[0]).toBe(10);
    expect(first.points.every((value) => value >= 5 && value <= 25)).toBe(true);
  });

  it('interpolates smoothly across custom scrub points', () => {
    const plan = createScrubPlan(
      {
        pattern: 'custom',
        durationMs: 1000,
        points: [8, 2, 14],
      },
      5,
      20
    );

    expect(plan.points).toEqual([5, 8, 2, 14]);
    expect(plan.segmentDurationMs).toBe(333);
    expect(sampleScrubPlan(plan, 0)).toBe(5);
    expect(sampleScrubPlan(plan, 333)).toBeCloseTo(8, 3);
    expect(sampleScrubPlan(plan, 666)).toBeCloseTo(2, 3);
    expect(sampleScrubPlan(plan, 1000)).toBeCloseTo(14, 3);
  });
});
