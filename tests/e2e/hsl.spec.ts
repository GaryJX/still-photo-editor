import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

async function setup(page: Page) {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'green.png', mimeType: 'image/png', buffer: makePng(400, 300, false, 255, [0, 255, 0]) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
  await page.locator('summary').filter({ hasText: 'Color mix' }).click();
  await page.getByRole('button', { name: 'Edit green colors', exact: true }).click();
}
async function recipe(page: Page) { return JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!); }
async function pixel(page: Page) { return page.locator('[data-preview]').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data)); }

test('individual color edits render, export, and undo consistently', async ({ page }) => {
  await setup(page);
  await page.getByRole('spinbutton', { name: 'Green intensity value' }).fill('-100');
  await page.getByRole('spinbutton', { name: 'Green intensity value' }).press('Tab');
  await expect.poll(async () => (await recipe(page)).hsl.green.saturation).toBe(-100);
  expect(await pixel(page)).toEqual([128, 128, 128, 255]);
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await waiting; const base64 = (await readFile((await download.path())!)).toString('base64');
  const exported = await page.evaluate(async encoded => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); const result = Array.from(ctx.getImageData(0, 0, 1, 1).data); bitmap.close(); return result;
  }, base64);
  expect(exported).toEqual([128, 128, 128, 255]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0, 255]);
  await page.getByRole('slider', { name: 'Green hue', exact: true }).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await recipe(page)).hsl.green.hue).toBe(100);
  expect(await pixel(page)).toEqual([0, 255, 128, 255]);
});

test('XMP color bands merge partially and invalid band values are reported', async ({ page }) => {
  await setup(page);
  await page.getByRole('spinbutton', { name: 'Green brightness value' }).fill('10');
  await page.getByRole('spinbutton', { name: 'Green brightness value' }).press('Tab');
  await expect.poll(async () => (await recipe(page)).hsl.green.luminance).toBe(10);
  const xml = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Name="Green mix" crs:SaturationAdjustmentGreen="-100" crs:HueAdjustmentRed="101"><crs:HueAdjustmentGreen>30</crs:HueAdjustmentGreen></rdf:Description></rdf:RDF>';
  await page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name: 'mix.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(xml) });
  await expect.poll(async () => (await recipe(page)).hsl.green.saturation).toBe(-100);
  expect((await recipe(page)).hsl.green).toEqual({ hue: 30, saturation: -100, luminance: 10 });
  expect((await recipe(page)).hsl.red.hue).toBe(0);
  await expect(page.locator('.preset-report')).toContainText('HueAdjustmentRed: expected a number');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await recipe(page)).hsl.green).toEqual({ hue: 0, saturation: 0, luminance: 10 });
});
