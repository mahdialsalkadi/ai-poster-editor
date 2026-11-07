import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DesignError,
  LimitExceededError,
  SecurityViolationError,
  canonicalizeDoc,
  mergeDesignDoc,
  normalizeColor,
  normalizeAngle,
  parseDesignHtml,
  parsePx,
  quantize,
  serializeDesignDoc,
  validateDesignDoc,
  type DesignDoc,
  type Layer,
  type ShapeLayer,
  type TextLayer,
} from '../src/index';

const designHtml = readFileSync(new URL('./fixtures/design.html', import.meta.url), 'utf8');
const svgHtml = readFileSync(new URL('./fixtures/svg.html', import.meta.url), 'utf8');

function fixtureDoc(): DesignDoc {
  return parseDesignHtml(designHtml).doc;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Design HTML round trip', () => {
  it('parses the canonical fixture into typed layers', () => {
    const { doc, warnings } = parseDesignHtml(designHtml);
    expect(doc.width).toBe(1080);
    expect(doc.height).toBe(1350);
    expect(doc.layers).toHaveLength(3);
    expect(warnings).toEqual([]);

    const [title, card, hero] = doc.layers as [TextLayer, ShapeLayer, Layer];
    expect(title.type).toBe('text');
    expect(title.dir).toBe('rtl');
    expect(title.style.fontFamily).toBe('Cairo');
    expect(title.content[0]).toEqual({ kind: 'text', text: 'مرحبا ' });
    expect(title.content[1]).toMatchObject({ kind: 'span', color: '#38bdf8' });

    expect(card.type).toBe('shape');
    expect(card.style.fill.kind).toBe('linear');
    expect(card.style.radius).toBe(32);
    expect(card.style.shadow?.blur).toBe(40);

    expect(hero?.type).toBe('image');
    if (hero?.type === 'image') {
      expect(hero.src).toBe('asset:hero_1');
      expect(hero.style.fit).toBe('cover');
    }
  });

  it('is byte-stable: serialize -> parse -> serialize', () => {
    const first = serializeDesignDoc(fixtureDoc());
    const second = serializeDesignDoc(parseDesignHtml(first).doc);
    expect(second).toBe(first);
    expect(parseDesignHtml(second).doc).toEqual(parseDesignHtml(first).doc);
  });

  it('produces the same canonical document regardless of input color/angle spelling', () => {
    const doc = fixtureDoc();
    const card = doc.layers[1] as ShapeLayer;
    card.style.fill = {
      kind: 'linear',
      angle: -225,
      stops: [
        { color: 'rgb(51, 65, 85)', pos: 100 },
        { color: '#1E293B', pos: 0 },
      ],
    };
    card.left = 80.004;
    card.rotation = 360;
    const canonical = canonicalizeDoc(doc);
    const canonicalCard = canonical.layers[1] as ShapeLayer;
    expect(canonicalCard.style.fill).toEqual({
      kind: 'linear',
      angle: 135,
      stops: [
        { color: '#1e293b', pos: 0 },
        { color: '#334155', pos: 100 },
      ],
    });
    expect(canonicalCard.left).toBe(80);
    expect(canonicalCard.rotation).toBe(0);
  });

  it('validates a document through the runtime schema', () => {
    const doc = fixtureDoc();
    expect(validateDesignDoc(doc)).toEqual(canonicalizeDoc(doc));
    expect(() => validateDesignDoc({ ...doc, layers: [{ id: 'broken' }] })).toThrow(DesignError);
  });
});

describe('security boundaries', () => {
  const artboard = (inner: string): string =>
    `<div class="artboard" data-width="400px" data-height="400px" style="background:#fff">${inner}</div>`;

  it('rejects scripts', () => {
    expect(() => parseDesignHtml(artboard('<script>alert(1)</script>'))).toThrow(
      SecurityViolationError,
    );
  });

  it('rejects event handlers', () => {
    expect(() =>
      parseDesignHtml(
        artboard(
          '<div data-id="a" data-layer="A" data-type="shape" onclick="x()" style="position:absolute;left:0;top:0;width:10px;height:10px"></div>',
        ),
      ),
    ).toThrow(SecurityViolationError);
  });

  it('rejects external image sources', () => {
    expect(() =>
      parseDesignHtml(
        artboard(
          '<img data-id="a" data-layer="A" data-type="image" src="https://evil.test/a.png" style="position:absolute;left:0;top:0;width:10px;height:10px">',
        ),
      ),
    ).toThrow(SecurityViolationError);
  });

  it('rejects CSS url() values', () => {
    expect(() =>
      parseDesignHtml(
        artboard(
          '<div data-id="a" data-layer="A" data-type="shape" style="position:absolute;left:0;top:0;width:10px;height:10px;background:url(https://evil.test/a.png)"></div>',
        ),
      ),
    ).toThrow(SecurityViolationError);
  });

  it('rejects forbidden tags nested anywhere', () => {
    expect(() => parseDesignHtml(artboard('<iframe src="x"></iframe>'))).toThrow(
      SecurityViolationError,
    );
  });
});

describe('limits', () => {
  it('rejects documents above the byte limit', () => {
    const padding = 'x'.repeat(200 * 1024);
    expect(() => parseDesignHtml(`<!--${padding}-->`)).toThrow(LimitExceededError);
  });

  it('rejects more than 200 layers', () => {
    const layer = (index: number): string =>
      `<div data-id="l${index}" data-layer="L${index}" data-type="shape" style="position:absolute;left:0;top:0;width:1px;height:1px"></div>`;
    const html = `<div class="artboard" data-width="400px" data-height="400px">${Array.from(
      { length: 201 },
      (_, index) => layer(index),
    ).join('')}</div>`;
    expect(() => parseDesignHtml(html)).toThrow(LimitExceededError);
  });

  it('rejects artboards outside the allowed range', () => {
    expect(() =>
      parseDesignHtml('<div class="artboard" data-width="10px" data-height="10px"></div>'),
    ).toThrow(LimitExceededError);
  });

  it('clamps text font size and reports a warning', () => {
    const { doc, warnings } = parseDesignHtml(
      '<div class="artboard" data-width="400px" data-height="400px"><div data-id="a" data-layer="A" data-type="text" style="position:absolute;left:0;top:0;width:100px;font-size:5000px">Hi</div></div>',
    );
    const layer = doc.layers[0] as TextLayer;
    expect(layer.style.fontSize).toBe(1000);
    expect(warnings.some((item) => item.code === 'NUMBER_CLAMPED')).toBe(true);
  });
});

describe('text and fonts', () => {
  it('infers RTL and a fallback Arabic font', () => {
    const { doc, warnings } = parseDesignHtml(
      '<div class="artboard" data-width="400px" data-height="400px"><div data-id="a" data-layer="A" data-type="text" style="position:absolute;left:0;top:0;width:300px;font-family:Poppins;font-size:32px">مرحبا</div></div>',
    );
    const layer = doc.layers[0] as TextLayer;
    expect(layer.dir).toBe('rtl');
    expect(layer.style.fontFamily).toBe('Cairo');
    expect(warnings.map((item) => item.code)).toContain('RTL_DIRECTION_INFERRED');
    expect(warnings.map((item) => item.code)).toContain('FONT_SCRIPT_MISMATCH');
  });

  it('preserves explicit LTR while still choosing an Arabic-capable font', () => {
    const { doc } = parseDesignHtml(
      '<div class="artboard" data-width="400px" data-height="400px"><div dir="ltr" data-id="a" data-layer="A" data-type="text" style="position:absolute;left:0;top:0;width:300px;font-family:Poppins">مرحبا</div></div>',
    );
    const layer = doc.layers[0] as TextLayer;
    expect(layer.dir).toBe('ltr');
    expect(layer.style.fontFamily).toBe('Cairo');
  });
});

describe('SVG allow-list', () => {
  it('parses gradients, paths, and local references', () => {
    const { doc, warnings } = parseDesignHtml(svgHtml);
    const layer = doc.layers[0];
    expect(layer?.type).toBe('svg');
    expect(warnings).toEqual([]);
    if (layer?.type !== 'svg') return;
    const tags = layer.nodes.map((node) => (node.kind === 'element' ? node.tag : 'text'));
    expect(tags).toEqual(['defs', 'title', 'g']);
    const group = layer.nodes[2];
    expect(group?.kind).toBe('element');
    if (group?.kind === 'element') {
      expect(group.attrs.fill).toBe('url(#sky)');
      const path = group.children[1];
      expect(path?.kind).toBe('element');
      if (path?.kind === 'element') {
        expect(path.attrs.fill).toBe('none');
      }
    }
  });

  it('rejects scripts inside SVG', () => {
    expect(() =>
      parseDesignHtml(
        '<div class="artboard" data-width="400px" data-height="400px"><svg data-id="s" data-layer="S" data-type="svg" style="position:absolute;left:0;top:0;width:100px;height:100px"><script>alert(1)</script></svg></div>',
      ),
    ).toThrow(SecurityViolationError);
  });

  it('rejects external paint servers', () => {
    expect(() =>
      parseDesignHtml(
        '<div class="artboard" data-width="400px" data-height="400px"><svg data-id="s" data-layer="S" data-type="svg" style="position:absolute;left:0;top:0;width:100px;height:100px"><path d="M0 0" fill="url(https://evil.test/x.svg#a)"></path></svg></div>',
      ),
    ).toThrow(SecurityViolationError);
  });

  it('drops unknown SVG tags with a warning', () => {
    const { doc, warnings } = parseDesignHtml(
      '<div class="artboard" data-width="400px" data-height="400px"><svg data-id="s" data-layer="S" data-type="svg" style="position:absolute;left:0;top:0;width:100px;height:100px"><foo></foo><circle cx="1" cy="1" r="1"></circle></svg></div>',
    );
    const layer = doc.layers[0];
    if (layer?.type !== 'svg') throw new Error('expected svg');
    expect(layer.nodes).toHaveLength(1);
    expect(warnings.some((item) => item.code === 'SVG_LIMIT')).toBe(true);
  });
});

describe('merge', () => {
  it('updates only selected layers and ignores artboard/type changes', () => {
    const base = fixtureDoc();
    const patch = clone(base);
    const title = patch.layers[0] as TextLayer;
    title.content = [{ kind: 'text', text: 'Updated' }];
    title.style.color = '#ff0000';
    const titlePatch = clone(base.layers[0] as TextLayer);
    titlePatch.id = 'card';
    titlePatch.content = [{ kind: 'text', text: 'Wrong type' }];
    patch.layers[1] = titlePatch;
    patch.background = { kind: 'solid', color: '#ffffff' };
    patch.layers.push({
      ...(base.layers[1] as ShapeLayer),
      id: 'new-layer',
      name: 'New',
    });

    const { doc, warnings } = mergeDesignDoc(base, patch, {
      selectedLayerIds: ['title', 'card'],
      allowNewLayers: false,
    });

    expect((doc.layers[0] as TextLayer).content).toEqual([{ kind: 'text', text: 'Updated' }]);
    expect(doc.background).toEqual(base.background);
    expect(doc.layers.map((layer) => layer.id)).toEqual(['title', 'card', 'hero']);
    const codes = warnings.map((item) => item.code);
    expect(codes).toContain('MERGE_ARTBOARD_CHANGE_IGNORED');
    expect(codes).toContain('MERGE_IGNORED_UNSELECTED');
    expect(codes).toContain('MERGE_TYPE_CHANGE_IGNORED');
  });

  it('appends new layers only when allowed', () => {
    const base = fixtureDoc();
    const patch = clone(base);
    patch.layers.push({ ...(base.layers[1] as ShapeLayer), id: 'new-layer', name: 'New' });

    const blocked = mergeDesignDoc(base, patch);
    expect(blocked.doc.layers).toHaveLength(3);

    const allowed = mergeDesignDoc(base, patch, { allowNewLayers: true });
    expect(allowed.doc.layers).toHaveLength(4);
    expect(allowed.doc.layers[3]?.id).toBe('new-layer');
    expect(allowed.warnings.some((item) => item.code === 'MERGE_NEW_LAYER')).toBe(true);
  });

  it('can apply artboard changes explicitly', () => {
    const base = fixtureDoc();
    const patch = clone(base);
    patch.width = 1080;
    patch.height = 1920;
    const { doc } = mergeDesignDoc(base, patch, { allowArtboardChanges: true });
    expect(doc.height).toBe(1920);
  });
});

describe('numeric helpers', () => {
  it('normalizes colors', () => {
    expect(normalizeColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(normalizeColor('rgba(255,0,0,0.5)')).toBe('#ff000080');
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeColor('not-a-color')).toBeNull();
  });

  it('quantizes and normalizes angles', () => {
    expect(quantize(1.005)).toBe(1.01);
    expect(quantize(-0.001)).toBe(0);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(360)).toBe(0);
    expect(parsePx('0')).toBe(0);
    expect(parsePx('12.345px')).toBe(12.35);
  });
});
