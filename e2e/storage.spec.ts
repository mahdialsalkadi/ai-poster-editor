import { expect, test } from '@playwright/test';
import { serializeDesignDoc } from '../packages/core/src/index.js';
import { qualityDoc } from './fixtures.js';
import { layer, openEditor, rename, save, stored } from './helpers.js';

test('migrates localStorage once and restores the IndexedDB document after reload', async ({
  page,
}) => {
  await page.goto('/api/health');
  await page.evaluate((doc) => {
    localStorage.setItem('poster.design.v1', JSON.stringify(doc));
    localStorage.setItem('poster.name.v1', 'Migrated design');
  }, qualityDoc());
  await openEditor(page);
  await expect(layer(page, 'title')).toHaveText('Quality gate poster');
  await expect(page.locator('.doc-title')).toHaveText('Migrated design');
  expect(await page.evaluate(() => localStorage.getItem('poster.design.v1'))).toBeNull();
  expect((await stored(page))?.schemaVersion).toBe(1);
  await page.reload();
  await expect(layer(page, 'title')).toHaveText('Quality gate poster');
});

test('corrupt current data pauses saving and offers a validated backup', async ({ page }) => {
  await openEditor(page);
  await save(page);
  const current = (await stored(page))!;
  const backup = {
    ...current,
    revision: 'known-good-backup',
    name: 'Backup design',
    designHtml: serializeDesignDoc(qualityDoc()),
  };
  await page.evaluate(
    async ({ current, backup }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('poster.assets', 3);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('documents', 'readwrite');
          const store = tx.objectStore('documents');
          store.put({ ...current, designHtml: '<script>bad</script>' }, 'current');
          store.put(backup, 'backup');
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { current, backup },
  );
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'استعادة الحفظ المحلي' });
  await expect(recovery).toContainText('تالفة');
  expect((await stored(page))?.designHtml).toBe('<script>bad</script>');
  await recovery.getByRole('button', { name: 'استعادة النسخة الاحتياطية' }).click();
  await expect(recovery).toHaveCount(0);
  await expect(layer(page, 'title')).toHaveText('Quality gate poster');
  await save(page);
  expect((await stored(page))?.name).toBe('Backup design');
});

test('a stale tab cannot overwrite a newer saved document', async ({ page, context }) => {
  await openEditor(page);
  await save(page);
  const other = await context.newPage();
  await openEditor(other);
  await save(other);
  await rename(page, 'First tab wins');
  await save(page);
  await rename(other, 'Stale tab loses');
  await other.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(other.getByRole('dialog', { name: 'استعادة الحفظ المحلي' })).toContainText(
    'تبويب آخر',
  );
  await expect(other.locator('.save-state--error')).toBeVisible();
  expect((await stored(other))?.name).toBe('First tab wins');
  await expect(other.getByRole('button', { name: 'نسخ التصميم الحالي' })).toBeVisible();
});

test('quota errors leave the saved revision intact and show not-saved state', async ({ page }) => {
  await openEditor(page);
  await save(page);
  const before = (await stored(page))!;
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'documents')
        throw new DOMException('Injected full quota', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await rename(page, 'Unsaved quota change');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.locator('.save-state--error')).toBeVisible();
  expect((await stored(page))?.revision).toBe(before.revision);
});

test('unavailable IndexedDB is visible and never silently overwrites legacy data', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true }),
  );
  await page.goto('/api/health');
  const legacy = JSON.stringify(qualityDoc());
  await page.evaluate((value) => localStorage.setItem('poster.design.v1', value), legacy);
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'استعادة الحفظ المحلي' })).toContainText(
    'تعذر فتح الحفظ المحلي',
  );
  await expect(page.locator('.save-state--error')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('poster.design.v1'))).toBe(legacy);
});
