import { test, expect, type Page } from '@playwright/test';
import { makePng } from '../fixtures/image';

async function openPhoto(page: Page) {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'color.png', mimeType: 'image/png', buffer: makePng(400, 300) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
}
async function field(page: Page, key: string) {
  return JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!)[key];
}
async function setControl(page: Page, label: string, key: string, value: number) {
  const input = page.getByRole('spinbutton', { name: `${label} value` });
  await input.fill(String(value)); await input.press('Tab');
  await expect.poll(() => field(page, key)).toBe(value);
}
async function pixel(page: Page) {
  return page.locator('[data-preview]').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data));
}

test('color controls compose, reset individually, and undo/redo restores the rendered result', async ({ page }) => {
  await openPhoto(page);
  await setControl(page, 'Exposure', 'exposure', 1);
  await setControl(page, 'Color intensity', 'saturation', -100);
  const gray = await pixel(page);
  expect(gray[0]).toBe(gray[1]); expect(gray[1]).toBe(gray[2]); expect(gray[3]).toBe(255);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => field(page, 'saturation')).toBe(0);
  expect(await pixel(page)).toEqual([176, 90, 0, 255]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => field(page, 'saturation')).toBe(-100);
  expect(await pixel(page)).toEqual(gray);
  await page.getByRole('button', { name: 'Reset color intensity', exact: true }).click();
  await expect.poll(() => field(page, 'saturation')).toBe(0);
  await expect.poll(() => field(page, 'exposure')).toBe(1);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(() => field(page, 'exposure')).toBe(0);
  expect(await pixel(page)).toEqual([128, 64, 0, 255]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => field(page, 'exposure')).toBe(1);
});

test('one slider gesture is one undo step and new edits invalidate redo', async ({ page }) => {
  await openPhoto(page);
  await page.getByRole('slider', { name: 'Warmth', exact: true }).evaluate(input => {
    for (const value of [10, 20, 30]) {
      (input as HTMLInputElement).value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => field(page, 'warmth')).toBe(30);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => field(page, 'warmth')).toBe(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => field(page, 'warmth')).toBe(30);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await setControl(page, 'Tint', 'tint', 25);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await page.getByRole('slider', { name: 'Before and after comparison' }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => field(page, 'tint')).toBe(0);
});

test('typing into a numeric field survives an unrelated preview update', async ({ page }) => {
  await openPhoto(page);
  const tint = page.getByRole('spinbutton', { name: 'Tint value' });
  await tint.fill('25');
  await page.getByRole('slider', { name: 'Exposure', exact: true }).evaluate(input => {
    (input as HTMLInputElement).value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => field(page, 'exposure')).toBe(1);
  await expect(tint).toHaveValue('25');
  await tint.press('Tab');
  await expect.poll(() => field(page, 'tint')).toBe(25);
});
