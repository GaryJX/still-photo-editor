import { test, expect, type Page } from '@playwright/test';
import { makePng } from '../fixtures/image';

async function open(page: Page, name: string, width = 400, height = 300) {
  await expect(page.getByRole('button', { name: 'Open photo', exact: true })).toBeEnabled();
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: makePng(width, height) });
  await expect(page.locator('.photo-name')).toHaveText(name);
}
async function exposure(page: Page, value: number) {
  const input = page.getByRole('spinbutton', { name: 'Exposure value' });
  await input.fill(String(value)); await input.press('Tab');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', String(value));
}
async function saved(page: Page) { await expect(page.locator('[data-photo-save-status]')).toHaveAttribute('data-photo-save-status', 'saved'); }
async function list(page: Page) { if (await page.locator('.photo-library').getAttribute('open') === null) await page.locator('.photo-library > summary').click(); }
async function choose(page: Page, name: string) {
  await list(page); await page.getByRole('button', { name: `Edit photo ${name}`, exact: true }).click();
  await expect(page.locator('.photo-name')).toHaveText(name);
}
async function guarded(page: Page) { return page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }); }

test('photos keep independent edits, history, comparison, and export baselines across switching and reload', async ({ page }) => {
  await page.goto('./');
  await open(page, 'first.png'); await exposure(page, 1);
  await page.getByRole('slider', { name: 'Before and after comparison' }).press('Home');
  await saved(page);
  await open(page, 'second.png', 200, 300); await exposure(page, -1); await saved(page);
  await choose(page, 'first.png');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  await expect(page.getByRole('slider', { name: 'Before and after comparison' })).toHaveAttribute('aria-valuenow', '0');
  const pixel = await page.locator('[data-preview]').evaluate(element => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data));
  expect(pixel).toEqual([176, 90, 0, 255]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('button', { name: 'Export PNG', exact: true }).click(); await download;
  await saved(page); expect(await guarded(page)).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Resume photo', exact: true }).click();
  await expect(page.locator('.photo-name')).toHaveText('first.png');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  expect(await guarded(page)).toBe(false);
  await choose(page, 'second.png');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '-1');
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '200');
  expect(await guarded(page)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
});

test('unavailable photo storage keeps switching functional and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name: string, version?: number) {
      if (name === 'still-photo-sessions' && sessionStorage.getItem('test-storage-available') !== 'true') throw new DOMException('Test storage failure', 'QuotaExceededError');
      return open.call(this, name, version!);
    };
  });
  await page.goto('./'); await open(page, 'memory-first.png'); await exposure(page, 1);
  await expect(page.locator('[data-photo-save-status]')).toHaveAttribute('data-photo-save-status', 'session');
  await open(page, 'memory-second.png'); await exposure(page, 2);
  await choose(page, 'memory-first.png'); await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  await list(page); await page.getByRole('button', { name: 'Remove photo memory-second.png', exact: true }).click();
  await page.getByRole('button', { name: 'Remove photo and edits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit photo memory-second.png', exact: true })).toHaveCount(0);
  await page.evaluate(() => sessionStorage.setItem('test-storage-available', 'true'));
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click(); await saved(page);
  page.on('dialog', dialog => void dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Resume photo', exact: true }).click();
  await expect(page.locator('.photo-name')).toHaveText('memory-first.png');
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
});

test('a missing saved source preserves the selected photo and removal clears stored files', async ({ page }) => {
  await page.goto('./'); await open(page, 'missing.png'); await saved(page);
  await open(page, 'retained.png', 300, 200); await saved(page);
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('still-photo-sessions', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(['photos', 'sources'], 'readwrite');
      const photos = tx.objectStore('photos').getAll(); photos.onsuccess = () => tx.objectStore('sources').delete(photos.result.find(photo => photo.name === 'missing.png').id);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  await list(page); await page.getByRole('button', { name: 'Edit photo missing.png', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('saved original is unavailable');
  await expect(page.locator('.photo-name')).toHaveText('retained.png');
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '300');
  for (const name of ['missing.png', 'retained.png']) {
    await list(page); await page.getByRole('button', { name: `Remove photo ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Remove photo and edits', exact: true }).click();
    await expect(page.getByRole('button', { name: `Edit photo ${name}`, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('[data-preview]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await page.reload(); await expect(page.locator('.photo-count')).toHaveText('0');
  await open(page, 'fresh.png'); await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
});

test('saved sessions restore framing and every LUT needed by undo history', async ({ page }) => {
  await page.goto('./'); await open(page, 'looks.png', 240, 180);
  const importLut = async (name: string, white: string) => {
    const previous = JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!).look?.assetId;
    await page.getByLabel('Choose a LUT file', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`LUT_1D_SIZE 2\n0 0 0\n${white}\n`) });
    await expect.poll(async () => {
      const look = JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!).look;
      return look?.kind === 'lut' && look.assetId !== previous;
    }).toBe(true);
  };
  await importLut('warm.cube', '1 0.5 0.2');
  const firstLook = JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!).look.assetId;
  await importLut('identity.cube', '1 1 1');
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.getByLabel('Crop aspect ratio', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click(); await saved(page);
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('wasm-image-editor', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('luts', 'readwrite'); tx.objectStore('luts').clear(); tx.oncomplete = () => { db.close(); resolve(); }; };
  }));
  page.on('dialog', dialog => void dialog.accept()); await page.reload();
  await page.getByRole('button', { name: 'Resume photo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '180');
  await expect.poll(async () => JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!).geometry.rotation).toBe(1);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!).look?.assetId).toBe(firstLook);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
