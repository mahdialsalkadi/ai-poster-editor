import { parseDesignHtml } from '@poster/core';
import { EXPORT_LIMITS, exportRequestSchema } from '@poster/contracts';
import { describe, expect, it } from 'vitest';

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
