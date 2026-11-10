import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DesignDoc, ImageLayer } from '@poster/core';
import { A4_SIZE } from '@poster/core';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { buildServer } from '../src/app.js';
import { closeExportBrowser } from '../src/export/renderer.js';
import { RenderQueue } from '../src/export/queue.js';

const BASE_LAYER = { rotation: 0, opacity: 1, hidden: false, locked: false } as const;

function textDoc(width = 300, height = 400): DesignDoc {
  return {
    schemaVersion: 1,
    width,
    height,
    background: { kind: 'solid', color: '#0f172a' },
    layers: [
      {
        ...BASE_LAYER,
        id: 'title',
        name: 'Title',
        left: 20,
        top: 20,
        width: width - 40,
        type: 'text',
        dir: 'rtl',
        content: [{ kind: 'text', text: 'مرحبا بالعالم' }],
        style: {
          fontFamily: 'Cairo',
          fontSize: 32,
          fontWeight: 700,
          italic: false,
          underline: false,
          color: '#ffffff',
          align: 'right',
          lineHeight: 1.3,
          letterSpacing: 0,
          textTransform: 'none',
        },
      },
      {
        ...BASE_LAYER,
        id: 'card',
        name: 'Card',
        left: 20,
        top: 200,
        width: width - 40,
        height: 120,
        type: 'shape',
        style: { fill: { kind: 'solid', color: '#f5a524' }, radius: 16 },
      },
    ],
  };
}

function imageDoc(): DesignDoc {
  const doc = textDoc();
  const layer: ImageLayer = {
    ...BASE_LAYER,
    id: 'photo',
    name: 'Photo',
    left: 0,
    top: 0,
    width: doc.width,
    height: doc.height,
    type: 'image',
    src: 'asset:img-1',
    style: { fit: 'cover', position: { x: 50, y: 50 }, radius: 0 },
  };
  return { ...doc, layers: [...doc.layers, layer] };
}

type Part = { name: string; data: Buffer; filename: string; contentType: string };

function multipart(
  fields: Record<string, string>,
  files: Part[] = [],
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----poster${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: application/json\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(file.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'x-request-id': 'test-export-request',
    },
  };
}

function exportBody(
  doc: DesignDoc,
  options: Record<string, unknown>,
  files: Part[] = [],
): { payload: Buffer; headers: Record<string, string> } {
  return multipart({ options: JSON.stringify(options), doc: JSON.stringify(doc) }, files);
}

async function pngAsset(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
}

describe('export API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ logger: false, rateLimits: { exportPerMinute: 1_000 } });
  });

  afterAll(async () => {
    await app.close();
    await closeExportBrowser();
  });

  it('renders a PNG at the requested integer scale', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(textDoc(), { format: 'png', scale: 2 }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['x-export-width']).toBe('600');
    expect(response.headers['x-export-height']).toBe('800');

    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(600);
    expect(metadata.height).toBe(800);
  }, 40_000);

  it('renders a JPEG with the declared content type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(textDoc(), { format: 'jpeg', scale: 1, quality: 0.8 }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(400);
  }, 40_000);

  it('renders a single PDF page sized to the artboard', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(textDoc(), { format: 'pdf', scale: 3 }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(response.headers['x-export-width']).toBe('300');
    expect(response.headers['x-export-height']).toBe('400');
  }, 40_000);

  it('exports the UI A4 size as one vector page with embedded, extractable text', async () => {
    const doc = textDoc(A4_SIZE.width, A4_SIZE.height);
    const title = doc.layers[0];
    if (title?.type !== 'text') throw new Error('Missing test text');
    title.dir = 'ltr';
    title.style.fontFamily = 'Inter';
    title.content = [{ kind: 'text', text: 'Print' }];
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(doc, { format: 'pdf' }),
    });
    expect(response.statusCode).toBe(200);
    const pdf = response.rawPayload.toString('latin1');
    const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf);
    expect(mediaBox).not.toBeNull();
    expect(Math.abs(Number(mediaBox?.[1]) - 595)).toBeLessThan(1.5);
    expect(Math.abs(Number(mediaBox?.[2]) - 842)).toBeLessThan(1.5);
    expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/ToUnicode');

    // Inspect Chromium's Flate streams without adding a PDF library. The
    // ToUnicode CMap maps glyph codes back to Unicode; Tj is vector text, not
    // a screenshot. This deliberately tests our pinned Chromium PDF dialect.
    const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
      try {
        return inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
      } catch {
        return match[1]!;
      }
    });
    const cmap = streams.find((stream) => stream.includes('beginbfchar')) ?? '';
    const chars = new Map(
      [...cmap.matchAll(/<([\da-f]{4})>\s*<([\da-f]{4})>/gi)].map((match) => [
        match[1]!.toUpperCase(),
        String.fromCharCode(parseInt(match[2]!, 16)),
      ]),
    );
    const text = streams
      .flatMap((stream) => [...stream.matchAll(/<([\da-f]+)>\s*Tj/gi)])
      .map((match) =>
        (match[1]!.match(/.{4}/g) ?? [])
          .map((code) => chars.get(code.toUpperCase()) ?? '')
          .join(''),
      )
      .join('');
    expect(text).toBe('Print');
  }, 40_000);

  it('exports Arabic A4 vector text with embedded Cairo and logical Unicode mappings', async () => {
    const doc = textDoc(A4_SIZE.width, A4_SIZE.height);
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(doc, { format: 'pdf' }),
    });
    expect(response.statusCode).toBe(200);
    const pdf = response.rawPayload.toString('latin1');
    const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf);
    expect(mediaBox).not.toBeNull();
    expect(Math.abs(Number(mediaBox?.[1]) - 595)).toBeLessThan(1.5);
    expect(Math.abs(Number(mediaBox?.[2]) - 842)).toBeLessThan(1.5);
    expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    expect(pdf).toMatch(
      /\/FontName\s*\/[A-Z]+\+Cairo-Bold(?:(?!endobj)[\s\S])*?\/FontFile2\s+\d+\s+0\s+R/,
    );
    expect(pdf).toContain('/ToUnicode');

    // Chromium uses shaped Arabic glyphs in ToUnicode and logical characters in
    // ActualText marked content, with visual runs marked as ReversedChars.
    const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
      try {
        return inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
      } catch {
        return match[1]!;
      }
    });
    const textStream = streams.find((stream) => stream.includes('/ReversedChars BMC')) ?? '';
    const words = [...textStream.matchAll(/\/ReversedChars BMC([\s\S]*?)EMC\s*ET/g)].map((run) => {
      const visual = [...run[1]!.matchAll(/\/ActualText\s*<FEFF([\da-f]+)>/gi)]
        .map((match) =>
          (match[1]!.match(/.{4}/g) ?? [])
            .map((hex) => String.fromCharCode(parseInt(hex, 16)))
            .join(''),
        )
        .join('');
      return [...visual].reverse().join('');
    });
    expect(words).toEqual(['بالعالم', 'مرحبا']);
    expect([...words].reverse().join(' ')).toBe('مرحبا بالعالم');
    const cmaps = streams.filter((stream) => stream.includes('beginbfchar'));
    expect(cmaps.some((cmap) => /<FE[89A-F][\dA-F]>/i.test(cmap))).toBe(true);
    const spaceCode = cmaps.flatMap((cmap) => [
      ...cmap.matchAll(/<([\da-f]{4})>\s*<0020>/gi),
    ])[0]?.[1];
    expect(spaceCode).toBeDefined();
    expect(textStream).toMatch(new RegExp(`<${spaceCode}>\\s*Tj`, 'i'));
    expect(textStream).toContain(' Tj');
  }, 40_000);

  it('returns a self-contained HTML document with embedded fonts and images', async () => {
    const asset = await pngAsset();
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(imageDoc(), { format: 'html' }, [
        { name: 'asset:img-1', data: asset, filename: 'photo.png', contentType: 'image/png' },
      ]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    const html = response.body;
    expect(html).toContain('<div class="artboard"');
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  }, 20_000);

  it('refuses a referenced asset that was not uploaded', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(imageDoc(), { format: 'png', scale: 1 }),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('ASSET_UNRESOLVED');
  });

  it('rejects bytes that are not a PNG, JPEG or WebP', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(imageDoc(), { format: 'html' }, [
        {
          name: 'asset:img-1',
          data: Buffer.from('this is not an image'),
          filename: 'notes.txt',
          contentType: 'image/png',
        },
      ]),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_DOC');
    expect(response.json().error.path).toBe('assets.img-1');
  });

  it('rejects an output above the 40 MP limit before rendering', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(textDoc(4000, 4000), { format: 'png', scale: 3 }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('LIMIT_EXCEEDED');
  });

  it('serves a repeated idempotency key from the stored result', async () => {
    const request = exportBody(textDoc(), {
      format: 'png',
      scale: 1,
      idempotencyKey: 'export-idempotency-1',
    });
    const first = await app.inject({ method: 'POST', url: '/api/export', ...request });
    const second = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...exportBody(textDoc(), {
        format: 'png',
        scale: 1,
        idempotencyKey: 'export-idempotency-1',
      }),
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.headers['x-export-cache']).toBe('miss');
    expect(second.headers['x-export-cache']).toBe('hit');
    expect(second.headers['x-export-id']).toBe(first.headers['x-export-id']);
    expect(second.rawPayload.equals(first.rawPayload)).toBe(true);
  }, 40_000);

  it('requires multipart form data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      payload: { options: { format: 'png' }, doc: textDoc() },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_DOC');
  });

  it('publishes the export limits', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/export/limits' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.formats).toEqual(['png', 'jpeg', 'pdf', 'html']);
    expect(response.json().data.concurrency).toBe(2);
  });
});

describe('render queue', () => {
  it('bounds concurrency and rejects when the queue is full', async () => {
    const queue = new RenderQueue(1, 1);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = queue.run(async () => {
      await gate;
      return 'first';
    });
    const second = queue.run(async () => 'second');

    await expect(queue.run(async () => 'third')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });

    release?.();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });
});
