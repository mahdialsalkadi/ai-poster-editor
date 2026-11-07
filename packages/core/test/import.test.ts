import { describe, expect, it } from 'vitest';
import {
  DesignError,
  LimitExceededError,
  importDesignDocument,
  type ImageLayer,
  type ShapeLayer,
  type TextLayer,
} from '../src/index';

const exported = (inner: string, head = ''): string =>
  `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
${head}
<style>.artboard{}</style>
</head>
<body>
<div class="artboard" style="position:relative;overflow:hidden;width:600px;height:800px;background:#0f172a">
${inner}
</div>
</body>
</html>`;

const textLayer =
  '<div data-id="title" data-layer="Title" data-type="text" dir="rtl" style="position:absolute;left:40px;top:40px;width:520px;font-family:\'Cairo\', sans-serif;font-size:64px;font-weight:700;color:#fff;text-align:center;line-height:1.2;text-transform:none;direction:rtl;white-space:pre-wrap;overflow-wrap:break-word">مرحبا <span style="color:#38bdf8">بالعالم</span></div>';

const shapeLayer =
  '<div data-id="card" data-layer="Card" data-type="shape" style="position:absolute;left:40px;top:200px;width:520px;height:300px;background:linear-gradient(135deg, #1e293b 0%, #334155 100%);border-radius:24px;transform:rotate(0deg);opacity:1"></div>';

describe('importing an exported HTML document', () => {
  it('drops the document wrapper and rebuilds the artboard from CSS', () => {
    const { doc, warnings } = importDesignDocument(exported(`${textLayer}${shapeLayer}`));

    expect(doc.width).toBe(600);
    expect(doc.height).toBe(800);
    expect(doc.background).toEqual({ kind: 'solid', color: '#0f172a' });
    expect(doc.layers.map((layer) => layer.id)).toEqual(['title', 'card']);
    expect(warnings).toEqual([]);

    const title = doc.layers[0] as TextLayer;
    expect(title.type).toBe('text');
    expect(title.name).toBe('Title');
    expect(title.dir).toBe('rtl');
    expect(title.style.fontFamily).toBe('Cairo');
    expect(title.style.fontSize).toBe(64);
    expect(title.style.fontWeight).toBe(700);
    expect(title.content).toEqual([
      { kind: 'text', text: 'مرحبا ' },
      { kind: 'span', text: 'بالعالم', color: '#38bdf8' },
    ]);

    const card = doc.layers[1] as ShapeLayer;
    expect(card.type).toBe('shape');
    expect(card.width).toBe(520);
    expect(card.height).toBe(300);
    expect(card.style.radius).toBe(24);
    expect(card.style.fill.kind).toBe('linear');
  });

  it('keeps inline span styling', () => {
    const html = exported(
      `<div data-id="t" data-layer="T" data-type="text" style="position:absolute;left:0;top:0;width:400px;font-family:Cairo;font-size:32px;color:#fff">a <span style="font-weight:700;color:#38bdf8">b</span></div>`,
    );
    const layer = importDesignDocument(html).doc.layers[0] as TextLayer;
    expect(layer.content).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'span', text: 'b', bold: true, color: '#38bdf8' },
    ]);
  });

  it('extracts inlined images as assets and rewrites their src', () => {
    const html = exported(
      '<img data-id="hero" data-layer="Hero" data-type="image" src="data:image/png;base64,iVBORw0KGgo=" alt="Hero" data-prompt="a cat" style="position:absolute;left:0;top:0;width:100px;height:100px;object-fit:cover;object-position:50% 50%;border-radius:8px">',
    );
    const { doc, assets } = importDesignDocument(html);

    expect(assets).toEqual([{ id: 'imported_1', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }]);
    const layer = doc.layers[0] as ImageLayer;
    expect(layer.type).toBe('image');
    expect(layer.src).toBe('asset:imported_1');
    expect(layer.prompt).toBe('a cat');
    expect(layer.style.fit).toBe('cover');
    expect(layer.style.radius).toBe(8);
  });

  it('ignores head metadata but still drops unsupported artboard children', () => {
    const html = exported(
      '<script>alert(1)</script><meta name="x" content="y"><div data-id="s" data-layer="S" data-type="shape" style="position:absolute;left:0;top:0;width:10px;height:10px;background:#fff"></div>',
      '<script>alert(1)</script>',
    );
    const { doc, warnings } = importDesignDocument(html);
    expect(doc.layers).toHaveLength(1);
    expect(warnings.some((warning) => warning.code === 'UNKNOWN_TAG_DROPPED')).toBe(true);
  });

  it('preserves hidden and locked flags', () => {
    const html =
      '<div class="artboard" data-width="600px" data-height="800px">' +
      '<div data-id="s" data-layer="S" data-type="shape" data-hidden="true" data-locked="true" style="position:absolute;left:0;top:0;width:10px;height:10px;background:#fff"></div>' +
      '</div>';
    const { doc } = importDesignDocument(html);
    expect(doc.width).toBe(600);
    expect(doc.layers[0]?.hidden).toBe(true);
    expect(doc.layers[0]?.locked).toBe(true);
  });

  it('rejects documents without an artboard', () => {
    expect(() =>
      importDesignDocument('<!doctype html><html><body><p>hi</p></body></html>'),
    ).toThrow(DesignError);
  });

  it('rejects artboard sizes that are not in px', () => {
    expect(() =>
      importDesignDocument(
        '<!doctype html><html><body><div class="artboard" style="width:100%;height:800px"></div></body></html>',
      ),
    ).toThrow(DesignError);
  });

  it('rejects an oversized import', () => {
    expect(() => importDesignDocument('x'.repeat(41 * 1024 * 1024))).toThrow(LimitExceededError);
  });
});
