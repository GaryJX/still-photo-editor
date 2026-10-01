import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { makePng } from '../fixtures/image';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} editor and dialogs have no detected WCAG A/AA violations`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Open photo', exact: true })).toBeEnabled();
    const check = async (view: string) => {
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      await testInfo.attach(`${theme}-${view}-accessibility`, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
      expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
    };
    await check('empty');
    await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({ name: 'accessible.png', mimeType: 'image/png', buffer: makePng(400, 300) });
    await expect(page.locator('[data-preview]')).toHaveAttribute('width', '400');
    await check('loaded');
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    await check('crop');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await check('export');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Save as preset', exact: true }).click();
    await check('save-preset');
  });
}
