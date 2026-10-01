import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

const cube = 'TITLE "Swap channels"\nLUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n';
const curveLook = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Name="Curve profile"><crs:Look><rdf:Description crs:Name="Lifted profile" crs:Amount="0.5" crs:SupportsAmount="true" crs:SupportsOutputReferred="true"><crs:Parameters><rdf:Description crs:ProcessVersion="11.0"><crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 51</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012></rdf:Description></crs:Parameters></rdf:Description></crs:Look></rdf:Description></rdf:RDF>';
async function photo(page: Page, name = 'look.png') {
  await expect(page.getByRole('button', { name: 'Open photo', exact: true })).toBeEnabled();
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: makePng(400, 300) });
  await expect(page.locator('.photo-name')).toHaveText(name);
}
async function pixel(page: Page) { return page.locator('[data-preview]').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data)); }
async function recipe(page: Page) { return JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!); }
async function xmp(page: Page, xml: string) { await page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name: 'look.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(xml) }); }
async function saveXmp(page: Page, name: string) {
  await page.getByRole('button', { name: 'Save as preset', exact: true }).click();
  await page.getByLabel('New preset name', { exact: true }).fill(name);
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  return readFile((await (await waiting).path())!, 'utf8');
}

test('self-contained curve looks support amount, undo, and XMP round-trips', async ({ page }) => {
  await page.goto('./'); await photo(page); await xmp(page, curveLook);
  await expect.poll(async () => (await recipe(page)).look?.kind).toBe('curves');
  await expect.poll(() => pixel(page)).toEqual([141, 83, 26, 255]);
  await page.locator('.look-section summary').click();
  await page.getByRole('spinbutton', { name: 'Look amount value' }).fill('100');
  await page.getByRole('spinbutton', { name: 'Look amount value' }).press('Tab');
  await expect.poll(async () => (await recipe(page)).look?.amount).toBe(1);
  const expected = await pixel(page);
  const xml = await saveXmp(page, 'Embedded look');
  expect(xml).toContain('crs:Look');
  await photo(page, 'next.png'); await xmp(page, xml);
  await expect.poll(() => pixel(page)).toEqual(expected);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await recipe(page)).look).toBeNull();
});

test('unavailable Adobe dependencies are named and not silently rendered', async ({ page }) => {
  await page.goto('./'); await photo(page);
  const dependent = curveLook.replace('crs:ProcessVersion="11.0"', 'crs:ProcessVersion="11.0" crs:CameraProfile="Adobe Standard" crs:LookTable="0123456789ABCDEF"').replace('Lifted profile', 'Adobe Color');
  await xmp(page, dependent);
  await expect(page.locator('.preset-report')).toContainText('Adobe Color');
  await expect(page.locator('.preset-report')).toContainText('Adobe Standard');
  await expect(page.locator('.preset-report')).toContainText('0123456789ABCDEF');
  expect((await recipe(page)).look).toBeNull();
  expect(await pixel(page)).toEqual([128, 64, 0, 255]);
});

test('cube LUTs render, persist, and keep their reference through XMP export', async ({ page }) => {
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('./'); await photo(page);
  await page.getByLabel('Choose a LUT file', { exact: true }).setInputFiles({ name: 'swap.cube', mimeType: 'text/plain', buffer: Buffer.from(cube) });
  await expect.poll(() => pixel(page)).toEqual([0, 64, 128, 255]);
  await page.locator('.look-section summary').click();
  await page.getByRole('spinbutton', { name: 'Look amount value' }).fill('50');
  await page.getByRole('spinbutton', { name: 'Look amount value' }).press('Tab');
  await expect.poll(() => pixel(page)).toEqual([64, 64, 64, 255]);
  const imageWaiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const imageBytes = await readFile((await (await imageWaiting).path())!);
  const exportPixel = await page.evaluate(async encoded => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    const result = Array.from(context.getImageData(0, 0, 1, 1).data); bitmap.close(); return result;
  }, imageBytes.toString('base64'));
  expect(exportPixel).toEqual([64, 64, 64, 255]);
  const xml = await saveXmp(page, 'Half swap');
  expect(xml).toContain('still:Look');
  await page.reload(); await photo(page);
  await page.getByRole('button', { name: 'Apply preset Half swap', exact: true }).click();
  await expect.poll(() => pixel(page)).toEqual([64, 64, 64, 255]);
  const context = page.context(); const fresh = await context.browser()!.newContext(); const other = await fresh.newPage();
  await other.goto(page.url()); await photo(other); await xmp(other, xml);
  await expect(other.locator('.preset-report')).toContainText('needs its .cube file');
  expect((await recipe(other)).look).toBeNull();
  await other.getByLabel('Choose a LUT file', { exact: true }).setInputFiles({ name: 'swap.cube', mimeType: 'text/plain', buffer: Buffer.from(cube) });
  await expect.poll(() => pixel(other)).toEqual([0, 64, 128, 255]);
  await other.getByRole('button', { name: 'Apply preset Half swap', exact: true }).click();
  await expect.poll(() => pixel(other)).toEqual([64, 64, 64, 255]);
  await fresh.close();
});

test('profile amount capability is respected and a disabled look is not an unsaved edit', async ({ page }) => {
  await page.goto('./'); await photo(page);
  await xmp(page, curveLook.replace('crs:SupportsAmount="true"', 'crs:SupportsAmount="false"'));
  await expect.poll(async () => (await recipe(page)).look?.amount).toBe(1);
  await page.locator('.look-section summary').click();
  await expect(page.getByRole('spinbutton', { name: 'Look amount value' })).toBeDisabled();
  await page.getByLabel('Choose a LUT file', { exact: true }).setInputFiles({ name: 'swap.cube', mimeType: 'text/plain', buffer: Buffer.from(cube) });
  await expect.poll(async () => (await recipe(page)).look?.kind).toBe('lut');
  await page.getByRole('spinbutton', { name: 'Look amount value' }).fill('0');
  await page.getByRole('spinbutton', { name: 'Look amount value' }).press('Tab');
  await expect.poll(async () => (await recipe(page)).look).toBeNull();
  expect(await pixel(page)).toEqual([128, 64, 0, 255]);
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});

test('invalid LUT files preserve the current image and do not create a look', async ({ page }) => {
  await page.goto('./'); await photo(page);
  await page.getByLabel('Choose a LUT file', { exact: true }).setInputFiles({ name: 'bad.cube', mimeType: 'text/plain', buffer: Buffer.from('LUT_3D_SIZE 2\n0 0 0') });
  await expect(page.getByRole('alert')).toContainText('incomplete sample table');
  expect(await pixel(page)).toEqual([128, 64, 0, 255]);
  expect((await recipe(page)).look).toBeNull();
});

test('the storage upgrade preserves older XMP presets', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Open photo', exact: true })).toBeEnabled();
  await page.evaluate(async xml => {
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('wasm-image-editor'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('wasm-image-editor', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('presets', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('presets', 'readwrite');
        tx.objectStore('presets').put({ id: 'legacy-preset', name: 'Legacy preset', xml, parserVersion: 1, createdAt: 1 });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  }, curveLook);
  await page.reload(); await photo(page);
  await page.getByRole('button', { name: 'Apply preset Legacy preset', exact: true }).click();
  await expect.poll(() => pixel(page)).toEqual([141, 83, 26, 255]);
});

test('a LUT remains available when the image worker is recovered', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker; const workers: Worker[] = [];
    (window as unknown as { testWorkers: Worker[] }).testWorkers = workers;
    window.Worker = class extends NativeWorker { constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); workers.push(this); } };
  });
  await page.goto('./'); await photo(page);
  await page.getByLabel('Choose a LUT file', { exact: true }).setInputFiles({ name: 'swap.cube', mimeType: 'text/plain', buffer: Buffer.from(cube) });
  await expect.poll(() => pixel(page)).toEqual([0, 64, 128, 255]);
  await page.evaluate(() => (window as unknown as { testWorkers: Worker[] }).testWorkers.at(-1)!.dispatchEvent(new ErrorEvent('error', { message: 'Test failure', cancelable: true })));
  await page.getByRole('button', { name: 'Recover editor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([0, 64, 128, 255]);
});

test('an active 3D LUT handles a full preview and exposes timing diagnostics', async ({ page }, testInfo) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Open photo', exact: true })).toBeEnabled();
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'large-look.png', mimeType: 'image/png', buffer: makePng(1600, 1200, true) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('width', '1600');
  const rows: string[] = ['TITLE "17 point identity"', 'LUT_3D_SIZE 17'];
  for (let blue = 0; blue < 17; blue++) for (let green = 0; green < 17; green++) for (let red = 0; red < 17; red++) rows.push(`${red / 16} ${green / 16} ${blue / 16}`);
  await page.getByLabel('Choose a LUT file', { exact: true }).setInputFiles({ name: 'identity17.cube', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n')) });
  await expect.poll(async () => (await recipe(page)).look?.kind).toBe('lut');
  const renderMs = Number(await page.locator('[data-preview]').getAttribute('data-render-ms'));
  console.log('LUT_PREVIEW_TIMING', JSON.stringify({ width: 1600, height: 1200, grid: 17, renderMs }));
  expect(renderMs).toBeLessThan(1000);
  await testInfo.attach('lut-preview-timing', { body: JSON.stringify({ width: 1600, height: 1200, grid: 17, renderMs }), contentType: 'application/json' });
});
