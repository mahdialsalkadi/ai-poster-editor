import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { visualDoc } from './fixtures.js';

const require = createRequire(import.meta.url);
const testVersion = (require('@playwright/test/package.json') as { version: string }).version;
const serverRequire = createRequire(new URL('../apps/server/package.json', import.meta.url));
const serverVersion = (serverRequire('playwright/package.json') as { version: string }).version;

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
    expect(png).toMatchSnapshot(`${kind}.png`, { threshold: 0.2, maxDiffPixelRatio: 0.003 });
  });
}
