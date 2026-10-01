import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

async function openPhoto(page: Page) {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'framing.png', mimeType: 'image/png', buffer: makePng(400, 300, true) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '400');
}
async function pixel(page: Page, selector: string) { return page.locator(selector).evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data)); }
async function exported(page: Page) {
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export PNG' }).click();
  const download = await waiting; const buffer = await readFile((await download.path())!);
  return page.evaluate(async encoded => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
    const result = { width: bitmap.width, height: bitmap.height, pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data) }; bitmap.close(); return result;
  }, buffer.toString('base64'));
}

test('crop and rotation keep original, edited, and exported pixels aligned', async ({ page }) => {
  await openPhoto(page);
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.getByLabel('Crop aspect ratio', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '300');
  await expect(page.locator('[data-original]')).toHaveAttribute('width', '300');
  expect(await pixel(page, '[data-preview]')).toEqual([32, 0, 50, 255]);
  expect(await pixel(page, '[data-original]')).toEqual([32, 0, 50, 255]);
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await expect.poll(() => pixel(page, '[data-original]')).toEqual([32, 254, 93, 255]);
  expect(await exported(page)).toEqual({ width: 300, height: 300, pixel: [32, 254, 93, 255] });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => pixel(page, '[data-preview]')).toEqual([32, 0, 50, 255]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '400');
  await expect(page.locator('[data-original]')).toHaveAttribute('width', '400');
});

test('cropping a rotated photo maps to source coordinates and Cancel changes nothing', async ({ page }) => {
  await openPhoto(page);
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '300');
  await expect(page.locator('[data-preview]')).toHaveAttribute('height', '400');
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.getByLabel('Crop aspect ratio', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('height', '400');
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.getByLabel('Crop aspect ratio', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('height', '300');
  const recipe = JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!);
  expect(recipe.geometry).toEqual({ crop: { x: 0.125, y: 0, width: 0.75, height: 1 }, rotation: 1 });
  await page.getByRole('button', { name: 'Reset framing', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '400');
  await expect(page.locator('[data-preview]')).toHaveAttribute('height', '300');
});

test('free crop supports dragging, numeric sizing, and one-step undo', async ({ page }) => {
  await openPhoto(page);
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  const preview = page.locator('.crop-preview'); const bounds = (await preview.boundingBox())!;
  const handle = page.locator('.crop-se'); await handle.hover();
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.up();
  await page.locator('.crop-fine summary').click();
  await page.getByLabel('Crop width percent', { exact: true }).fill('50');
  await page.getByLabel('Crop width percent', { exact: true }).press('Tab');
  await page.getByLabel('Crop height percent', { exact: true }).fill('50');
  await page.getByLabel('Crop height percent', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '200');
  await expect(page.locator('[data-preview]')).toHaveAttribute('height', '150');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '400');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
