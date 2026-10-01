import { test, expect, type Page } from '@playwright/test';
import { makePng } from '../fixtures/image';

async function openEdited(page: Page) {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'comparison.png', mimeType: 'image/png', buffer: makePng(400, 300) });
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
}

async function visibleSides(page: Page) {
  const screenshot = await page.locator('.comparison-preview').screenshot();
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const sample = (x: number) => Array.from(ctx.getImageData(Math.floor(image.width * x), Math.floor(image.height * 0.8), 1, 1).data);
    const result = [sample(0.1), sample(0.9)];
    image.close();
    return result;
  }, screenshot.toString('base64'));
}

test('divider starts centered and reveals the correct images at every endpoint', async ({ page }) => {
  await openEdited(page);
  const divider = page.getByRole('slider', { name: 'Before and after comparison' });
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  expect(await visibleSides(page)).toEqual([[128, 64, 0, 255], [176, 90, 0, 255]]);
  const bounds = (await divider.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 30, bounds.y + bounds.height / 2);
  await expect(divider).toHaveAttribute('aria-valuenow', '0');
  expect(await visibleSides(page)).toEqual([[176, 90, 0, 255], [176, 90, 0, 255]]);
  await page.mouse.move(bounds.x + bounds.width + 30, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '100');
  expect(await visibleSides(page)).toEqual([[128, 64, 0, 255], [128, 64, 0, 255]]);
  await page.getByRole('button', { name: 'Split view' }).click();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await divider.focus();
  await divider.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '0');
  await divider.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '100');
  await divider.press('Shift+ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '90');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'next.png', mimeType: 'image/png', buffer: makePng(200, 300) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '200');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
});

test('comparison chrome hides away from the image and stays accessible by keyboard', async ({ page }) => {
  await openEdited(page);
  const preview = page.locator('.comparison-preview');
  const line = page.locator('.comparison-line');
  const divider = page.getByRole('slider', { name: 'Before and after comparison' });
  await page.mouse.move(0, 0);
  await expect(line).toHaveCSS('opacity', '0');
  await preview.hover();
  await expect(line).toHaveCSS('opacity', '1');
  await divider.click();
  await page.mouse.move(0, 0);
  await expect(line).toHaveCSS('opacity', '0');
  await divider.press('ArrowLeft');
  await expect(line).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Show original' }).focus();
  await expect(line).toHaveCSS('opacity', '0');
});

test('editing reveals comparison through a held drag and for one second after release', async ({ page }) => {
  await page.clock.install({ time: 1_000_000_000_000 });
  await openEdited(page);
  await page.clock.pauseAt(1_000_000_060_000);
  await page.mouse.move(0, 0);
  const line = page.locator('.comparison-line');
  await expect(line).toHaveCSS('opacity', '0');
  const slider = page.getByRole('slider', { name: 'Exposure', exact: true });
  const bounds = (await slider.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(line).toHaveCSS('opacity', '1');
  await page.clock.runFor(1500);
  await expect(line).toHaveCSS('opacity', '1');
  await page.mouse.up();
  await page.clock.runFor(800);
  await expect(line).toHaveCSS('opacity', '1');
  await page.clock.runFor(250);
  await expect(line).toHaveCSS('opacity', '0');
  await expect(page.getByRole('slider', { name: 'Before and after comparison' })).toHaveAttribute('aria-valuenow', '50');
});

test('presets and subsequent edits restart the reveal timer, while new photos clear it', async ({ page }) => {
  await page.clock.install({ time: 1_000_000_000_000 });
  await openEdited(page);
  await page.clock.pauseAt(1_000_000_060_000);
  await page.mouse.move(0, 0);
  const line = page.locator('.comparison-line');
  await expect(line).toHaveCSS('opacity', '0');
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Name="Compare edits" crs:Exposure2012="2" /></rdf:RDF></x:xmpmeta>';
  await page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name: 'compare.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(xmp) });
  await expect(page.getByRole('spinbutton', { name: 'Exposure value' })).toHaveValue('2');
  await expect(line).toHaveCSS('opacity', '1');
  await page.clock.runFor(750);
  await page.getByRole('spinbutton', { name: 'Contrast value' }).fill('25');
  await page.getByRole('spinbutton', { name: 'Contrast value' }).press('Tab');
  await page.clock.runFor(750);
  await expect(line).toHaveCSS('opacity', '1');
  await page.clock.runFor(300);
  await expect(line).toHaveCSS('opacity', '0');
  // Looking at a setting without changing its value must not restart the timer.
  await page.getByRole('spinbutton', { name: 'Contrast value' }).focus();
  await page.getByRole('spinbutton', { name: 'Contrast value' }).press('Tab');
  await expect(line).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(line).toHaveCSS('opacity', '1');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'fresh.png', mimeType: 'image/png', buffer: makePng(200, 300) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '200');
  await expect(line).toHaveCSS('opacity', '0');
});

test.describe('touch comparison', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('responds to touch without changing the edits', async ({ page }) => {
    await openEdited(page);
    const divider = page.getByRole('slider', { name: 'Before and after comparison' });
    await divider.scrollIntoViewIfNeeded();
    const bounds = (await divider.boundingBox())!;
    await page.touchscreen.tap(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.6);
    await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBeCloseTo(20, 0);
    await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  });
});
