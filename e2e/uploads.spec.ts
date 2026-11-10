import { expect, test } from '@playwright/test';
import { openEditor } from './helpers.js';

test('accepts valid image formats and rejects oversized headers before decoding', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'الصور', exact: true }).click();
  const input = page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWNYffb9fxBmwGAAABAWFGW1HwXtAAAAAElFTkSuQmCC',
    'base64',
  );
  const jpeg = Buffer.from(
    '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AK+AaEP/2Q==',
    'base64',
  );
  const webp = Buffer.from(
    'UklGRlAAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAgICAgICAAFZQOCAiAAAAcAEAnQEqAgADAAFAJiWUAnQBQAAA/vw3gVf31Og+K+AAAA==',
    'base64',
  );
  await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await input.setInputFiles({ name: 'second.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.locator('.asset-card')).toHaveCount(2);
  await input.setInputFiles({ name: 'third.webp', mimeType: 'image/webp', buffer: webp });
  await expect(page.locator('.asset-card')).toHaveCount(3);
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(8001, 16);
  await input.setInputFiles({ name: 'oversized.png', mimeType: 'image/png', buffer: oversized });
  await expect(page.getByText(/أقصى بُعد مسموح للصورة/)).toBeVisible();
  await expect(page.locator('.asset-card')).toHaveCount(3);
});
