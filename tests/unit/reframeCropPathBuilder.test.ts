import { describe, it, expect } from 'vitest';
import {
  buildCropPath,
  getTargetDimensions,
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
  it('scale = sourceAspect / outputAspect for 9:16 given 1920×1080 source', () => {
    const path = buildCropPath(makeAnalysis([0.5]), 1920, 1080, '9:16', 'low');
    // sourceAspect = 1920/1080, outputAspect = 1080/1920
    const expected = (1920 / 1080) / (1080 / 1920);
    expect(path.scale).toBeCloseTo(expected);
  });

  it('positionX ≈ 0 when attentionX = 0.5 (center)', () => {
    const path = buildCropPath(makeAnalysis([0.5, 0.5, 0.5]), 1920, 1080, '9:16', 'low');
    path.keyframes.forEach(kf => expect(kf.positionX).toBeCloseTo(0, 1));
  });

  it('positionX > 0 when attentionX = 0 (subject left → pan crop left)', () => {
    const path = buildCropPath(makeAnalysis([0, 0, 0]), 1920, 1080, '9:16', 'low');
    path.keyframes.forEach(kf => expect(kf.positionX).toBeGreaterThan(0));
  });

  it('positionX < 0 when attentionX = 1 (subject right → pan crop right)', () => {
    const path = buildCropPath(makeAnalysis([1, 1, 1]), 1920, 1080, '9:16', 'low');
    path.keyframes.forEach(kf => expect(kf.positionX).toBeLessThan(0));
  });

  it('emits fewer keyframes than frames for constant attention', () => {
    const path = buildCropPath(makeAnalysis(new Array(20).fill(0.5)), 1920, 1080, '9:16', 'low');
    expect(path.keyframes.length).toBeLessThan(20);
  });

  it('scene cut produces a jump: positions differ across the cut', () => {
    // 3 frames left (0.0), then scene cut, 3 frames right (1.0)
    const analysis = makeAnalysis([0, 0, 0, 1, 1, 1], [3]);
    const path = buildCropPath(analysis, 1920, 1080, '9:16', 'high');
    const beforeCut = path.keyframes.filter(kf => kf.time < 1.5);
    const afterCut = path.keyframes.filter(kf => kf.time >= 1.5);
    if (beforeCut.length > 0 && afterCut.length > 0) {
      const lastBefore = beforeCut[beforeCut.length - 1].positionX;
      const firstAfter = afterCut[0].positionX;
      // left frames → posX > 0; right frames → posX < 0
      expect(firstAfter).toBeLessThan(lastBefore);
    }
  });

  it('all keyframes use ease-in-out easing', () => {
    const path = buildCropPath(makeAnalysis([0, 0.5, 1, 0.5, 0]), 1920, 1080, '9:16', 'medium');
    path.keyframes.forEach(kf => expect(kf.easing).toBe('ease-in-out'));
  });
});
