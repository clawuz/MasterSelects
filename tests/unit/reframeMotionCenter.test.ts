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
