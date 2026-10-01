import { expect, test } from 'vitest';
import { boundView, detailRegion, fitView, zoomAt } from './viewport';

test('zoom preserves its anchor and pan never exposes space outside the photo', () => {
  const size = { width: 800, height: 600 };
  expect(zoomAt(fitView(), 2, { x: 200, y: -100 }, size, 8)).toEqual({ zoom: 2, x: -200, y: 100 });
  expect(boundView({ zoom: 2, x: 9000, y: -9000 }, size, 8)).toEqual({ zoom: 2, x: 400, y: -300 });
  expect(zoomAt({ zoom: 2, x: 300, y: -200 }, 0.1, { x: 0, y: 0 }, size, 8)).toEqual(fitView());
});

test('detail windows cover the viewport, stay in source bounds and cap output memory', () => {
  for (const source of [{ width: 6000, height: 4000 }, { width: 1000, height: 8000 }]) {
    const size = { width: source.width / 10, height: source.height / 10 };
    for (const zoom of [1.01, 2, 10, 40]) {
      for (const direction of [-1, 0, 1]) {
        const view = boundView({ zoom, x: direction * 1e6, y: direction * 1e6 }, size, 40);
        const region = detailRegion(view, size, source, 3)!;
        expect(region.x).toBeGreaterThanOrEqual(0); expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.x + region.width).toBeLessThanOrEqual(source.width);
        expect(region.y + region.height).toBeLessThanOrEqual(source.height);
        expect(region.outputWidth).toBeLessThanOrEqual(Math.min(2048, region.width));
        expect(region.outputHeight).toBeLessThanOrEqual(Math.min(2048, region.height));
        if (zoom >= 10) { expect(region.outputWidth).toBe(region.width); expect(region.outputHeight).toBe(region.height); }
      }
    }
  }
  expect(detailRegion(fitView(), { width: 800, height: 600 }, { width: 6000, height: 4000 }, 1)).toBeUndefined();
});
