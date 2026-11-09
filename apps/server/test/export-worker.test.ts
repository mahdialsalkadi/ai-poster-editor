import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ExportWorker, workerEnvironment } from '../src/export/renderer.js';
import type { BrowserRenderJob } from '../src/export/renderer-core.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hanging-worker.mjs');

const job: BrowserRenderJob = {
  html: '<!doctype html><div>probe</div>',
  width: 100,
  height: 100,
  format: 'png',
  scale: 1,
  quality: 0.92,
  sandbox: true,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPid(file: string): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const value = Number(readFileSync(file, 'utf8'));
      if (Number.isInteger(value) && value > 0) return value;
    } catch {
      // The fixture has not written the file yet.
    }
    await delay(50);
  }
  throw new Error('The fixture did not report its grandchild pid');
}

async function waitForDeath(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(50);
  }
  throw new Error(`Process ${pid} survived the worker timeout`);
}

describe('export worker isolation', () => {
  it('forwards only non-secret environment values to the worker', () => {
    const environment = workerEnvironment({
      AI_API_KEY: 'provider-secret',
      API_ACCESS_KEY: 'api-secret',
      SUPABASE_JWT_SECRET: 'jwt-secret',
      AUTH_COOKIE_SECRET: 'cookie-secret',
      HOME: '/home/poster',
      TMPDIR: '/tmp/poster',
      PLAYWRIGHT_BROWSERS_PATH: '/opt/browsers',
      PATH: '/usr/bin',
    });

    expect(environment).toEqual({
      HOME: '/home/poster',
      TMPDIR: '/tmp/poster',
      PLAYWRIGHT_BROWSERS_PATH: '/opt/browsers',
    });
  });

  it('renders without making any network request from the page', async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.end('network response');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('No server address');
    const worker = new ExportWorker({ timeoutMs: 15_000 });

    try {
      const result = await worker.render({
        ...job,
        html: `<!doctype html><img src="http://127.0.0.1:${address.port}/probe.png" alt="probe">`,
      });
      expect(result.bytes.byteLength).toBeGreaterThan(0);
      expect(hits).toBe(0);
    } finally {
      await worker.close();
      server.close();
    }
  }, 20_000);

  it('kills the worker process group when the total deadline expires', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'poster-worker-'));
    const pidFile = join(directory, 'grandchild.pid');
    const worker = new ExportWorker({
      entry: FIXTURE,
      args: [pidFile],
      timeoutMs: 1_000,
    });

    try {
      await expect(worker.render(job)).rejects.toMatchObject({
        code: 'EXPORT_FAILED',
        message: 'The export worker timed out',
      });
      const pid = await waitForPid(pidFile);
      await waitForDeath(pid);
    } finally {
      await worker.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);
});
