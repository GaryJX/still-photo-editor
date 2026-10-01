import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng } from '../fixtures/image';

const xmp = (attributes: string, body = '') => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><r:Description xmlns:cam="http://ns.adobe.com/camera-raw-settings/1.0/" ${attributes}>${body}</r:Description></r:RDF></x:xmpmeta>`;
const golden = xmp('cam:Name="Golden hour" cam:ProcessVersion="11.0" cam:Exposure2012="1" cam:IncrementalTemperature="20"', '<cam:ToneCurvePV2012><r:Seq><r:li>0, 25.5</r:li><r:li>255, 255</r:li></r:Seq></cam:ToneCurvePV2012>');
async function importXmp(page: Page, xml: string, name = 'preset.xmp') {
  await page.getByLabel('Choose an XMP preset', { exact: true }).setInputFiles({ name, mimeType: 'application/rdf+xml', buffer: Buffer.from(xml) });
}
async function openPhoto(page: Page) {
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng(400, 300) });
  await expect(page.locator('[data-preview]')).toHaveAttribute('data-exposure', '0');
}
async function recipe(page: Page) { return JSON.parse((await page.locator('[data-preview]').getAttribute('data-recipe'))!); }

test('presets can be imported before a photo, survive reload, deduplicate, and apply as one undo step', async ({ page }) => {
  await page.goto('./');
  await importXmp(page, golden);
  const apply = page.getByRole('button', { name: 'Apply preset Golden hour', exact: true });
  await expect(apply).toBeVisible();
  await page.reload();
  await expect(apply).toBeVisible();
  await importXmp(page, golden);
  await expect(page.locator('.preset-list li')).toHaveCount(1);
  await openPhoto(page);
  await apply.click();
  await expect.poll(async () => (await recipe(page)).exposure).toBe(1);
  expect((await recipe(page)).warmth).toBe(20);
  expect((await recipe(page)).curves.master[0][1]).toBe(0.1);
  await apply.click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await recipe(page)).exposure).toBe(0);
  expect((await recipe(page)).warmth).toBe(0);
  expect((await recipe(page)).curves.master).toEqual([[0, 0], [1, 1]]);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('element fields map correctly, nested mask settings stay local, and compatibility is visible', async ({ page }) => {
  await page.goto('./'); await openPhoto(page);
  const fixture = xmp('cam:Name="Partial look" cam:ProcessVersion="99.0" cam:Temperature="6500"', '<cam:Exposure2012>1</cam:Exposure2012><cam:Saturation>-100</cam:Saturation><cam:MaskGroupBasedCorrections><r:Seq><r:li><r:Description cam:Exposure2012="3" /></r:li></r:Seq></cam:MaskGroupBasedCorrections>');
  await importXmp(page, fixture);
  await expect.poll(async () => (await recipe(page)).exposure).toBe(1);
  expect((await recipe(page)).saturation).toBe(-100);
  expect((await recipe(page)).warmth).toBe(0);
  await page.locator('.preset-report summary').click();
  await expect(page.locator('.preset-report')).toContainText('MaskGroupBasedCorrections');
  await expect(page.locator('.preset-report')).toContainText('absolute RAW white balance');
  await expect(page.locator('.preset-report')).toContainText('Unrecognized ProcessVersion 99.0');
});

test('invalid settings and XML are rejected without corrupting current edits', async ({ page }) => {
  await page.goto('./'); await openPhoto(page);
  const fixture = xmp('cam:Name="Mixed" cam:Exposure2012="NaN" cam:Saturation="-100"', '<cam:ToneCurvePV2012><r:Seq><r:li>255, 0</r:li><r:li>0, 255</r:li></r:Seq></cam:ToneCurvePV2012>');
  await importXmp(page, fixture);
  await expect.poll(async () => (await recipe(page)).saturation).toBe(-100);
  expect((await recipe(page)).exposure).toBe(0);
  expect((await recipe(page)).curves.master).toEqual([[0, 0], [1, 1]]);
  await expect(page.locator('.preset-report')).toContainText('Invalid settings');
  await importXmp(page, '<not-closed>');
  await expect(page.getByRole('alert')).toContainText('invalid XML');
  await importXmp(page, '<!DOCTYPE x [<!ENTITY test "value">]><x/>');
  await expect(page.getByRole('alert')).toContainText('entity declarations');
  expect((await recipe(page)).saturation).toBe(-100);
});

test('saved presets can be renamed, backed up as the original XMP, and deleted', async ({ page }) => {
  await page.goto('./'); await importXmp(page, golden);
  await page.getByLabel('Options for Golden hour', { exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Preset name', { exact: true }).fill('My warm look');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply preset My warm look', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Options for My warm look', { exact: true }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original XMP', exact: true }).click();
  const download = await waiting;
  expect(await readFile((await download.path())!, 'utf8')).toBe(golden);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.preset-list li')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Apply preset My warm look', exact: true })).toHaveCount(0);
});

test('XMP drop and application still work with session-only storage', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(IDBFactory.prototype, 'open', { value: () => { throw new Error('Storage unavailable'); } }); });
  await page.goto('./'); await openPhoto(page);
  await page.evaluate(xml => {
    const data = new DataTransfer(); data.items.add(new File([xml], 'drop.xmp', { type: 'application/rdf+xml' }));
    document.querySelector('.app-shell')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  }, golden);
  await expect.poll(async () => (await recipe(page)).exposure).toBe(1);
  await expect(page.getByRole('button', { name: 'Apply preset Golden hour', exact: true })).toContainText('Session only');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Apply preset Golden hour', exact: true })).toHaveCount(0);
});
