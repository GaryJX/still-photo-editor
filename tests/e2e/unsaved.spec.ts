import { test, expect, type Page } from '@playwright/test';
import { makePng } from '../fixtures/image';

async function guarded(page: Page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}
async function setExposure(page: Page, value: number) {
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill(String(value));
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', String(value));
}
async function open(page: Page) {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'edits.png', mimeType: 'image/png', buffer: makePng() });
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
}

test('leave protection tracks edits, exports, undo, defaults, and photo replacement', async ({ page }) => {
  await open(page);
  expect(await guarded(page)).toBe(false);
  await page.getByRole('button', { name: /Switch to .* mode/ }).click();
  await page.getByRole('button', { name: 'Show original' }).click();
  expect(await guarded(page)).toBe(false);
  await setExposure(page, 1);
  expect(await guarded(page)).toBe(true);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  await waiting;
  await expect.poll(() => guarded(page)).toBe(false);
  await setExposure(page, 2);
  expect(await guarded(page)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => guarded(page)).toBe(false);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
  expect(await guarded(page)).toBe(false);
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'another.png', mimeType: 'image/png', buffer: makePng(80, 60) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '80');
  await setExposure(page, 1);
  expect(await guarded(page)).toBe(true);
});

test('a real page reload runs the native beforeunload protection', async ({ page }) => {
  await open(page);
  await setExposure(page, 1);
  await page.evaluate(() => {
    window.addEventListener('beforeunload', event => localStorage.setItem('test-unload-was-cancelled', String(event.defaultPrevented)));
  });
  page.on('dialog', dialog => void dialog.accept());
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('test-unload-was-cancelled'))).toBe('true');
});
