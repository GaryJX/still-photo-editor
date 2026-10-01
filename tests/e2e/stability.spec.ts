import { test, expect } from '@playwright/test';
import { makePng } from '../fixtures/image';

test('repeated large imports and rapid edits keep the worker memory bounded', async ({ page }, testInfo) => {
  await page.goto('./');
  const buffer = makePng(4000, 3000, true);
  const capacities: number[] = [];
  for (let index = 0; index < 6; index++) {
    await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: `memory-${index}.png`, mimeType: 'image/png', buffer });
    await expect(page.locator('.photo-name')).toHaveText(`memory-${index}.png`);
    await page.getByRole('slider', { name: 'Exposure', exact: true }).evaluate(input => {
      for (let i = 0; i < 100; i++) {
        (input as HTMLInputElement).value = String(i === 99 ? 1 : ((i % 17) - 8) / 2);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
    capacities.push(Number(await page.locator('[data-preview]').getAttribute('data-wasm-bytes')));
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  expect(capacities.at(-1)!).toBeLessThanOrEqual(Math.max(...capacities.slice(1, 4)) * 1.25);
  await testInfo.attach('worker-memory-capacity', { body: JSON.stringify({ capacities, note: 'WASM linear memory capacity; excludes browser canvas and JavaScript allocations.' }), contentType: 'application/json' });
});
