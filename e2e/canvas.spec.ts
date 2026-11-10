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
  await page.locator('input[type="file"][accept^=".html"]').setInputFiles({
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

test('selection chrome is unclipped and text corners scale the font while edges reflow', async ({
  page,
}) => {
  const doc = qualityDoc();
  const text = doc.layers.find((item) => item.type === 'text')!;
  doc.layers = [{ ...text, id: 'headline', left: 0, top: 0, width: 400, rotation: 0 }];
  await openEditor(page);
  await page.locator('input[type="file"][accept^=".html"]').setInputFiles({
    name: 'overlay.html',
    mimeType: 'text/html',
    buffer: Buffer.from(serializeDesignDoc(doc)),
  });
  await expect(layer(page, 'headline')).toBeVisible();
  await layer(page, 'headline').click();

  const artboard = page.locator('.artboard');
  const box = (await artboard.boundingBox())!;
  const scale = box.width / doc.width;

  // The north-west handle sits on the artboard corner, so half of it must be
  // painted outside the artboard bounds instead of being clipped away.
  const nw = page.locator('.artboard-overlays .handle--nw');
  await expect(nw).toBeVisible();
  const nwBox = (await nw.boundingBox())!;
  expect(nwBox.x).toBeLessThan(box.x);
  expect(nwBox.y).toBeLessThan(box.y);
  await expect(page.locator('.artboard .handle')).toHaveCount(0);

  const fontSize = () =>
    page
      .locator('[data-layer-id="headline"] .text-content')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  const before = await fontSize();

  async function drag(selector: string, dx: number, dy: number) {
    const handle = page.locator(selector);
    const handleBox = (await handle.boundingBox())!;
    const x = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
  }

  await drag('.artboard-overlays .handle--e', 80 * scale, 0);
  expect(await fontSize()).toBe(before);

  await drag('.artboard-overlays .handle--se', 60 * scale, 60 * scale);
  expect(await fontSize()).toBeGreaterThan(before);
});

test('single-key insertions add centered text, rectangle, circle and line layers', async ({
  page,
}) => {
  await openEditor(page);
  const artboard = page.locator('.artboard');
  const before = {
    all: await artboard.locator('.layer').count(),
    text: await artboard.locator('.layer--text').count(),
    shape: await artboard.locator('.layer--shape').count(),
    svg: await artboard.locator('.layer--svg').count(),
  };
  for (const key of ['t', 'r', 'c', 'l']) {
    await page.keyboard.press(key);
  }
  await expect(artboard.locator('.layer')).toHaveCount(before.all + 4);
  expect(await artboard.locator('.layer--text').count()).toBe(before.text + 1);
  expect(await artboard.locator('.layer--shape').count()).toBe(before.shape + 3);
  expect(await artboard.locator('.layer--svg').count()).toBe(before.svg);

  const box = (await artboard.boundingBox())!;
  const inserted = (await artboard.locator('.layer--text').last().boundingBox())!;
  expect(Math.abs(inserted.x + inserted.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);
  expect(Math.abs(inserted.y + inserted.height / 2 - (box.y + box.height / 2))).toBeLessThan(2);
});

test('Fit restores the viewport, overlays follow their toggles and the HUD tracks a drag', async ({
  page,
}) => {
  await openEditor(page);
  const artboard = page.locator('.artboard');
  const start = (await artboard.boundingBox())!;
  const fitLabel = (await page.getByTestId('zoom-value').textContent()) ?? '';

  await page.mouse.move(start.x + 20, start.y + 20);
  await page.mouse.wheel(25, 30);
  await expect.poll(async () => Math.round((await artboard.boundingBox())!.x - start.x)).toBe(-25);

  await page.getByTestId('zoom-fit').click();
  await expect.poll(async () => Math.round((await artboard.boundingBox())!.x - start.x)).toBe(0);
  await expect.poll(async () => Math.round((await artboard.boundingBox())!.y - start.y)).toBe(0);
  await expect(page.getByTestId('zoom-value')).toHaveText(fitLabel);

  const size = await artboard.evaluate((element) => ({
    width: Number.parseFloat(element.style.width),
    height: Number.parseFloat(element.style.height),
  }));
  const box = (await artboard.boundingBox())!;
  const scale = box.width / size.width;

  await page.getByTestId('toggle-safe-margin').click();
  const margin = (await page.locator('[data-testid="safe-margin-guide"]').boundingBox())!;
  const inset = Math.round(Math.min(size.width, size.height) * 0.07) * scale;
  expect(Math.abs(margin.x - (box.x + inset))).toBeLessThanOrEqual(1);
  expect(Math.abs(margin.width - (box.width - inset * 2))).toBeLessThanOrEqual(1);

  await page.getByTestId('toggle-bleed').click();
  const bleed = (await page.locator('[data-testid="bleed-guide"]').boundingBox())!;
  expect(Math.abs(bleed.x - (box.x - 14 * scale))).toBeLessThanOrEqual(1);

  await page.getByTestId('toggle-rulers').click();
  await expect(page.getByTestId('canvas-rulers')).toBeVisible();

  // The topmost shape is the only one that cannot be covered by another layer.
  const shape = page.locator('.artboard .layer--shape').last();
  await shape.click({ position: { x: 10, y: 10 } });
  const shapeBox = (await shape.boundingBox())!;
  const centerX = shapeBox.x + shapeBox.width / 2;
  const centerY = shapeBox.y + shapeBox.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 24, centerY + 12, { steps: 6 });
  await expect(page.getByTestId('transform-hud')).toBeVisible();
  await expect(page.getByTestId('transform-hud')).toContainText('X:');
  await page.mouse.up();
  await expect(page.getByTestId('transform-hud')).toHaveCount(0);
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
