import { describe, expect, it } from 'vitest';
import {
  DesignError,
  LimitExceededError,
  parseDesignHtml,
  quantize,
  validateDesignDoc,
  type DesignDoc,
  type ShapeLayer,
} from '../src/index';

const artboard = (inner: string, width = 400, height = 400): string =>
  `<div class="artboard" data-width="${width}px" data-height="${height}px" style="background:#ffffff">${inner}</div>`;

const shape = (
  id: string,
  style = 'position:absolute;left:0px;top:0px;width:1px;height:1px',
): string => `<div data-id="${id}" data-layer="${id}" data-type="shape" style="${style}"></div>`;

describe('document byte limit', () => {
  const base = '<div class="artboard" data-width="400px" data-height="400px"></div>';
  const limit = 200 * 1024;

  it('accepts a document of exactly 200 KiB', () => {
    const padding = limit - base.length - '<!--'.length - '-->'.length;
    const html = `${base}<!--${'x'.repeat(padding)}-->`;
    expect(new TextEncoder().encode(html).length).toBe(limit);
    expect(parseDesignHtml(html).doc.layers).toEqual([]);
  });

  it('rejects a document one byte above the limit', () => {
    const padding = limit - base.length - '<!--'.length - '-->'.length + 1;
    const html = `${base}<!--${'x'.repeat(padding)}-->`;
    expect(new TextEncoder().encode(html).length).toBe(limit + 1);
    expect(() => parseDesignHtml(html)).toThrow(LimitExceededError);
  });
});

describe('layer limits', () => {
  it('accepts exactly 200 layers', () => {
    const html = artboard(Array.from({ length: 200 }, (_, index) => shape(`l${index}`)).join(''));
    expect(parseDesignHtml(html).doc.layers).toHaveLength(200);
  });

  it('rejects 201 layers', () => {
    const html = artboard(Array.from({ length: 201 }, (_, index) => shape(`l${index}`)).join(''));
    expect(() => parseDesignHtml(html)).toThrow(LimitExceededError);
  });

  it('rejects duplicate layer ids while parsing', () => {
    expect(() => parseDesignHtml(artboard(`${shape('same')}${shape('same')}`))).toThrow(
      DesignError,
    );
  });

  it('rejects duplicate layer ids when validating a document', () => {
    const doc = parseDesignHtml(artboard(shape('a'))).doc;
    const duplicated: DesignDoc = {
      ...doc,
      layers: [doc.layers[0] as ShapeLayer, doc.layers[0] as ShapeLayer],
    };
    expect(() => validateDesignDoc(duplicated)).toThrow(DesignError);
  });
});

describe('artboard limits', () => {
  it.each([
    ['too small', 99, 400],
    ['too wide', 400, 5001],
  ])('rejects an artboard that is %s', (_name, width, height) => {
    expect(() => parseDesignHtml(artboard('', width, height))).toThrow(LimitExceededError);
  });

  it('accepts the maximum artboard side', () => {
    const doc = parseDesignHtml(artboard('', 5000, 5000)).doc;
    expect(doc.width).toBe(5000);
  });
});

describe('text limits', () => {
  it('rejects a text layer above 10k codepoints', () => {
    const text = `<div data-id="t" data-layer="T" data-type="text" style="position:absolute;left:0px;top:0px;width:100px;font-size:16px">${'a'.repeat(10_001)}</div>`;
    expect(() => parseDesignHtml(artboard(text))).toThrow(LimitExceededError);
  });

  it('accepts a text layer at 10k codepoints', () => {
    const text = `<div data-id="t" data-layer="T" data-type="text" style="position:absolute;left:0px;top:0px;width:100px;font-size:16px">${'a'.repeat(10_000)}</div>`;
    expect(parseDesignHtml(artboard(text)).doc.layers).toHaveLength(1);
  });
});

describe('style limits', () => {
  it('enforces the 8 KiB style limit by UTF-8 bytes, including custom properties', () => {
    const prefix = 'position:absolute;width:10px;height:10px;--note:';
    const exact = prefix + 'x'.repeat(8192 - prefix.length);
    expect(parseDesignHtml(artboard(shape('s', exact))).doc.layers).toHaveLength(1);
    expect(() => parseDesignHtml(artboard(shape('s', exact + 'x')))).toThrow(LimitExceededError);
    expect(() => parseDesignHtml(artboard(shape('s', prefix + 'س'.repeat(4096))))).toThrow(
      LimitExceededError,
    );
  });
  it('rejects more than 64 declarations in one style attribute', () => {
    const extra = Array.from({ length: 70 }, (_, index) => `--v${index}:1`).join(';');
    const layer = `<div data-id="s" data-layer="S" data-type="shape" style="position:absolute;left:0px;top:0px;width:10px;height:10px;${extra}"></div>`;
    expect(() => parseDesignHtml(artboard(layer))).toThrow(LimitExceededError);
  });
});

describe('SVG limits', () => {
  const svg = (inner: string): string =>
    `<svg data-id="s" data-layer="S" data-type="svg" style="position:absolute;left:0px;top:0px;width:100px;height:100px">${inner}</svg>`;

  it('rejects nesting deeper than 16 levels', () => {
    const open = '<g>'.repeat(18);
    const close = '</g>'.repeat(18);
    expect(() => parseDesignHtml(artboard(svg(`${open}<path d="M0 0"></path>${close}`)))).toThrow(
      LimitExceededError,
    );
  });

  it('rejects more than 2000 SVG nodes', () => {
    const circle = '<circle cx="1" cy="1" r="1"></circle>';
    expect(() => parseDesignHtml(artboard(svg(circle.repeat(2001))))).toThrow(LimitExceededError);
  });

  it('rejects an over-long path', () => {
    const path = `<path d="M0 0 ${'L1 1 '.repeat(5_000)}"></path>`;
    expect(() => parseDesignHtml(artboard(svg(path)))).toThrow(LimitExceededError);
  });
});

describe('number canonicalization', () => {
  it('quantizes to two decimals and never returns -0', () => {
    expect(quantize(80.004)).toBe(80);
    expect(quantize(80.005)).toBe(80.01);
    expect(quantize(-0.001)).toBe(0);
    expect(Object.is(quantize(-0.001), -0)).toBe(false);
    expect(quantize(12.345)).toBe(12.35);
  });

  it('quantizes layer geometry while parsing', () => {
    const doc = parseDesignHtml(
      artboard(
        shape('q', 'position:absolute;left:10.004px;top:10.006px;width:20.005px;height:30.014px'),
      ),
    ).doc;
    const layer = doc.layers[0] as ShapeLayer;
    expect([layer.left, layer.top, layer.width, layer.height]).toEqual([10, 10.01, 20.01, 30.01]);
  });
});
