import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { visualDoc } from './fixtures.js';

const require = createRequire(import.meta.url);
const testVersion = (require('@playwright/test/package.json') as { version: string }).version;
const serverRequire = createRequire(new URL('../apps/server/package.json', import.meta.url));
const serverVersion = (serverRequire('playwright/package.json') as { version: string }).version;
const sharp = serverRequire('sharp') as (input: Buffer) => {
  raw(): {
    toBuffer(options: {
      resolveWithObject: true;
    }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }>;
  };
};

async function decoded(png: Buffer) {
  return sharp(png).raw().toBuffer({ resolveWithObject: true });
}

async function assertVisualMatch(kind: string, actual: Buffer) {
  const path = new URL(`./goldens/${kind}.png`, import.meta.url);
  if (process.env.UPDATE_GOLDENS === '1') {
    await writeFile(path, actual);
    return;
  }
  const expected = await readFile(path);
  const [actualImage, expectedImage] = await Promise.all([decoded(actual), decoded(expected)]);
  expect({ width: actualImage.info.width, height: actualImage.info.height }).toEqual({
    width: expectedImage.info.width,
    height: expectedImage.info.height,
  });
  expect(actualImage.info.channels).toBe(expectedImage.info.channels);
  const { data: actualData, info } = actualImage;
  const expectedData = expectedImage.data;
  const pixelCount = info.width * info.height;
  const perChannelThreshold = Math.round(0.2 * 255);
  let differingPixels = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const start = pixel * info.channels;
    for (let channel = 0; channel < info.channels; channel += 1) {
      const actualChannel = actualData[start + channel] ?? 0;
      const expectedChannel = expectedData[start + channel] ?? 0;
      if (Math.abs(actualChannel - expectedChannel) > perChannelThreshold) {
        differingPixels += 1;
        break;
      }
    }
  }
  expect(differingPixels / pixelCount).toBeLessThanOrEqual(0.003);
}

for (const kind of ['english', 'arabic', 'svg'] as const) {
  test(`1x ${kind} export matches its reviewed golden`, async ({ request, browser }) => {
    expect(testVersion).toBe('1.65.0');
    expect(serverVersion).toBe(testVersion);
    expect(browser.version()).toBe('158.0.8127.18');
    const response = await request.post('/api/export', {
      multipart: {
        options: JSON.stringify({ format: 'png', scale: 1 }),
        doc: JSON.stringify(visualDoc(kind)),
      },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['x-export-width']).toBe('600');
    expect(response.headers()['x-export-height']).toBe('800');
    const png = await response.body();
    expect(png.readUInt32BE(16)).toBe(600);
    expect(png.readUInt32BE(20)).toBe(800);
    await assertVisualMatch(kind, png);
  });
}
