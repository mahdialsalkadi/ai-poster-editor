import { expect, test } from '@playwright/test';
import { openEditor } from './helpers.js';

test('AR/EN toggle translates chrome, mirrors the layout and persists', async ({ page }) => {
  await openEditor(page);
  const html = page.locator('html');

  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeVisible();
  const rtlBrand = await page.locator('.topbar-brand').boundingBox();
  const rtlActions = await page.locator('.topbar-actions').boundingBox();
  expect(rtlBrand!.x).toBeGreaterThan(rtlActions!.x);

  await page.getByRole('button', { name: 'English', exact: true }).click();

  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Layers', exact: true })).toBeVisible();
  await expect(page.locator('.panel h2')).toHaveText('Layers');
  await expect(page.getByText('Top layer appears first.', { exact: false })).toBeVisible();
  const ltrBrand = await page.locator('.topbar-brand').boundingBox();
  const ltrActions = await page.locator('.topbar-actions').boundingBox();
  expect(ltrBrand!.x).toBeLessThan(ltrActions!.x);
  expect(await page.evaluate(() => localStorage.getItem('poster.ui.lang'))).toBe('en');

  await page.locator('.layer-row').first().click();
  await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
  await expect(page.getByText('Position and size', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export design' })).toBeVisible();
  await expect(page.getByText('Resolution', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close export' }).click();

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
  await page.getByRole('button', { name: 'Close account' }).click();

  await page.reload();
  await expect(page.locator('.save-state--saved')).toBeVisible();
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('poster.ui.lang'))).toBe('ar');
});
