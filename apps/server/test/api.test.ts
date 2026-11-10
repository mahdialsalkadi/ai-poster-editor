import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseDesignHtml } from '@poster/core';
import { buildServer } from '../src/app.js';

const validHtml =
  '<div class="artboard" data-width="600px" data-height="800px" style="background:#0f172a">' +
  '<div data-id="title" data-layer="Title" data-type="text" dir="rtl" style="position:absolute;left:40px;top:40px;width:520px;font-family:Cairo;font-size:64px;color:#fff;text-align:center">مرحبا</div>' +
  '</div>';

describe('API', () => {
  it.each(['/api/design/validate', '/api/design/serialize', '/api/design/merge'])(
    'rate limits %s before doing expensive work',
    async (url) => {
      const limited = await buildServer({
        logger: false,
        auth: null,
        ai: null,
        rateLimits: { designPerMinute: 1 },
      });
      const doc = parseDesignHtml(validHtml).doc;
      const payload = url.endsWith('validate')
        ? { designHtml: validHtml }
        : url.endsWith('serialize')
          ? { doc }
          : { base: doc, patch: doc };
      try {
        expect((await limited.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
        const response = await limited.inject({ method: 'POST', url, payload });
        expect(response.statusCode).toBe(429);
        expect(response.json().error.code).toBe('RATE_LIMITED');
      } finally {
        await limited.close();
      }
    },
  );

  it('rejects UTF-8 oversized documents and style attributes at the design API', async () => {
    for (const designHtml of [
      'س'.repeat(102_401),
      validHtml.replace('font-size:64px', '--note:' + 'x'.repeat(8193)),
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/design/validate',
        payload: { designHtml },
      });
      expect([413, 422]).toContain(response.statusCode);
      expect(['LIMIT_EXCEEDED', 'INVALID_DOC']).toContain(response.json().error.code);
    }
  });
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health and limits', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.status).toBe('ok');
    expect(body.data.limits.layers).toBe(200);
    expect(body.requestId).toBeTruthy();
  });

  it('explains that standalone asset uploads are unsupported', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/assets' });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
      message:
        'Standalone asset uploads are disabled; send referenced assets with POST /api/export',
    });
  });

  it('validates Design HTML', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/design/validate',
      payload: { designHtml: validHtml },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.doc.layers).toHaveLength(1);
    expect(body.data.doc.layers[0].style.fontFamily).toBe('Cairo');
  });

  it('returns a structured error for invalid input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/design/validate',
      payload: { designHtml: '<div class="artboard"></div>' },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.code).toBe('INVALID_DOC');
    expect(body.error.requestId).toBeTruthy();
  });

  it('returns SECURITY_VIOLATION for scripts', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/design/validate',
      payload: {
        designHtml:
          '<div class="artboard" data-width="600px" data-height="800px"><script>alert(1)</script></div>',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SECURITY_VIOLATION');
  });

  it('round-trips a document through serialize', async () => {
    const validated = await app.inject({
      method: 'POST',
      url: '/api/design/validate',
      payload: { designHtml: validHtml },
    });
    const doc = validated.json().data.doc;
    const serialized = await app.inject({
      method: 'POST',
      url: '/api/design/serialize',
      payload: { doc },
    });
    expect(serialized.statusCode).toBe(200);
    const designHtml = serialized.json().data.designHtml;
    expect(parseDesignHtml(designHtml).doc).toEqual(doc);
  });

  it('rejects generation until a provider is configured', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/generate',
      payload: {
        prompt: 'ملصق معرض فني في الرياض',
        width: 1080,
        height: 1350,
        language: 'ar',
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNSUPPORTED_FEATURE');
  });

  it('rejects AI edit until a provider is configured', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/edit',
      payload: {
        designHtml: validHtml,
        instruction: 'Make the title blue',
        selectedLayerIds: ['title'],
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNSUPPORTED_FEATURE');
  });

  it('rejects a JSON export body and requires multipart form data', async () => {
    const validated = await app.inject({
      method: 'POST',
      url: '/api/design/validate',
      payload: { designHtml: validHtml },
    });
    const doc = validated.json().data.doc;
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      payload: { options: { format: 'png', scale: 2 }, doc, assets: [] },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_DOC');
  });

  it('advertises the export formats, scales and asset cap', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/export/limits' });
    expect(response.statusCode).toBe(200);
    const limits = response.json().data;
    expect(limits.formats).toEqual(['png', 'jpeg', 'pdf', 'html']);
    expect(limits.scales).toEqual([1, 2, 3]);
    expect(limits.maxAssets).toBe(20);
  });
});
