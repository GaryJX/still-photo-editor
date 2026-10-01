import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

async function setup(page: Page) {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'transparent.png', mimeType: 'image/png', buffer: makePng(160, 120, false, 0) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '160');
}
async function decode(page: Page, buffer: Buffer, mime: string) {
  return page.evaluate(async ({ data, mime }) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(data), character => character.charCodeAt(0))], { type: mime }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const result = { width: image.width, height: image.height, pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data) }; image.close(); return result;
  }, { data: buffer.toString('base64'), mime });
}

test('JPEG export uses the selected background, quality, dimensions, and extension', async ({ page }) => {
  await setup(page);
  for (const background of ['white', 'black']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByLabel('Export format', { exact: true }).selectOption('image/jpeg');
    await page.getByLabel('JPEG background', { exact: true }).selectOption(background);
    await page.getByRole('slider', { name: /Quality/ }).focus();
    await page.getByRole('slider', { name: /Quality/ }).press('End');
    const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JPEG', exact: true }).click();
    const download = await waiting; expect(download.suggestedFilename()).toBe('transparent-edited.jpg');
    const buffer = await readFile((await download.path())!);
    expect(Array.from(buffer.subarray(0, 2))).toEqual([255, 216]);
    const result = await decode(page, buffer, 'image/jpeg');
    expect([result.width, result.height]).toEqual([160, 120]);
    expect(result.pixel).toEqual(background === 'white' ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  }
});

test('WebP export preserves transparency when the browser offers it', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const options = await page.getByLabel('Export format', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  test.skip(!options.includes('image/webp'), 'This browser does not offer a native WebP encoder.');
  await page.getByLabel('Export format', { exact: true }).selectOption('image/webp');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export WebP', exact: true }).click();
  const download = await waiting; expect(download.suggestedFilename()).toBe('transparent-edited.webp');
  const result = await decode(page, await readFile((await download.path())!), 'image/webp');
  expect([result.width, result.height, result.pixel[3]]).toEqual([160, 120, 0]);
});

test('cancelling the export dialog does not clear unexported edits', async ({ page }) => {
  await setup(page);
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
});
