import { describe, expect, it } from 'vitest';
import {
  DesignError,
  LimitExceededError,
  importDesignDocument,
  type ImageLayer,
  type ShapeLayer,
  type SvgLayer,
  type TextLayer,
} from '../src/index.js';

function exported(inner: string, head = ''): string {
  return `<!doctype html>
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
}

const textLayer =
  '<div data-id="title" data-layer="Title" data-type="text" dir="rtl" style="position:absolute;left:40px;top:40px;width:520px;font-family:\'Cairo\', sans-serif;font-size:64px;font-weight:700;color:#fff;text-align:center;line-height:1.2;text-transform:none;direction:rtl;white-space:pre-wrap;overflow-wrap:break-word">العنوان <span style="color:#38bdf8">الفرعي</span></div>';

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
      { kind: 'text', text: 'العنوان ' },
      { kind: 'span', text: 'الفرعي', color: '#38bdf8' },
    ]);

    const card = doc.layers[1] as ShapeLayer;
    expect(card.type).toBe('shape');
    expect(card.width).toBe(520);
    expect(card.height).toBe(300);
    expect(card.style.radius).toBe(24);
    expect(card.style.fill.kind).toBe('linear');
  });

  it('keeps inline span styling', () => {
    const { doc } = importDesignDocument(
      exported(
        '<div data-id="t" data-layer="T" data-type="text" style="position:absolute;left:0;top:0;width:400px;font-family:Cairo;font-size:32px;color:#fff">a <span style="font-weight:700;color:#38bdf8">b</span></div>',
      ),
    );
    const layer = doc.layers[0] as TextLayer;
    expect(layer.content).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'span', text: 'b', bold: true, color: '#38bdf8' },
    ]);
  });

  it('extracts inlined images as assets and rewrites their src', () => {
    const { doc, assets } = importDesignDocument(
      exported(
        '<img data-id="hero" data-layer="Hero" data-type="image" src="data:image/png;base64,iVBORw0KGgo=" alt="Hero" data-prompt="a cat" style="position:absolute;left:0;top:0;width:100px;height:100px;object-fit:cover;object-position:50% 50%;border-radius:8px">',
      ),
    );
    expect(assets).toEqual([
      { id: 'imported_1', mimeType: 'image/png', base64: 'iVBORw0KGgo=' },
    ]);
    const layer = doc.layers[0] as ImageLayer;
    expect(layer.type).toBe('image');
    expect(layer.src).toBe('asset:imported_1');
    expect(layer.prompt).toBe('a cat');
    expect(layer.style.fit).toBe('cover');
    expect(layer.style.radius).toBe(8);
  });

  it('ignores head metadata but still drops unsupported artboard children', () => {
    const { doc, warnings } = importDesignDocument(
      exported(
        '<script>alert(1)</script><meta name="x" content="y"><div data-id="s" data-layer="S" data-type="shape" style="position:absolute;left:0;top:0;width:10px;height:10px;background:#fff"></div>',
        '<script>alert(1)</script>',
      ),
    );
    expect(doc.layers).toHaveLength(1);
    expect(warnings.some((warning) => warning.code === 'UNKNOWN_TAG_DROPPED')).toBe(true);
  });

  it('preserves hidden and locked flags', () => {
    const { doc } = importDesignDocument(
      '<div class="artboard" data-width="600px" data-height="800px"><div data-id="s" data-layer="S" data-type="shape" data-hidden="true" data-locked="true" style="position:absolute;left:0;top:0;width:10px;height:10px;background:#fff"></div></div>',
    );
    expect(doc.width).toBe(600);
    expect(doc.layers[0]?.hidden).toBe(true);
    expect(doc.layers[0]?.locked).toBe(true);
  });

  it('rejects documents without an artboard when strict mode is enabled', () => {
    expect(() =>
      importDesignDocument('<!doctype html><html><body><p>hi</p></body></html>', { strict: true }),
    ).toThrow(DesignError);
  });

  it('rejects artboard sizes that are not in px when strict mode is enabled', () => {
    expect(() =>
      importDesignDocument(
        '<!doctype html><html><body><div class="artboard" style="width:100%;height:800px"></div></body></html>',
        { strict: true },
      ),
    ).toThrow(DesignError);
  });

  it('rejects an oversized import', () => {
    expect(() => importDesignDocument('x'.repeat(41 * 1024 * 1024))).toThrow(LimitExceededError);
  });
});

describe('expanded HTML structures, layouts, and shapes', () => {
  it('imports non-.artboard containers (.poster, main, body) and resolves %, rem, vw, vh, and calc()', () => {
    const html = `
      <!doctype html>
      <html dir="rtl">
      <head>
        <style>
          :root { --brand: #ff0055; --bg: #0f172a; }
          .poster { width: 100%; height: 1200px; background: var(--bg); padding: 40px; }
          .headline { font-size: 3rem; color: var(--brand); width: calc(100% - 80px); }
        </style>
      </head>
      <body>
        <div class="poster">
          <h1 id="main-title" class="headline">مهرجان التصميم العربي</h1>
          <p id="sub" style="font-size: 1.5rem; color: gold;">انضم إلينا الآن</p>
        </div>
      </body>
      </html>
    `;
    const { doc } = importDesignDocument(html);
    expect(doc.width).toBe(1080);
    expect(doc.height).toBe(1200);
    expect(doc.background).toEqual({ kind: 'solid', color: '#0f172a' });

    const h1 = doc.layers.find((l) => l.id === 'main-title') as TextLayer;
    expect(h1).toBeDefined();
    expect(h1.type).toBe('text');
    expect(h1.style.fontSize).toBe(48);
    expect(h1.style.color).toBe('#ff0055');

    const p = doc.layers.find((l) => l.id === 'sub') as TextLayer;
    expect(p).toBeDefined();
    expect(p.style.fontSize).toBe(24);
    expect(p.style.color).toBe('#ffd700');
  });

  it('splits compound elements (cards, buttons, badges) into shape + text/child layers', () => {
    const html = `
      <div class="poster" style="width:800px;height:1000px;background:#111827;padding:50px">
        <div id="promo-card" style="width:700px;height:300px;background:linear-gradient(to right, #ec4899, #8b5cf6);border-radius:24px;padding:30px">
          <h2 id="card-title" style="color:white;font-size:36px">خصم 50% لفترة محدودة</h2>
          <button id="cta-btn" style="width:220px;height:60px;background:#ffffff;color:#111827;border-radius:999px;font-weight:bold">اشترِ الآن</button>
        </div>
      </div>
    `;
    const { doc } = importDesignDocument(html);
    // Should contain: card shape, card title text, button shape, button text
    expect(doc.layers.length).toBeGreaterThanOrEqual(4);
    const cardShape = doc.layers[0] as ShapeLayer;
    expect(cardShape.type).toBe('shape');
    expect(cardShape.style.fill.kind).toBe('linear');
    expect(cardShape.style.radius).toBe(24);

    const btnLayers = doc.layers.filter((l) => l.id.startsWith('cta-btn'));
    expect(btnLayers.some((l) => l.type === 'shape')).toBe(true);
    expect(btnLayers.some((l) => l.type === 'text')).toBe(true);
  });

  it('converts CSS clip-path polygons, CSS border triangles, and data-shape elements into SVG layers', () => {
    const html = `
      <div class="artboard" data-width="800px" data-height="800px" style="background:#000">
        <div id="poly" style="position:absolute;left:50px;top:50px;width:200px;height:200px;background:#38bdf8;clip-path:polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"></div>
        <div id="star" data-shape="star" style="position:absolute;left:300px;top:50px;width:150px;height:150px;background:gold"></div>
        <div id="tri" style="position:absolute;left:500px;top:50px;width:0;height:0;border-left:50px solid transparent;border-right:50px solid transparent;border-bottom:100px solid crimson"></div>
        <hr id="divider" style="position:absolute;left:50px;top:400px;width:700px;color:#94a3b8" />
      </div>
    `;
    const { doc } = importDesignDocument(html);
    const poly = doc.layers.find((l) => l.id === 'poly') as SvgLayer;
    const star = doc.layers.find((l) => l.id === 'star') as SvgLayer;
    const tri = doc.layers.find((l) => l.id === 'tri') as SvgLayer;
    const divider = doc.layers.find((l) => l.id === 'divider') as ShapeLayer;

    expect(poly?.type).toBe('svg');
    expect(star?.type).toBe('svg');
    expect(tri?.type).toBe('svg');
    expect(divider?.type).toBe('shape');
  });

  it('lays out Flexbox, CSS Grid, lists (ul/ol), and tables into positioned layers', () => {
    const html = `
      <div class="poster" style="width:900px;height:900px;background:#0f172a;padding:40px">
        <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:20px;width:820px;height:200px">
          <div id="g1" style="background:#1e293b;border-radius:16px"></div>
          <div id="g2" style="background:#334155;border-radius:16px"></div>
          <div id="g3" style="background:#475569;border-radius:16px"></div>
        </div>
        <ul style="width:820px;color:#fff;font-size:22px">
          <li id="item1">الميزة الأولى</li>
          <li id="item2">الميزة الثانية</li>
        </ul>
      </div>
    `;
    const { doc } = importDesignDocument(html);
    const g1 = doc.layers.find((l) => l.id === 'g1') as ShapeLayer;
    const g2 = doc.layers.find((l) => l.id === 'g2') as ShapeLayer;
    const g3 = doc.layers.find((l) => l.id === 'g3') as ShapeLayer;
    expect(g1.left).toBeLessThan(g2.left);
    expect(g2.left).toBeLessThan(g3.left);

    const item1 = doc.layers.find((l) => l.id === 'item1') as TextLayer;
    expect(item1.content[0]).toEqual({ kind: 'text', text: '• الميزة الأولى' });
  });
});