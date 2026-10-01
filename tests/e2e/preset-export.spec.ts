import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

async function photo(page: Page, name = 'photo.png') {
  await expect(page.getByRole('button', { name: 'Open photo', exact: true })).toBeEnabled();
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: makePng(400, 300) });
  await expect(page.locator('.photo-name')).toHaveText(name);
}
async function pixel(page: Page) { return page.locator('[data-preview]').evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data)); }
async function recipe(page: Page) { return JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!); }

test('current edits export to XMP, preserve names and curves, and reapply without geometry', async ({ page }) => {
  await page.goto('./'); await photo(page);
  await page.getByRole('spinbutton', { name: 'Exposure value' }).fill('0.75');
  await page.getByRole('spinbutton', { name: 'Exposure value' }).press('Tab');
  await page.locator('summary').filter({ hasText: 'Tone curves' }).click();
  await page.getByLabel('Curve channel', { exact: true }).selectOption('red');
  await page.getByLabel('Point output', { exact: true }).fill('51');
  await page.getByLabel('Point output', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await expect(page.locator('[data-preview]')).toHaveAttribute('height', '400');
  const expected = await pixel(page);
  const name = 'Warm & soft <sunset> “光”';
  await page.getByRole('button', { name: 'Save as preset', exact: true }).click();
  await page.getByLabel('New preset name', { exact: true }).fill(name);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const download = await waiting; const xml = await readFile((await download.path())!, 'utf8');
  expect(xml).toContain('&amp;'); expect(xml).toContain('&lt;sunset&gt;');
  expect(xml).not.toContain('photo.png'); expect(xml).not.toContain('CropTop'); expect(xml).not.toContain('rotation');
  await expect(page.getByRole('button', { name: `Apply preset ${name}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await photo(page, 'another.png');
  await page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name: 'exported.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(xml) });
  await expect.poll(async () => (await recipe(page)).exposure).toBe(0.75);
  await expect.poll(() => pixel(page)).toEqual(expected);
  expect((await recipe(page)).geometry.rotation).toBe(0);
  expect((await recipe(page)).curves.red[0][1]).toBe(0.2);
});

test('partial preset export omits unselected groups and can download without saving', async ({ page }) => {
  await page.goto('./'); await photo(page);
  await page.getByRole('spinbutton', { name: 'Warmth value' }).fill('25');
  await page.getByRole('spinbutton', { name: 'Warmth value' }).press('Tab');
  await page.getByRole('button', { name: 'Save as preset', exact: true }).click();
  await page.getByLabel('New preset name', { exact: true }).fill('Color only');
  await page.getByLabel('Save in this browser', { exact: true }).uncheck();
  await page.locator('.preset-groups summary').click();
  await page.getByLabel('Include light', { exact: true }).uncheck();
  await page.getByLabel('Include curves', { exact: true }).uncheck();
  await page.getByLabel('Include hsl', { exact: true }).uncheck();
  await page.getByLabel('Include look', { exact: true }).uncheck();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const xml = await readFile((await (await waiting).path())!, 'utf8');
  expect(xml).toContain('IncrementalTemperature="25"');
  expect(xml).not.toContain('Exposure2012'); expect(xml).not.toContain('ToneCurvePV2012'); expect(xml).not.toContain('HueAdjustment');
  await expect(page.getByRole('button', { name: 'Apply preset Color only', exact: true })).toHaveCount(0);
});

test('standard fields use integers while validated precision metadata preserves exact edits', async ({ page }) => {
  await page.goto('./'); await photo(page);
  const source = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Saturation="2.5"><crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 25.5</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012></rdf:Description></rdf:RDF>';
  await page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name: 'fractional.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(source) });
  await expect.poll(async () => (await recipe(page)).saturation).toBe(2.5);
  const expected = await pixel(page);
  await page.getByRole('button', { name: 'Save as preset', exact: true }).click();
  await page.getByLabel('New preset name', { exact: true }).fill('Exact values');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const xml = await readFile((await (await waiting).path())!, 'utf8');
  expect(xml).toContain('Saturation="3"'); expect(xml).toContain('0, 26'); expect(xml).toContain('still:Settings');
  await photo(page, 'roundtrip.png');
  await page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name: 'exact.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(xml) });
  await expect.poll(async () => (await recipe(page)).saturation).toBe(2.5);
  expect((await recipe(page)).curves.master[0][1]).toBe(0.1);
  expect(await pixel(page)).toEqual(expected);
  const invalidPrecision = await page.evaluate(text => {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    xml.getElementsByTagNameNS('https://garyjx.github.io/wasm-image-editor/xmp/1.0/', 'Settings')[0].textContent = '{"saturation":200}';
    return new XMLSerializer().serializeToString(xml);
  }, xml);
  await page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name: 'invalid-precision.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(invalidPrecision) });
  await expect.poll(async () => (await recipe(page)).saturation).toBe(3);
  await expect(page.locator('.preset-report')).toContainText('full-precision settings were invalid');
});
