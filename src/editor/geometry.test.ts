import { describe, expect, it } from 'vitest';
import { centeredCrop, displayCrop, geometryLayout, snapCrop, sourceCrop } from './geometry';

describe('crop geometry', () => {
  it('round-trips selections between rotated display and source coordinates', () => {
    const crop = { x: 0.1, y: 0.2, width: 0.4, height: 0.5 };
    for (let rotation = 0; rotation < 4; rotation++) {
      const result = sourceCrop(displayCrop(crop, rotation), rotation);
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(result[key]).toBeCloseTo(crop[key], 12);
    }
  });
  it('snaps edges to source pixels and accounts for rotation in export dimensions', () => {
    const crop = snapCrop(centeredCrop(400, 300, 1), 400, 300);
    expect(crop).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
    const layout = geometryLayout(400, 300, { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, rotation: 1 });
    expect([layout.width, layout.height]).toEqual([150, 200]);
    expect(() => geometryLayout(400, 300, { crop: { ...crop, x: 1 }, rotation: 0 })).toThrow();
  });
});
