import { expect, test } from '@playwright/test';
import { serializeDesignDoc } from '../packages/core/src/index.js';
import { qualityDoc } from './fixtures.js';
import { layer, openEditor } from './helpers.js';

test('trusted input exercises Shift selection, marquee, layer clipboard and viewport pan', async ({
  page,
}) => {
  await openEditor(page);
  const doc = qualityDoc();
  const shape = doc.layers.find((item) => item.type === 'shape')!;
  const arabic = doc.layers.find((item) => item.id === 'arabic')!;
  doc.layers = [
    { ...shape, id: 'one', left: 100, top: 100, width: 100, height: 80 },
    { ...shape, id: 'two', left: 300, top: 100, width: 100, height: 80 },
    { ...arabic, top: 350 },
  ];
  await page
    .locator('input[type="file"][accept^=".html"]')
    .setInputFiles({
      name: 'interactions.html',
      mimeType: 'text/html',
      buffer: Buffer.from(serializeDesignDoc(doc)),
    });
  await expect(layer(page, 'one')).toBeVisible();
  await layer(page, 'one').click();
  await layer(page, 'two').click({ modifiers: ['Shift'] });
  await expect(page.locator('.artboard .layer.is-selected')).toHaveCount(2);
  const artboard = page.locator('.artboard');
  const box = await artboard.boundingBox();
  if (!box) throw new Error('No artboard');
  const scale = box.width / 600;
  await page.mouse.move(box.x + 50 * scale, box.y + 50 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 450 * scale, box.y + 220 * scale, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.artboard .layer.is-selected')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+C');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.locator('.artboard .layer')).toHaveCount(5);
  await expect
    .poll(() => layer(page, 'one-copy').evaluate((element) => element.style.left))
    .toBe('120px');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.locator('.artboard .layer')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(page.locator('.artboard .layer')).toHaveCount(5);
  const before = (await artboard.boundingBox())!;
  await page.mouse.move(before.x + 20, before.y + 20);
  await page.mouse.wheel(25, 30);
  await expect.poll(async () => Math.round((await artboard.boundingBox())!.x - before.x)).toBe(-25);
  await expect.poll(async () => Math.round((await artboard.boundingBox())!.y - before.y)).toBe(-30);
  const panned = (await artboard.boundingBox())!;
  await page.keyboard.down('Space');
  await page.mouse.move(panned.x + 20, panned.y + 20);
  await page.mouse.down();
  await page.mouse.move(panned.x + 70, panned.y + 70, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect.poll(async () => Math.round((await artboard.boundingBox())!.x - panned.x)).toBe(50);
  await expect
    .poll(() => layer(page, 'one-copy').evaluate((element) => element.style.left))
    .toBe('120px');
});

test('the built editor blocks inline scripts and external image requests with CSP', async ({
  page,
}) => {
  let contacted = false;
  await page.route('https://example.invalid/**', async (route) => {
    contacted = true;
    await route.fulfill({ status: 200, body: 'blocked test request' });
  });
  await openEditor(page);
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("script-src 'self'");
  const executed = await page.evaluate(async () => {
    const state = window as Window & { cspSentinel?: boolean };
    state.cspSentinel = false;
    const script = document.createElement('script');
    script.textContent = 'window.cspSentinel = true';
    document.head.append(script);
    script.remove();
    await new Promise<void>((resolve) => {
      const image = new Image();
      image.onerror = () => resolve();
      image.onload = () => resolve();
      image.src = 'https://example.invalid/pixel.png';
      document.body.append(image);
    });
    return state.cspSentinel;
  });
  expect(executed).toBe(false);
  expect(contacted).toBe(false);
});
