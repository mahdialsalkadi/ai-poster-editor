import { expect, type Locator, type Page } from '@playwright/test';
import type { StoredDocument } from '../apps/web/src/editor/documents.js';

export async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.save-state--saved')).toBeVisible();
}
export function layer(page: Page, id: string): Locator {
  return page.locator(`.artboard [data-layer-id="${id}"]`);
}
export async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.locator('.save-state--saved')).toBeVisible();
}
export async function stored(page: Page, key = 'current'): Promise<StoredDocument | null> {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('poster.assets', 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<StoredDocument | null>((resolve, reject) => {
        const r = db.transaction('documents', 'readonly').objectStore('documents').get(key);
        r.onsuccess = () => resolve((r.result as StoredDocument | undefined) ?? null);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, key);
}
export async function storeCount(page: Page, store: string): Promise<number> {
  return page.evaluate(async (store) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('poster.assets', 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const r = db.transaction(store, 'readonly').objectStore(store).count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, store);
}
export async function pasteText(page: Page, target: Locator, text: string): Promise<void> {
  await target.dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await page.evaluate(
    async (text) =>
      navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob(['<b>Untrusted rich paste</b>'], { type: 'text/html' }),
        }),
      ]),
    text,
  );
  await editor.press('ControlOrMeta+A');
  await editor.press('ControlOrMeta+V');
  await expect(editor).toHaveValue(text);
  await editor.press('ControlOrMeta+Enter');
  await expect(editor).toHaveCount(0);
}
export async function rename(page: Page, name: string): Promise<void> {
  await page.locator('.doc-title').click();
  const input = page.getByRole('textbox', { name: 'اسم التصميم' });
  await input.fill(name);
  await input.press('Enter');
}
