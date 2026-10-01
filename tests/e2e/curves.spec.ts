import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

async function setup(page: Page) {
  await page.goto('./');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'curves.png', mimeType: 'image/png', buffer: makePng(400, 300) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
  await page.locator('summary').filter({ hasText: 'Tone curves' }).click();
}
async function curves(page: Page) { return JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!).curves; }
async function pixel(page: Page) { return page.locator('[data-preview]').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data)); }

test('master and RGB curves affect pixels and export the same result', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Point output', { exact: true }).fill('51');
  await page.getByLabel('Point output', { exact: true }).press('Tab');
  await expect.poll(async () => (await curves(page)).master[0][1]).toBe(0.2);
  const lifted = await pixel(page);
  expect(lifted[2]).toBe(51);
  await page.getByLabel('Curve channel', { exact: true }).selectOption('red');
  await page.getByLabel('Point output', { exact: true }).fill('51');
  await page.getByLabel('Point output', { exact: true }).press('Tab');
  await expect.poll(async () => (await curves(page)).red[0][1]).toBe(0.2);
  const colored = await pixel(page);
  expect(colored[0]).toBeGreaterThan(lifted[0]);
  expect(colored.slice(1)).toEqual(lifted.slice(1));
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await waiting;
  const base64 = (await readFile((await download.path())!)).toString('base64');
  const exported = await page.evaluate(async encoded => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const result = Array.from(ctx.getImageData(0, 0, 1, 1).data); image.close(); return result;
  }, base64);
  expect(exported).toEqual(colored);
});

test('adding and moving curve points integrates with undo and keyboard controls', async ({ page }) => {
  await setup(page);
  const plot = page.locator('.curve-plot');
  await plot.click({ position: { x: 110, y: 90 } });
  await expect.poll(async () => (await curves(page)).master.length).toBe(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await curves(page)).master.length).toBe(2);
  await plot.locator('[data-point="0"]').focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await curves(page)).master[0][1]).toBeCloseTo(1 / 255, 6);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await curves(page)).master[0][1]).toBe(0);
});
