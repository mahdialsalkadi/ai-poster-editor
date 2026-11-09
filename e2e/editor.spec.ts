import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { layer, openEditor, pasteText, save, storeCount, stored } from './helpers.js';

test('template → transforms → Arabic/English paste → history → reload → mock AI → PNG/PDF', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  await page.getByRole('button', { name: 'القوالب', exact: true }).click();
  await page.getByRole('button', { name: /Neon Night/ }).click();
  const shape = layer(page, 'glow');
  await expect(shape).toBeVisible();
  await shape.click({ position: { x: 15, y: 15 } });
  const before = await shape.evaluate((element) => ({
    left: element.style.left,
    width: element.style.width,
  }));
  const box = await shape.boundingBox();
  if (!box) throw new Error('Missing shape geometry');
  await page.mouse.move(box.x + 15, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => shape.evaluate((element) => element.style.left)).not.toBe(before.left);
  const resize = await shape.getByRole('button', { name: 'Resize se', exact: true }).boundingBox();
  if (!resize) throw new Error('Missing resize handle');
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + 35, resize.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => shape.evaluate((element) => element.style.width)).not.toBe(before.width);
  const rotate = await shape.getByRole('button', { name: 'Rotate layer' }).boundingBox();
  const current = await shape.boundingBox();
  if (!rotate || !current) throw new Error('Missing rotate handle');
  await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2);
  await page.mouse.down();
  await page.mouse.move(current.x + current.width / 2 + 80, current.y + current.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  const rotation = await shape.evaluate((element) => element.style.transform);
  expect(rotation).not.toBe('rotate(0deg)');

  await pasteText(page, layer(page, 'arabic'), 'مرحبا بالعالم\n\nسطر ثان');
  await expect(layer(page, 'arabic').locator('br')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'تباعد الحروف' })).toBeDisabled();
  await pasteText(page, layer(page, 'title'), '<b>Plain English</b>\n\nSecond line');
  await expect(layer(page, 'title')).toContainText('<b>Plain English</b>');
  await expect(layer(page, 'title').locator('b')).toHaveCount(0);
  await page.getByRole('button', { name: 'تراجع', exact: true }).click();
  await expect(layer(page, 'title')).toHaveText('NIGHT');
  await page.getByRole('button', { name: 'إعادة', exact: true }).click();
  await expect(layer(page, 'title')).toContainText('Plain English');
  await save(page);
  await expect.poll(async () => (await stored(page))?.designHtml).toContain('Plain English');
  await page.reload();
  await expect(layer(page, 'title')).toContainText('Plain English');
  await expect(layer(page, 'arabic').locator('br')).toHaveCount(2);
  await expect
    .poll(() => layer(page, 'glow').evaluate((element) => element.style.transform))
    .toBe(rotation);

  await page.getByRole('button', { name: 'A4', exact: true }).click();
  await page.getByRole('button', { name: 'المساعد', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: 'وصف التصميم', exact: true })
    .fill('A quality gate poster');
  const generated = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/ai/generate') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'ولّد تصميماً', exact: true }).click();
  expect((await generated).status()).toBe(200);
  await expect(layer(page, 'title')).toHaveText('Quality gate poster');
  await expect(page.locator('.ai-usage')).toContainText('e2e-mock-no-network');
  await layer(page, 'title').click();
  await page.getByRole('textbox', { name: 'تعليمات تعديل التحديد' }).fill('Improve headline');
  await page.getByRole('button', { name: 'عدّل التحديد', exact: true }).click();
  await expect(layer(page, 'title')).toHaveText('AI edit: Improve headline');
  await save(page);
  await page.reload();
  await expect(layer(page, 'title')).toHaveText('AI edit: Improve headline');
  await page.getByRole('button', { name: 'المساعد', exact: true }).first().click();
  await expect(page.locator('.ai-snapshots')).toContainText('Improve headline');
  await page.getByRole('button', { name: 'استعادة', exact: true }).click();
  await expect(layer(page, 'title')).toHaveText('Quality gate poster');
  expect(await storeCount(page, 'snapshots')).toBe(0);

  await page.getByRole('button', { name: 'تصدير', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'تصدير التصميم' });
  await dialog.getByRole('button', { name: '1×', exact: true }).click();
  const pngDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'تصدير وتنزيل', exact: true }).click();
  const pngPath = await (await pngDownload).path();
  if (!pngPath) throw new Error('Missing PNG download');
  const png = await readFile(pngPath);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(794);
  expect(png.readUInt32BE(20)).toBe(1123);
  await dialog.getByRole('button', { name: 'PDF', exact: true }).click();
  const pdfDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'تصدير وتنزيل', exact: true }).click();
  const pdfPath = await (await pdfDownload).path();
  if (!pdfPath) throw new Error('Missing PDF download');
  const pdf = (await readFile(pdfPath)).toString('latin1');
  const size = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf);
  expect(size).not.toBeNull();
  expect(Math.abs(Number(size?.[1]) - 595)).toBeLessThan(1.5);
  expect(Math.abs(Number(size?.[2]) - 842)).toBeLessThan(1.5);
  expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('invalid mock AI output never replaces the current document', async ({ page }) => {
  await openEditor(page);
  await save(page);
  const before = (await stored(page))!.designHtml;
  await page.getByRole('button', { name: 'المساعد', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'وصف التصميم', exact: true }).fill('E2E_INVALID_OUTPUT');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/ai/generate') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'ولّد تصميماً', exact: true }).click();
  expect((await response).status()).toBe(502);
  await expect(page.locator('.toast--error')).toBeVisible();
  await save(page);
  expect((await stored(page))?.designHtml).toBe(before);
});

test('snapshot history stays capped after 22 real AI edits and reload', async ({ page }) => {
  await openEditor(page);
  await layer(page, 'headline').click();
  await page.getByRole('button', { name: 'المساعد', exact: true }).first().click();
  for (let index = 0; index < 22; index++) {
    await page.getByRole('textbox', { name: 'تعليمات تعديل التحديد' }).fill(`Revision ${index}`);
    await page.getByRole('button', { name: 'عدّل التحديد', exact: true }).click();
    await expect(layer(page, 'headline')).toHaveText(`AI edit: Revision ${index}`);
  }
  expect(await storeCount(page, 'snapshots')).toBe(20);
  await save(page);
  await page.reload();
  await page.getByRole('button', { name: 'المساعد', exact: true }).first().click();
  await expect(page.locator('.ai-snapshots')).toContainText('Revision 21');
  expect(await storeCount(page, 'snapshots')).toBe(20);
});
