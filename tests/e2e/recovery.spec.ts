import { test, expect } from '@playwright/test';
import { makePng } from '../fixtures/image';

test('a failed worker can be recovered without losing the photo, edits, or undo history', async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    const workers: Worker[] = [];
    (window as unknown as { editorTestWorkers: Worker[] }).editorTestWorkers = workers;
    window.Worker = class extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); workers.push(this); }
    };
  });
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'recover.png', mimeType: 'image/png', buffer: makePng() });
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('[data-detail="edited"]')).toBeAttached();
  await page.evaluate(() => {
    const workers = (window as unknown as { editorTestWorkers: Worker[] }).editorTestWorkers;
    workers.at(-1)!.dispatchEvent(new ErrorEvent('error', { message: 'Simulated processor failure', cancelable: true }));
  });
  await expect(page.getByRole('button', { name: 'Recover editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Recover editor' }).click();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  await expect(page.locator('.photo-name')).toHaveText('recover.png');
  await expect(page.locator('.comparison-preview')).toHaveAttribute('data-zoom', '1.5');
  await expect(page.locator('[data-detail="edited"]')).toBeAttached();
  const pixel = await page.locator('[data-preview]').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data));
  expect(pixel).toEqual([176, 90, 0, 255]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
});

test('mobile controls collapse and reappear without losing settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'mobile.png', mimeType: 'image/png', buffer: makePng() });
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await page.getByRole('button', { name: 'Hide controls' }).click();
  await expect(page.locator('#editor-controls')).toBeHidden();
  await page.getByRole('button', { name: 'Show controls' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Exposure value' })).toHaveValue('1');
  await page.getByRole('button', { name: 'Hide controls' }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#editor-controls')).toBeVisible();
});
