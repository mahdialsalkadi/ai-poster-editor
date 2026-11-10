import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseDesignHtml } from '@poster/core';
import { buildServer } from '../src/app.js';
import { RenderQueue, type QueueMetrics } from '../src/export/queue.js';

describe('operational metrics', () => {
  it('reports queue occupancy, handoff, rejection and completion', async () => {
    const events: QueueMetrics[] = [];
    const queue = new RenderQueue(1, 1, (metrics) => events.push(metrics));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run(() => gate);
    const second = queue.run(async () => 'second');
    expect(queue.metrics).toMatchObject({ active: 1, waiting: 1, rejectedTotal: 0 });
    await expect(queue.run(async () => 'third')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(queue.metrics.rejectedTotal).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(queue.metrics).toEqual({
      active: 0,
      waiting: 0,
      concurrency: 1,
      maxWaiting: 1,
      rejectedTotal: 1,
    });
    expect(events.map(({ active, waiting }) => [active, waiting])).toEqual([
      [1, 0],
      [1, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
  });

  it('does not let a failed metrics observer change queue behavior', async () => {
    const queue = new RenderQueue(1, 0, () => {
      throw new Error('logger unavailable');
    });
    await expect(queue.run(async () => 42)).resolves.toBe(42);
    expect(queue.metrics.active).toBe(0);
  });

  it('emits API queue metrics for a real HTML export without design data', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const app = await buildServer({ logger: true, logStream: stream, auth: null, ai: null });
    const doc = parseDesignHtml(
      '<div class="artboard" data-width="400px" data-height="400px"><div data-id="title" data-type="text" style="position:absolute;left:0px;top:0px;width:200px">private-design-sentinel</div></div>',
    ).doc;
    const boundary = 'metrics-test';
    const payload =
      ['options', 'doc']
        .map((field) => {
          const value = field === 'options' ? { format: 'html' } : doc;
          return `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n`;
        })
        .join('') + `--${boundary}--\r\n`;
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/export',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      expect(response.statusCode).toBe(200);
      const records = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const events = records.filter((record) => record.event === 'export.queue');
      expect(events.map((record) => record.active)).toEqual([1, 0]);
      expect(events.every((record) => record.scope === 'api')).toBe(true);
      expect(output).not.toContain('private-design-sentinel');
    } finally {
      await app.close();
    }
  });
});
