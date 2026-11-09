import { describe, expect, it } from 'vitest';
import {
  DesignError,
  SecurityViolationError,
  assertSafePaintValue,
  decodeCssEscapes,
  ensureNoUnknownCriticalProperties,
  parseBorder,
  parseCommonGeometry,
  parseDeclarations,
  parseFill,
  parseFlexibleLength,
  parseImageStyle,
  parseShadow,
  parseShapeStyle,
  parseTextStyle,
  splitTopLevel,
  type StyleContext,
} from '../src/index.js';

const context = (dir: 'ltr' | 'rtl' = 'ltr'): StyleContext => ({
  warnings: [],
  path: 'test',
  layerId: 'layer',
  dir,
});
const declarations = (values: Record<string, string>) => new Map(Object.entries(values));

describe('CSS lengths and declaration boundaries', () => {
  it.each([
    ['2rem', 32],
    ['1.5em', 30],
    ['12pt', 16],
    ['4px', 4],
    ['20%', null],
    ['invalid', null],
  ] as const)('converts %s to %s', (input, expected) => {
    expect(parseFlexibleLength(input, 20)).toBe(expected);
  });
  it('splits only at top level, preserving quoted delimiters and escaped quotes', () => {
    expect(splitTopLevel("red, rgb(1, 2, 3), \"x,y\", 'x\\'y,z'")).toEqual([
      'red',
      'rgb(1, 2, 3)',
      '"x,y"',
      "'x\\'y,z'",
    ]);
    expect(splitTopLevel('left:1px;top:2px', ';')).toEqual(['left:1px', 'top:2px']);
  });
  it('rejects executable CSS when called directly, not just through HTML security walking', () => {
    expect(() => parseDeclarations('background:url(https://example.invalid)', context())).toThrow(
      SecurityViolationError,
    );
  });
  it('warns for unknown properties while allowing passive custom properties', () => {
    const ctx = context();
    ensureNoUnknownCriticalProperties(
      parseDeclarations('--custom:red;invented:value;position:absolute', ctx),
      ctx,
    );
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]?.code).toBe('UNSUPPORTED_PROPERTY');
  });
  it('decodes literal CSS escapes and rejects non-url executable paint schemes', () => {
    expect(decodeCssEscapes('a\\zb')).toBe('azb');
    for (const value of [
      'javascript:alert(1)',
      'data:image/png,x',
      'file:/tmp/file',
      'blob:private',
    ])
      expect(() => assertSafePaintValue(value, 'svg.fill')).toThrow(SecurityViolationError);
    expect(() => assertSafePaintValue('url(#local)', 'svg.fill')).not.toThrow();
  });
});

describe('geometry recovery', () => {
  it.each([{ width: '0px', height: '10px' }, { width: '10px' }])(
    'requires positive explicit dimensions: %j',
    (values) => {
      expect(() => parseCommonGeometry(declarations(values), context(), true)).toThrow(DesignError);
    },
  );
  it('drops percentage/invalid positions and unsupported transforms with warnings', () => {
    const ctx = context();
    const geometry = parseCommonGeometry(
      declarations({
        width: '100px',
        left: '20%',
        top: 'bad',
        transform: 'scale(2)',
        opacity: 'bad',
      }),
      ctx,
      false,
    );
    expect(geometry.left).toBe(0);
    expect(geometry.top).toBe(0);
    expect(geometry.rotation).toBeUndefined();
    expect(geometry.opacity).toBeUndefined();
    expect(ctx.warnings.map((item) => item.code)).toEqual([
      'PERCENTAGE_DROPPED',
      'UNSUPPORTED_VALUE',
      'UNSUPPORTED_VALUE',
      'UNSUPPORTED_VALUE',
    ]);
  });
  it.each([
    ['rotate(1.57079632679rad)', 90],
    ['rotate(0.5turn)', 180],
    ['rotate(100grad)', 90],
    ['none', 0],
  ])('normalizes %s', (transform, angle) => {
    expect(
      parseCommonGeometry(declarations({ width: '10px', transform }), context(), false).rotation,
    ).toBe(angle);
  });
  it.each([
    ['-1', 0],
    ['2', 1],
  ])('clamps opacity %s', (opacity, expected) => {
    const ctx = context();
    expect(parseCommonGeometry(declarations({ width: '10px', opacity }), ctx, false).opacity).toBe(
      expected,
    );
    expect(ctx.warnings[0]?.code).toBe('NUMBER_CLAMPED');
  });
});

describe('fill compatibility and warnings', () => {
  it.each(['', 'none'])('treats %j as no fill', (value) =>
    expect(parseFill(value, context())).toEqual({ kind: 'solid', color: '#00000000' }),
  );
  it('supports double stops, clamps percentages and interpolates omitted positions', () => {
    const ctx = context();
    const fill = parseFill('linear-gradient(to right, red -10%, green, blue 110%)', ctx);
    expect(fill).toEqual({
      kind: 'linear',
      angle: 90,
      stops: [
        { color: '#ff0000', pos: 0 },
        { color: '#008000', pos: 50 },
        { color: '#0000ff', pos: 100 },
      ],
    });
    expect(ctx.warnings.filter((item) => item.code === 'NUMBER_CLAMPED')).toHaveLength(2);
    expect(parseFill('linear-gradient(90deg, red 10% 30%, blue 100%)', context())).toEqual({
      kind: 'linear',
      angle: 90,
      stops: [
        { color: '#ff0000', pos: 10 },
        { color: '#ff0000', pos: 30 },
        { color: '#0000ff', pos: 100 },
      ],
    });
  });
  it('caps excess stops and rejects incomplete/empty gradients', () => {
    const ctx = context();
    const fill = parseFill(
      'linear-gradient(90deg, red, blue, green, white, black, gold, navy)',
      ctx,
    );
    expect(fill.kind === 'linear' && fill.stops.length).toBe(6);
    expect(ctx.warnings.some((item) => item.code === 'GRADIENT_LIMIT')).toBe(true);
    for (const value of [
      'linear-gradient( )',
      'linear-gradient(90deg, red)',
      'linear-gradient(90deg, wrong 0% 20%, white 100%)',
    ])
      expect(parseFill(value, context())).toEqual({ kind: 'solid', color: '#00000000' });
  });
  it.each([
    ['radial-gradient(ellipse at center, red, blue)', 135],
    ['conic-gradient(from 90deg at center, red, blue)', 90],
    ['linear-gradient(0.5turn, red, blue)', 180],
    ['linear-gradient(1.57079632679rad, red, blue)', 90],
    ['linear-gradient(100grad, red, blue)', 90],
  ] as const)('converts %s to a linear fill', (value, angle) => {
    const fill = parseFill(value, context());
    expect(fill.kind).toBe('linear');
    expect(fill.kind === 'linear' && fill.angle).toBe(angle);
  });
  it('extracts safe colors and gradients from compatible background shorthand', () => {
    expect(parseFill('red center no-repeat', context())).toEqual({
      kind: 'solid',
      color: '#ff0000',
    });
    expect(parseFill('linear-gradient(90deg, red, blue) center', context()).kind).toBe('linear');
  });
});

describe('borders, radius and shadows', () => {
  it.each([
    ['thin', 1],
    ['medium', 3],
    ['thick', 5],
  ] as const)('supports %s borders', (size, width) =>
    expect(parseBorder(`${size} double red`, context())).toEqual({
      width,
      style: 'solid',
      color: '#ff0000',
    }),
  );
  it.each([
    '',
    'none',
    '0',
    '0px',
    '1px hidden red',
    '1px solid wrong',
    'red solid',
    '0px solid red',
  ])('drops an absent/invalid border: %j', (value) =>
    expect(parseBorder(value, context())).toBeUndefined(),
  );
  it('normalizes longhand and directional borders and percentage radii', () => {
    const a = parseShapeStyle(
      declarations({
        'border-width': '2px 4px',
        'border-color': 'red blue',
        'border-style': 'dotted',
        width: '200px',
        height: '100px',
        'border-radius': '50%',
      }),
      context(),
    );
    expect(a.border).toEqual({ width: 2, style: 'dotted', color: '#ff0000' });
    expect(a.radius).toBe(50);
    expect(
      parseShapeStyle(declarations({ 'border-top': '3px dashed blue' }), context()).border?.width,
    ).toBe(3);
    expect(parseShapeStyle(declarations({ 'border-radius': 'bad' }), context()).radius).toBe(0);
  });
  it.each([
    '',
    'none',
    ', 0px 1px #000000',
    'inset 0px 1px #000000',
    '#000000 1px',
    '0px 1px #000000 junk',
  ])('drops unsupported shadows: %j', (value) =>
    expect(parseShadow(value, context(), 'box-shadow')).toBeUndefined(),
  );
});

describe('image fitting and positions', () => {
  it.each([
    ['cover', 'cover'],
    ['contain', 'contain'],
    ['fill', 'fill'],
    ['none', 'contain'],
    ['scale-down', 'contain'],
    ['bad', 'cover'],
  ])('normalizes fit %s', (fit, expected) => {
    expect(parseImageStyle(declarations({ 'object-fit': fit! }), context()).fit).toBe(expected);
  });
  it.each([
    ['left', 0, 50],
    ['right', 100, 50],
    ['top', 50, 0],
    ['bottom', 50, 100],
    ['center', 50, 50],
    ['25%', 25, 50],
    ['left top', 0, 0],
    ['right bottom', 100, 100],
    ['-20% 120%', 0, 100],
    ['bad', 50, 50],
    ['bad bad', 50, 50],
  ] as const)('normalizes object-position %s', (position, x, y) => {
    expect(
      parseImageStyle(declarations({ 'object-position': position }), context()).position,
    ).toEqual({ x, y });
  });
});

describe('text normalization and fallback warnings', () => {
  it.each([
    ['small', 14],
    ['0px', 32],
    ['bad', 32],
    ['2000px', 1000],
  ] as const)('normalizes font-size %s', (size, expected) => {
    expect(parseTextStyle(declarations({ 'font-size': size }), context()).fontSize).toBe(expected);
  });
  it.each([
    ['normal', 1.2],
    ['150%', 1.5],
    ['30px', 1.5],
    ['bad', 1.2],
    ['0', 1.2],
  ] as const)('normalizes line-height %s', (height, expected) => {
    expect(
      parseTextStyle(declarations({ 'font-size': '20px', 'line-height': height }), context())
        .lineHeight,
    ).toBe(expected);
  });
  it.each([
    ['normal', 0],
    ['0', 0],
    ['bad', 0],
    ['1pt', 1.33],
  ] as const)('normalizes letter-spacing %s', (spacing, expected) => {
    expect(
      parseTextStyle(declarations({ 'letter-spacing': spacing }), context()).letterSpacing,
    ).toBe(expected);
  });
  it.each([
    ['ltr', 'start', 'left'],
    ['ltr', 'end', 'right'],
    ['rtl', 'start', 'right'],
    ['rtl', 'end', 'left'],
    ['ltr', 'bad', 'left'],
  ] as const)('resolves %s text-align %s', (dir, align, expected) => {
    expect(parseTextStyle(declarations({ 'text-align': align }), context(dir)).align).toBe(
      expected,
    );
  });
  it('reports unsupported text transforms without inventing a value', () => {
    const ctx = context();
    expect(parseTextStyle(declarations({ 'text-transform': 'wide' }), ctx).textTransform).toBe(
      'none',
    );
    expect(ctx.warnings[0]?.code).toBe('UNSUPPORTED_VALUE');
  });
});
