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

test.describe('touch comparison', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('responds to touch without changing the edits', async ({ page }) => {
    await openEdited(page);
    const divider = page.getByRole('slider', { name: 'Before and after comparison' });
    const bounds = (await divider.boundingBox())!;
    await page.touchscreen.tap(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.6);
    const position = Number(await divider.getAttribute('aria-valuenow'));
    expect(position).toBeGreaterThan(18);
    expect(position).toBeLessThan(22);
    await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  });
});
