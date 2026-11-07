import {
  SecurityViolationError,
  importDesignDocument,
  parseDesignHtml,
  serializeDesignDoc,
} from '@poster/core';
import { EXPORT_LIMITS, exportRequestSchema } from '@poster/contracts';
import { describe, expect, it } from 'vitest';
import { serializeForExport } from '../src/export/serialize.js';

const doc = parseDesignHtml(
  '<div class="artboard" data-width="600px" data-height="800px" style="background:#0f172a"></div>',
).doc;

const request = (options: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  options,
  doc,
  ...extra,
});

describe('export request contract', () => {
  it('accepts every contract format', () => {
    for (const format of ['png', 'jpeg', 'pdf', 'html']) {
      expect(exportRequestSchema.safeParse(request({ format })).success).toBe(true);
    }
  });

  it('accepts only 1x, 2x and 3x', () => {
    for (const scale of [1, 2, 3]) {
      expect(exportRequestSchema.safeParse(request({ scale })).success).toBe(true);
    }
    for (const scale of [0, 1.5, 4, '2']) {
      expect(exportRequestSchema.safeParse(request({ scale })).success).toBe(false);
    }
  });

  it('refuses Design HTML as export input', () => {
    const legacy = exportRequestSchema.safeParse({
      designHtml: '<div class="artboard" data-width="600px" data-height="800px"></div>',
    });
    expect(legacy.success).toBe(false);
  });

  it('caps the attached assets', () => {
    const asset = { id: 'img_1', mimeType: 'image/png', byteLength: 1024 };
    const many = Array.from({ length: EXPORT_LIMITS.maxAssets + 1 }, (_, index) => ({
      ...asset,
      id: `img_${index}`,
    }));

    expect(exportRequestSchema.safeParse(request({}, { assets: many })).success).toBe(false);
    expect(
      exportRequestSchema.safeParse(request({}, { assets: many.slice(0, EXPORT_LIMITS.maxAssets) }))
        .success,
    ).toBe(true);
  });

  it('defaults format to png, scale to 1 and assets to an empty list', () => {
    const parsed = exportRequestSchema.parse(request({}));
    expect(parsed.options).toEqual({ format: 'png', scale: 1, quality: 0.92 });
    expect(parsed.assets).toEqual([]);
  });
});

describe('export -> import round trip', () => {
  const designHtml = parseDesignHtml(
    '<div class="artboard" data-width="1080px" data-height="1350px" style="background:#0f172a">' +
      '<div data-id="title" data-layer="Title" data-type="text" dir="rtl" style="position:absolute;left:40px;top:40px;width:1000px;font-family:Cairo;font-size:64px;color:#fff;text-align:center">مرحبا</div>' +
      '<div data-id="card" data-layer="Card" data-type="shape" style="position:absolute;left:40px;top:200px;width:600px;height:300px;background:#1e293b;border-radius:24px"></div>' +
      '</div>',
  ).doc;

  it('the html export is a full document and is rejected on import (contract §12.1)', () => {
    const html = serializeForExport(designHtml, new Map());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');

    // Import expects a Design HTML fragment; <head> metadata is a banned tag
    // (contract §1 and §9), so feeding a downloaded export back in fails here.
    expect(() => parseDesignHtml(html)).toThrow(SecurityViolationError);
    expect(() => parseDesignHtml(html)).toThrow('Forbidden HTML tag: meta');
  });

  it('the design HTML copy (serializeDesignDoc) is the re-importable round trip', () => {
    expect(parseDesignHtml(serializeDesignDoc(designHtml)).doc).toEqual(designHtml);
  });

  it('the html export re-imports into the original document', () => {
    const imported = importDesignDocument(serializeForExport(designHtml, new Map()));
    expect(imported.assets).toEqual([]);
    expect(imported.warnings).toEqual([]);
    expect(imported.doc).toEqual(designHtml);
  });

  it('extracts an inlined image back into an asset instead of rejecting the data URI', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const withImage = parseDesignHtml(
      '<div class="artboard" data-width="600px" data-height="800px" style="background:#0f172a">' +
        '<img data-id="hero" data-layer="Hero" data-type="image" src="asset:hero" style="position:absolute;left:0;top:0;width:100px;height:100px;object-fit:cover">' +
        '</div>',
    ).doc;

    const imported = importDesignDocument(
      serializeForExport(
        withImage,
        new Map([
          [
            'hero',
            {
              id: 'hero',
              mime: 'image/png',
              width: 1,
              height: 1,
              bytes: png,
              dataUri: `data:image/png;base64,${png.toString('base64')}`,
            },
          ],
        ]),
      ),
    );

    expect(imported.assets).toEqual([
      { id: 'imported_1', mimeType: 'image/png', base64: png.toString('base64') },
    ]);
    const layer = imported.doc.layers[0];
    expect(layer?.type).toBe('image');
    if (layer?.type === 'image') expect(layer.src).toBe('asset:imported_1');
  });
});
