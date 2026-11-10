import { readdir, stat } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openEditor } from './helpers.js';

test('built JavaScript chunks stay below 500 kB and the editor loads', async ({ page }) => {
  const directory = new URL('../apps/web/dist/assets/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.js'));
  for (const name of [
    'poster-core-',
    'react-vendor-',
    'validation-',
    'html-parser-',
    'css-parser-',
  ]) {
    expect(
      files.some((file) => file.startsWith(name)),
      `Missing ${name} bundle`,
    ).toBe(true);
  }
  for (const file of files) {
    expect((await stat(new URL(file, directory))).size, `${file} exceeds 500 kB`).toBeLessThan(
      500_000,
    );
  }
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  await expect(page.locator('.artboard')).toBeVisible();
  expect(errors).toEqual([]);
});
