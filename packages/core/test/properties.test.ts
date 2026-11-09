import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeDoc,
  DesignError,
  parseDesignHtml,
  serializeDesignDoc,
  type DesignDoc,
  type Fill,
  type Layer,
  type SvgNode,
} from '../src/index';

const colorArb = fc.constantFrom(
  '#000000',
  '#ffffff',
  '#0f172a',
  '#f97316',
  '#38bdf8',
  '#38bdf8aa',
  'rgb(10, 20, 30)',
  'rgba(10, 20, 30, 0.5)',
);

const pxArb = fc.integer({ min: 0, max: 400_000 }).map((value) => value / 100);
const sizeArb = fc.integer({ min: 100, max: 2_000_000 }).map((value) => value / 100);
const angleArb = fc.integer({ min: -72000, max: 72000 }).map((value) => value / 100);
const rotationArb = fc.integer({ min: -36000, max: 36000 }).map((value) => value / 100);
const opacityArb = fc.integer({ min: 0, max: 100 }).map((value) => value / 100);

const solidFillArb = fc.record({
  kind: fc.constant<'solid'>('solid'),
  color: colorArb,
});

const linearFillArb = fc.record({
  kind: fc.constant<'linear'>('linear'),
  angle: angleArb,
  stops: fc.array(fc.record({ color: colorArb, pos: fc.integer({ min: 0, max: 100 }) }), {
    minLength: 2,
    maxLength: 6,
  }),
});

const fillArb: fc.Arbitrary<Fill> = fc.oneof(solidFillArb, linearFillArb);

const borderArb = fc.record({
  width: fc.integer({ min: 1, max: 4000 }).map((value) => value / 100),
  style: fc.constantFrom<'solid' | 'dashed' | 'dotted'>('solid', 'dashed', 'dotted'),
  color: colorArb,
});

const boxShadowArb = fc.record({
  x: pxArb,
  y: pxArb,
  blur: fc.integer({ min: 0, max: 20000 }).map((value) => value / 100),
  spread: pxArb,
  color: colorArb,
});

const textShadowArb = fc.record({
  x: pxArb,
  y: pxArb,
  blur: fc.integer({ min: 0, max: 20000 }).map((value) => value / 100),
  color: colorArb,
});

const textArb = fc.record({
  kind: fc.constant<'text'>('text'),
  text: fc.constantFrom('مرحبا بالعالم', 'Summer Sale', 'مرحبا <b>', 'a & b', '  spaced  ', 'سطر'),
});

const layerBaseArb = {
  left: pxArb,
  top: pxArb,
  width: sizeArb,
  rotation: rotationArb,
  opacity: opacityArb,
  hidden: fc.boolean(),
  locked: fc.boolean(),
};

const textLayerArb = fc.record({
  ...layerBaseArb,
  type: fc.constant<'text'>('text'),
  dir: fc.constantFrom<'ltr' | 'rtl'>('ltr', 'rtl'),
  content: fc.array(textArb, { minLength: 1, maxLength: 3 }),
  style: fc.record({
    fontFamily: fc.constantFrom(
      'Poppins',
      'Cairo',
      'Amiri',
      'Inter',
      'Playfair Display',
      'IBM Plex Sans Arabic',
    ) as fc.Arbitrary<'Poppins' | 'Cairo'>,
    fontSize: fc.integer({ min: 100, max: 60000 }).map((value) => value / 100),
    fontWeight: fc.integer({ min: 1, max: 9 }).map((value) => value * 100),
    italic: fc.boolean(),
    underline: fc.boolean(),
    color: colorArb,
    align: fc.constantFrom<'left' | 'center' | 'right' | 'justify'>(
      'left',
      'center',
      'right',
      'justify',
    ),
    lineHeight: fc.integer({ min: 50, max: 400 }).map((value) => value / 100),
    letterSpacing: fc.integer({ min: -2000, max: 2000 }).map((value) => value / 100),
    textTransform: fc.constantFrom<'none' | 'uppercase' | 'lowercase' | 'capitalize'>(
      'none',
      'uppercase',
      'lowercase',
      'capitalize',
    ),
    shadow: fc.option(textShadowArb, { nil: undefined }),
  }),
});

const shapeLayerArb = fc.record({
  ...layerBaseArb,
  type: fc.constant<'shape'>('shape'),
  height: sizeArb,
  style: fc.record({
    fill: fillArb,
    border: fc.option(borderArb, { nil: undefined }),
    radius: fc.integer({ min: 0, max: 100000 }).map((value) => value / 100),
    shadow: fc.option(boxShadowArb, { nil: undefined }),
  }),
});

const imageLayerArb = fc.record({
  ...layerBaseArb,
  type: fc.constant<'image'>('image'),
  height: sizeArb,
  src: fc.constantFrom('asset:hero_1', 'asset:a-b_c', 'asset:123'),
  prompt: fc.option(fc.constantFrom('beach at sunset', 'a "quoted" prompt', 'x & y'), {
    nil: undefined,
  }),
  alt: fc.option(fc.constantFrom('Alt text', 'نص بديل'), { nil: undefined }),
  style: fc.record({
    fit: fc.constantFrom<'cover' | 'contain' | 'fill'>('cover', 'contain', 'fill'),
    position: fc.record({
      x: fc.integer({ min: 0, max: 100 }),
      y: fc.integer({ min: 0, max: 100 }),
    }),
    radius: fc.integer({ min: 0, max: 100000 }).map((value) => value / 100),
    border: fc.option(borderArb, { nil: undefined }),
    shadow: fc.option(boxShadowArb, { nil: undefined }),
  }),
});

const svgNodeArb: fc.Arbitrary<SvgNode> = fc.oneof(
  fc.record({
    kind: fc.constant<'element'>('element'),
    tag: fc.constantFrom<'path' | 'rect' | 'circle' | 'g' | 'polygon'>(
      'path',
      'rect',
      'circle',
      'g',
      'polygon',
    ),
    attrs: fc.constantFrom<Record<string, string>>(
      { d: 'M0 0 L10 10', fill: '#ff0000' },
      { x: '1', y: '2', width: '10', height: '20', stroke: 'none' },
      { cx: '5', cy: '5', r: '5', fill: 'none', stroke: '#000000' },
      { points: '0,0 10,10', opacity: '0.5' },
    ),
    children: fc.constant<SvgNode[]>([]),
  }),
);

const svgLayerArb = fc.record({
  ...layerBaseArb,
  type: fc.constant<'svg'>('svg'),
  height: sizeArb,
  viewBox: fc.option(fc.constantFrom('0 0 10 10', '0 0 100 50'), { nil: undefined }),
  nodes: fc.array(svgNodeArb, { minLength: 1, maxLength: 3 }),
});

const layerArb: fc.Arbitrary<Omit<Layer, 'id' | 'name'>> = fc.oneof(
  textLayerArb,
  shapeLayerArb,
  imageLayerArb,
  svgLayerArb,
) as fc.Arbitrary<Omit<Layer, 'id' | 'name'>>;

const docArb: fc.Arbitrary<DesignDoc> = fc
  .record({
    width: fc.integer({ min: 100, max: 3000 }),
    height: fc.integer({ min: 100, max: 3000 }),
    background: fillArb,
    layers: fc.array(layerArb, { maxLength: 6 }),
  })
  .map((input) => ({
    schemaVersion: 1 as const,
    width: input.width,
    height: input.height,
    background: input.background,
    layers: input.layers
      .map((layer, index) => ({
        ...layer,
        id: `layer${index}`,
        name: `Layer ${index}`,
      }))
      .map((layer) =>
        layer.type === 'text' &&
        layer.content.some((node) => node.kind !== 'br' && /[\u0600-\u06ff]/u.test(node.text))
          ? { ...layer, style: { ...layer.style, letterSpacing: 0 } }
          : layer,
      ) as Layer[],
  }));

const options = { numRuns: 150, verbose: false as const };

describe('hostile HTML robustness', () => {
  const tokens = fc.constantFrom(
    '<div class="artboard" data-width="400" data-height="400">',
    '</div>',
    '<span>',
    '</span>',
    '<br>',
    '<svg>',
    '</svg>',
    '<script>',
    '<style>',
    '<!--',
    '-->',
    '"',
    "'",
    '<',
    '>',
    '&amp;',
    '&#0;',
    'مرحبا',
    'url(',
    '\\75rl(',
    'linear-gradient(90deg, wrong, white)',
    '<img src="https://example.invalid">',
    '<div data-type="text" data-id="a" style="position:absolute;width:100px">',
  );
  const arbitraryHtml = fc.oneof(
    fc.fullUnicodeString({ maxLength: 8192 }),
    fc.array(tokens, { maxLength: 160 }).map((parts) => parts.join('')),
  );

  it('never throws implementation errors or exceeds the per-input time budget on arbitrary HTML', () => {
    fc.assert(
      fc.property(arbitraryHtml, (html) => {
        const started = performance.now();
        try {
          parseDesignHtml(html);
        } catch (cause) {
          expect(cause).toBeInstanceOf(DesignError);
        }
        expect(performance.now() - started).toBeLessThan(250);
      }),
      { numRuns: 500, seed: 20261110, verbose: false },
    );
  });

  it('rejects deep nesting with a controlled limit rather than a RangeError', () => {
    const html =
      '<div class="artboard" data-width="400" data-height="400"><div data-id="t" data-type="text" style="position:absolute;width:100px">' +
      '<span>'.repeat(10_000) +
      'x' +
      '</span>'.repeat(10_000) +
      '</div></div>';
    const started = performance.now();
    expect(() => parseDesignHtml(html)).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('canonical round trip properties', () => {
  it('parse(serialize(doc)) deep-equals the canonical document', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const canonical = canonicalizeDoc(doc);
        const html = serializeDesignDoc(canonical);
        const reparsed = parseDesignHtml(html);
        expect(reparsed.doc).toEqual(canonical);
      }),
      options,
    );
  });

  it('serialization is byte-stable after a round trip', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const first = serializeDesignDoc(doc);
        const second = serializeDesignDoc(parseDesignHtml(first).doc);
        expect(second).toBe(first);
        expect(parseDesignHtml(second).doc).toEqual(parseDesignHtml(first).doc);
      }),
      options,
    );
  });

  it('never emits -0 in a serialized document', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const html = serializeDesignDoc(doc);
        expect(html).not.toContain('-0px');
        expect(html).not.toContain('-0deg');
      }),
      options,
    );
  });

  it('parses a serialized document without warnings', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const result = parseDesignHtml(serializeDesignDoc(canonicalizeDoc(doc)));
        expect(result.warnings).toEqual([]);
      }),
      options,
    );
  });
});
