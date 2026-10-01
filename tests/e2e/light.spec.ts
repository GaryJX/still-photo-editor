import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const keys = ['highlights', 'shadows', 'whites', 'blacks'] as const;
async function openRamp(page: Page, name = 'light.png') {
  const buffer = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 32;
    const ctx = canvas.getContext('2d')!; const image = ctx.createImageData(256, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 256; x++) image.data.set([x, x, x, 255], (y * 256 + x) * 4);
    ctx.putImageData(image, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer });
  await expect(page.locator('.photo-name')).toHaveText(name);
}
async function adjust(page: Page, key: string, value: number) {
  const label = `${key[0].toUpperCase()}${key.slice(1)} value`;
  await page.getByRole('spinbutton', { name: label }).fill(String(value));
  await page.getByRole('spinbutton', { name: label }).press('Tab');
  await expect.poll(async () => JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!)[key]).toBe(value);
}
async function samples(page: Page) {
  return page.locator('[data-preview]').evaluate(element => {
    const ctx = (element as HTMLCanvasElement).getContext('2d')!;
    return [0, 64, 192, 255].map(x => ctx.getImageData(x, 16, 1, 1).data[0]);
  });
}
async function bytes(page: Page) {
  return page.locator('[data-preview]').evaluate(element => { const c = element as HTMLCanvasElement; return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data); });
}
async function exportPng(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  return readFile((await (await pending).path())!);
}
async function guarded(page: Page) { return page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }); }

test('light controls target shadows/highlights and black/white endpoints, with reset and undo', async ({ page }) => {
  await page.goto('./'); await openRamp(page); await page.locator('.light-controls summary').click();
  await adjust(page, 'shadows', 100);
  let values = await samples(page); expect(values[1] - 64).toBeGreaterThan(20); expect(values[2] - 192).toBeLessThan(10); expect(values[0]).toBe(0); expect(values[3]).toBe(255);
  await page.getByRole('button', { name: 'Reset shadows', exact: true }).click();
  await adjust(page, 'highlights', -100);
  values = await samples(page); expect(192 - values[2]).toBeGreaterThan(20); expect(64 - values[1]).toBeLessThan(10);
  await page.getByRole('button', { name: 'Reset highlights', exact: true }).click();
  await adjust(page, 'whites', -100);
  values = await samples(page); expect(values[3]).toBe(191); expect(Math.abs(values[1] - 64)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Reset whites', exact: true }).click();
  await adjust(page, 'blacks', 100);
  values = await samples(page); expect(values[0]).toBe(64); expect(values[3]).toBe(255);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(() => samples(page)).toEqual([0, 64, 192, 255]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => samples(page)).toEqual(values);
});

test('new XMP light fields round-trip, preserve omitted values, and match PNG export', async ({ page }) => {
  await page.goto('./'); await openRamp(page); await page.locator('.light-controls summary').click();
  const xmp = (attributes: string, body = '') => `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" ${attributes}>${body}</rdf:Description></rdf:RDF>`;
  const importPreset = (xml: string) => page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name: 'tones.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(xml) });
  await importPreset(xmp('crs:Highlights2012="-65" crs:Whites2012="-20" crs:Blacks2012="12.5"', '<crs:Shadows2012>55</crs:Shadows2012>'));
  for (const [key, value] of Object.entries({ highlights: -65, shadows: 55, whites: -20, blacks: 12.5 })) await expect(page.getByRole('spinbutton', { name: `${key[0].toUpperCase()}${key.slice(1)} value` })).toHaveValue(String(value));
  const expected = await bytes(page);
  const png = await exportPng(page);
  expect(await page.evaluate(async encoded => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  }, png.toString('base64'))).toEqual(expected);
  await page.getByRole('button', { name: 'Save as preset', exact: true }).click(); await page.getByLabel('New preset name', { exact: true }).fill('Tonal range');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const xml = await readFile((await (await pending).path())!, 'utf8');
  for (const field of ['Highlights2012="-65"', 'Shadows2012="55"', 'Whites2012="-20"', 'Blacks2012="13"']) expect(xml).toContain(field);
  await openRamp(page, 'roundtrip.png'); await importPreset(xml);
  await expect.poll(() => bytes(page)).toEqual(expected);
  await importPreset(xmp('crs:Highlights2012="101" crs:Shadows2012="25"'));
  await expect(page.getByRole('spinbutton', { name: 'Shadows value' })).toHaveValue('25');
  await expect(page.getByRole('spinbutton', { name: 'Highlights value' })).toHaveValue('-65');
  await expect(page.getByRole('spinbutton', { name: 'Whites value' })).toHaveValue('-20');
  await expect(page.locator('.preset-report')).toContainText('Highlights2012: expected a number');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => bytes(page)).toEqual(expected);
});

test('older saved sessions migrate with neutral light controls and intact history/export state', async ({ page }) => {
  await page.goto('./'); await openRamp(page, 'legacy.png'); await adjust(page, 'exposure', 1);
  await exportPng(page); const expected = await bytes(page);
  await adjust(page, 'exposure', 2); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  await expect(page.locator('[data-photo-save-status]')).toHaveAttribute('data-photo-save-status', 'saved');
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const legacy = (recipe: Record<string, unknown>) => { const result = { ...recipe, engineVersion: '0.6.0' } as Record<string, unknown>; for (const key of ['highlights', 'shadows', 'whites', 'blacks']) delete result[key]; return result; };
    const request = indexedDB.open('still-photo-sessions', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('photos', 'readwrite'), store = tx.objectStore('photos');
      const all = store.getAll();
      all.onsuccess = () => { for (const doc of all.result) {
        doc.history = { current: legacy(doc.history.current), past: doc.history.past.map(legacy), future: doc.history.future.map(legacy) };
        if (doc.lastExportedKey) doc.lastExportedKey = JSON.stringify(legacy(JSON.parse(doc.lastExportedKey)));
        store.put(doc, doc.id);
      } };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload(); await page.getByRole('button', { name: 'Resume photo', exact: true }).click();
  await expect(page.locator('.photo-name')).toHaveText('legacy.png');
  await expect.poll(() => bytes(page)).toEqual(expected);
  expect(await guarded(page)).toBe(false);
  const recipe = JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!);
  expect(recipe.engineVersion).toBe('0.7.0'); for (const key of keys) expect(recipe[key]).toBe(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '2');
  expect(await guarded(page)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '1');
  expect(await guarded(page)).toBe(false);
});
