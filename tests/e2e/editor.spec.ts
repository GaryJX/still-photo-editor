import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

async function pixel(page: Page) {
  return page.locator('canvas[data-preview]').evaluate((canvas) => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data));
}

async function setExposure(page: Page, value: string) {
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill(value);
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('data-exposure', value);
}

async function decodeDownload(page: Page, buffer: Buffer) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const result = { width: bitmap.width, height: bitmap.height, pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data) };
    bitmap.close();
    return result;
  }, buffer.toString('base64'));
}

test('real WASM edit, comparison, full-size export, and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: makePng() });
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('data-exposure', '0');
  expect(await pixel(page)).toEqual([128, 64, 0, 255]);
  await setExposure(page, '1');
  expect(await pixel(page)).toEqual([176, 90, 0, 255]);
  await page.getByRole('button', { name: 'Show original' }).click();
  await expect(page.getByRole('slider', { name: 'Before and after comparison' })).toHaveAttribute('aria-valuenow', '100');
  expect(await pixel(page)).toEqual([176, 90, 0, 255]);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('test-edited.png');
  expect(await decodeDownload(page, await readFile((await download.path())!))).toEqual({ width: 64, height: 48, pixel: [176, 90, 0, 255] });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('data-exposure', '0');
  expect(await pixel(page)).toEqual([128, 64, 0, 255]);
  expect(errors).toEqual([]);
});

test('a failed import preserves the previous photo and the editor recovers', async ({ page }) => {
  await page.goto('./');
  const input = page.getByLabel('Choose a photo', { exact: true });
  await input.setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: makePng() });
  await setExposure(page, '1');
  await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') });
  await expect(page.getByRole('alert')).toContainText("Couldn't open this photo");
  expect(await pixel(page)).toEqual([176, 90, 0, 255]);
  await input.setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: makePng(24, 80) });
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('height', '80');
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('data-exposure', '0');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keyboard slider input and transparent PNG export work on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'alpha.png', mimeType: 'image/png', buffer: makePng(80, 120, false, 128) });
  const slider = page.getByRole('slider', { name: 'Exposure', exact: true });
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('data-exposure', '0.05');
  expect((await pixel(page))[3]).toBe(128);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloadPromise;
  const result = await decodeDownload(page, await readFile((await download.path())!));
  expect(result.width).toBe(80);
  expect(result.height).toBe(120);
  expect(result.pixel[3]).toBe(128);
});

test('rapid slider changes present the latest exposure', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: makePng(2000, 1500, true) });
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('width', '1600');
  await page.getByRole('slider', { name: 'Exposure', exact: true }).evaluate((input) => {
    for (const value of [2, -2, 1, -1, 0.5, 3, 0]) {
      (input as HTMLInputElement).value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('data-exposure', '0');
  await expect(page.getByRole('status')).not.toContainText('Updating');
  await expect(page.getByRole('spinbutton', { name: 'Exposure value' })).toHaveValue('0');
});

test('JPEG orientation and dropping a photo work without uploading it', async ({ page }) => {
  await page.goto('./');
  const requests: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET') requests.push(request.url()); });
  const jpeg = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#804000';
    ctx.fillRect(0, 0, 64, 48);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  }), 'base64');
  // APP1 Exif segment containing one TIFF Orientation=6 tag (90° clockwise).
  const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex');
  const oriented = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'oriented.jpg', mimeType: 'image/jpeg', buffer: oriented });
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('width', '48');
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('height', '64');

  const bytes = Array.from(makePng(32, 24));
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], 'dropped.png', { type: 'image/png' }));
    document.querySelector('.app-shell')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, bytes);
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('width', '32');
  await expect(page.locator('canvas[data-preview]')).toHaveAttribute('height', '24');
  expect(requests).toEqual([]);
});

test('12 MP and 24 MP preview/export baseline', async ({ page }, testInfo) => {
  const measurements = [];
  for (const [width, height] of [[4000, 3000], [6000, 4000]]) {
    await page.goto('./');
    const buffer = makePng(width, height, true);
    const opened = performance.now();
    await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: `${width}.png`, mimeType: 'image/png', buffer });
    await expect(page.locator('canvas[data-preview]')).toHaveAttribute('width', '1600');
    const openMs = performance.now() - opened;
    const renderMs: number[] = [];
    const interactionMs: number[] = [];
    for (const exposure of ['0.25', '0.5', '0.75', '1', '1.25', '1.5', '1.75', '2', '0.1', '0']) {
      const start = performance.now();
      await setExposure(page, exposure);
      interactionMs.push(performance.now() - start);
      renderMs.push(Number(await page.locator('canvas[data-preview]').getAttribute('data-render-ms')));
    }
    const start = performance.now();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    const download = await downloadPromise;
    const exported = await readFile((await download.path())!);
    const exportMs = performance.now() - start;
    // Read PNG IHDR dimensions without decoding another large image in the tab.
    expect(exported.readUInt32BE(16)).toBe(width);
    expect(exported.readUInt32BE(20)).toBe(height);
    measurements.push({
      width, height, openMs, renderMs, interactionMs, exportMs,
      wasmMemoryBytes: Number(await page.locator('canvas[data-preview]').getAttribute('data-wasm-bytes')),
      retainedBytes: Number(await page.locator('canvas[data-preview]').getAttribute('data-retained-bytes')),
      browser: await page.evaluate(() => navigator.userAgent),
    });
  }
  console.log('PERFORMANCE_BASELINE', JSON.stringify(measurements));
  await testInfo.attach('performance-baseline', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});
