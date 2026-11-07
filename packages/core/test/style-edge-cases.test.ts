import { describe, expect, it } from 'vitest';
import { parseDesignHtml, serializeDesignDoc, type ShapeLayer, type TextLayer } from '../src/index';

const artboard = (inner: string): string =>
  `<div class="artboard" data-width="400px" data-height="400px" style="background:#ffffff">${inner}</div>`;

const textLayer = (style: string, content = 'Hello', attrs = ''): string =>
  `<div data-id="t" data-layer="T" data-type="text" ${attrs} style="position:absolute;left:0px;top:0px;width:200px;${style}">${content}</div>`;

const shapeLayer = (style: string): string =>
  `<div data-id="s" data-layer="S" data-type="shape" style="position:absolute;left:0px;top:0px;width:50px;height:50px;${style}"></div>`;

describe('text-shadow spread', () => {
  it('drops a fourth length and reports it', () => {
    const { doc, warnings } = parseDesignHtml(
      artboard(textLayer("font-family:Inter;font-size:16px;text-shadow:1px 2px 3px 4px #000000")),
    );
    const layer = doc.layers[0] as TextLayer;

    expect(layer.style.shadow).toEqual({ x: 1, y: 2, blur: 3, color: '#000000' });
    expect(layer.style.shadow?.spread).toBeUndefined();

    const warning = warnings.find((item) => item.path.endsWith('text-shadow'));
    expect(warning?.code).toBe('UNSUPPORTED_VALUE');
    expect(warning?.message).toContain('spread');
  });

  it('keeps a three-length text shadow without warnings', () => {
    const { doc, warnings } = parseDesignHtml(
      artboard(textLayer('font-family:Inter;font-size:16px;text-shadow:1px 2px 3px #000000')),
    );
    expect(warnings).toEqual([]);
    expect((doc.layers[0] as TextLayer).style.shadow).toEqual({
      x: 1,
      y: 2,
      blur: 3,
      color: '#000000',
    });
  });

  it('keeps spread for box-shadow', () => {
    const { doc, warnings } = parseDesignHtml(
      artboard(shapeLayer('background:#111111;box-shadow:0px 4px 8px 2px #00000080')),
    );
    expect(warnings).toEqual([]);
    expect((doc.layers[0] as ShapeLayer).style.shadow).toEqual({
      x: 0,
      y: 4,
      blur: 8,
      spread: 2,
      color: '#00000080',
    });
  });
});

describe('border styles', () => {
  it.each(['solid', 'dashed', 'dotted'] as const)('round-trips a %s border', (style) => {
    const { doc, warnings } = parseDesignHtml(
      artboard(shapeLayer(`background:#111111;border:2px ${style} #ffffff`)),
    );
    expect(warnings).toEqual([]);

    const layer = doc.layers[0] as ShapeLayer;
    expect(layer.style.border).toEqual({ width: 2, style, color: '#ffffff' });

    const html = serializeDesignDoc(doc);
    expect(html).toContain(`border:2px ${style} #ffffff`);
    expect(parseDesignHtml(html).doc).toEqual(doc);
  });
});

describe('font stack resolution', () => {
  it('considers only the first family in the stack', () => {
    const { doc, warnings } = parseDesignHtml(
      artboard(textLayer("font-family:'Arial', 'Cairo';font-size:16px")),
    );
    const layer = doc.layers[0] as TextLayer;

    expect(layer.style.fontFamily).toBe('Inter');
    expect(warnings.some((item) => item.code === 'FONT_FALLBACK')).toBe(true);
  });

  it('keeps an allowed first family and ignores the trailing stack', () => {
    const { doc, warnings } = parseDesignHtml(
      artboard(textLayer("font-family:'Cairo', sans-serif;font-size:16px", 'مرحبا', 'dir="rtl"')),
    );
    expect(warnings).toEqual([]);
    expect((doc.layers[0] as TextLayer).style.fontFamily).toBe('Cairo');
  });
});
