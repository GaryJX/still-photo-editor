import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

async function openPhoto(page: Page) {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'detail.png', mimeType: 'image/png', buffer: makePng(2400, 1800, true) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '1600');
}
async function guarded(page: Page) {
  return page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
}
async function pan(page: Page) {
  const bounds = (await page.locator('.comparison-preview').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.5, { steps: 5 });
  await page.mouse.up();
}

test('zoom, pan, and comparison work together without creating edits', async ({ page }) => {
  await openPhoto(page);
  const preview = page.locator('.comparison-preview');
  const divider = page.getByRole('slider', { name: 'Before and after comparison' });
  await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect(page.getByLabel('Image zoom', { exact: true })).toHaveText('100%');
  await expect(page.locator('[data-detail="edited"]')).toBeAttached();
  await pan(page);
  expect(Number(await preview.getAttribute('data-pan-x'))).toBeLessThan(0);
  expect(Number(await preview.getAttribute('data-pan-y'))).toBeLessThan(0);
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  const bounds = (await preview.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x - 20, bounds.y + bounds.height / 2); await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '0');
  // The handle remains reachable at either endpoint while zoomed.
  await divider.hover(); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width + 20, bounds.y + bounds.height / 2); await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '100');
  await preview.focus();
  const x = Number(await preview.getAttribute('data-pan-x'));
  await preview.press('ArrowLeft');
  expect(Number(await preview.getAttribute('data-pan-x'))).toBeCloseTo(x + 30, 4);
  expect(await guarded(page)).toBe(false);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(preview).toHaveAttribute('data-zoom', '1');
  await expect(preview).toHaveAttribute('data-pan-x', '0');
  await expect(page.locator('[data-detail]')).toHaveCount(0);
  await preview.hover(); await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await preview.getAttribute('data-zoom'))).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await expect(preview).toHaveAttribute('data-zoom', '1');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'detail.png', mimeType: 'image/png', buffer: makePng(2400, 1800) });
  await expect(preview).toHaveAttribute('data-zoom', '1');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
});

test('native detail matches the full export after framing and editing', async ({ page }) => {
  await openPhoto(page);
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.getByLabel('Crop aspect ratio', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-output-width', '1800');
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await pan(page);
  const tile = page.locator('[data-detail="edited"]');
  await expect(tile).toBeAttached();
  // Compare an entire source-resolution region, not just a flat-color sample.
  const region = JSON.parse((await tile.getAttribute('data-region'))!);
  expect(region.outputWidth).toBe(region.width); expect(region.outputHeight).toBe(region.height);
  expect(region.width).toBeLessThanOrEqual(2048);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const bytes = await readFile((await (await pending).path())!);
  await expect(tile).toBeAttached();
  const result = await page.evaluate(async ({ base64, region }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const exported = ctx.getImageData(region.x, region.y, region.width, region.height).data;
    const tile = document.querySelector<HTMLCanvasElement>('[data-detail="edited"]')!;
    const detail = tile.getContext('2d')!.getImageData(0, 0, tile.width, tile.height).data;
    const original = document.querySelector<HTMLCanvasElement>('[data-detail="original"]')!;
    const pixel = Array.from(original.getContext('2d')!.getImageData(0, 0, 1, 1).data);
    // Source crop starts x=300; clockwise rotation maps (dx,dy) to (dy,1799-dx).
    const sx = 300 + region.y, sy = 1799 - region.x;
    return { matches: exported.length === detail.length && exported.every((n, i) => n === detail[i]), pixel, expected: [Math.round(sx / 2400 * 255), Math.round(sy / 1800 * 255), (sx + sy) % 256, 255], width: canvas.width };
  }, { base64: bytes.toString('base64'), region });
  expect(result.matches).toBe(true); expect(result.pixel).toEqual(result.expected); expect(result.width).toBe(1800);
  await pan(page);
  expect(await guarded(page)).toBe(false);
  // Further recipe changes must replace the zoomed detail, including undo.
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '2');
  await expect(tile).toHaveAttribute('data-recipe', (await page.locator('[data-preview]').getAttribute('data-recipe'))!);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  await expect(tile).toHaveAttribute('data-recipe', (await page.locator('[data-preview]').getAttribute('data-recipe'))!);
  expect(await guarded(page)).toBe(false);
});

test.describe('touch zoom', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('touch controls and two-pointer pinch keep the comparison aligned', async ({ page }) => {
    await openPhoto(page);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).tap();
    const preview = page.locator('.comparison-preview');
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toHaveAttribute('data-zoom', '1.5');
    // Playwright has single-touch taps but no portable multi-touch gesture API.
    // Exercise pointer gesture handling synthetically; real-device coverage is separate.
    await preview.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const capture = element.setPointerCapture;
      element.setPointerCapture = () => {};
      const send = (type: string, id: number, x: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', button: 0, clientX: bounds.x + bounds.width * x, clientY: bounds.y + bounds.height / 2 }));
      send('pointerdown', 101, 0.3); send('pointerdown', 102, 0.7);
      send('pointermove', 101, 0.1); send('pointermove', 102, 0.9);
      send('pointerup', 101, 0.1); send('pointerup', 102, 0.9);
      element.setPointerCapture = capture;
    });
    await expect.poll(async () => Number(await preview.getAttribute('data-zoom'))).toBeCloseTo(3, 3);
    await expect(page.getByRole('slider', { name: 'Before and after comparison' })).toHaveAttribute('aria-valuenow', '50');
    await expect(page.locator('[data-detail="edited"]')).toBeAttached();
    await expect(page.locator('.comparison-line')).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'Fit', exact: true }).tap();
    await expect(preview).toHaveAttribute('data-zoom', '1');
    expect(await guarded(page)).toBe(false);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const caption = (await page.locator('.photo-caption').boundingBox())!;
    const actions = (await page.locator('.comparison-actions').boundingBox())!;
    expect(caption.y + caption.height).toBeLessThanOrEqual(actions.y);
  });
});
