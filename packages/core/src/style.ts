import * as csstree from 'css-tree';
import { normalizeColor } from './color.js';
import { containsForbiddenCss } from './css-guard.js';
import { DesignError, LimitExceededError, SecurityViolationError } from './errors.js';
import {
  containsArabic,
  fallbackFont,
  findAllowedFont,
  isArabicFont,
  normalizeFontWeight,
  requiresZeroLetterSpacing,
} from './fonts.js';
import { LIMITS } from './limits.js';
import type {
  Border,
  BorderStyle,
  Fill,
  GradientStop,
  ImageStyle,
  ObjectFit,
  Shadow,
  TextAlign,
  TextStyle,
  TextTransform,
  Warning,
} from './model.js';
import { clampQuantized, normalizeAngle, parseNumber, parsePx, quantize } from './numbers.js';
import { pushWarning } from './warnings.js';

export type Declarations = ReadonlyMap<string, string>;

export type StyleContext = {
  warnings: Warning[];
  path: string;
  layerId?: string;
  dir: 'ltr' | 'rtl';
  textContent?: string;
};

export type CommonGeometry = {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
};

const DROPPED_PROPERTIES = new Set([
  'display',
  'float',
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-content',
  'align-self',
  'gap',
  'row-gap',
  'column-gap',
  'grid',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'z-index',
  'transition',
  'animation',
  'overflow',
  'overflow-x',
  'overflow-y',
  'overflow-wrap',
  'word-break',
  'word-wrap',
  'clip',
  'clip-path',
  'filter',
  'backdrop-filter',
  'white-space',
  'direction',
  'writing-mode',
  'box-sizing',
  'pointer-events',
  'user-select',
  'cursor',
  'list-style',
  'list-style-type',
  'vertical-align',
  'aspect-ratio',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'inset',
  'right',
  'bottom',
  'mix-blend-mode',
  'background-size',
  'background-position',
  'background-repeat',
]);

const KNOWN_PROPERTIES = new Set([
  'position',
  'left',
  'top',
  'width',
  'height',
  'transform',
  'opacity',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'outline',
  'border-radius',
  'box-shadow',
  'text-shadow',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'color',
  'text-align',
  'line-height',
  'letter-spacing',
  'text-transform',
  'object-fit',
  'object-position',
  ...DROPPED_PROPERTIES,
]);

const DIRECTION_ANGLES: Readonly<Record<string, number>> = {
  'to top': 0,
  'to top right': 45,
  'to right top': 45,
  'to right': 90,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom': 180,
  'to bottom left': 225,
  'to left bottom': 225,
  'to left': 270,
  'to top left': 315,
  'to left top': 315,
};

const KEYWORD_FONT_SIZES: Readonly<Record<string, number>> = {
  'xx-small': 10,
  'x-small': 12,
  xs: 12,
  small: 14,
  sm: 14,
  medium: 16,
  md: 16,
  large: 18,
  lg: 18,
  'x-large': 24,
  xl: 24,
  'xx-large': 32,
  '2xl': 32,
  'xxx-large': 48,
  '3xl': 48,
};

export function parseFlexibleLength(raw: string, baseFontSize = 16): number | null {
  const trimmed = raw.trim().toLowerCase();
  const px = parsePx(trimmed);
  if (px !== null) return px;

  const remMatch = /^(-?(?:\d+\.?\d*|\.\d+))rem$/i.exec(trimmed);
  if (remMatch) {
    return quantize(Number.parseFloat(remMatch[1]!) * 16);
  }

  const emMatch = /^(-?(?:\d+\.?\d*|\.\d+))em$/i.exec(trimmed);
  if (emMatch) {
    return quantize(Number.parseFloat(emMatch[1]!) * baseFontSize);
  }

  const ptMatch = /^(-?(?:\d+\.?\d*|\.\d+))pt$/i.exec(trimmed);
  if (ptMatch) {
    return quantize((Number.parseFloat(ptMatch[1]!) * 4) / 3);
  }

  return null;
}

export function splitTopLevel(input: string, separator = ','): string[] {
  const result: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let current = '';

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quote) {
      current += ch;
      if (ch === quote && input[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (depth === 0 && input.slice(i, i + separator.length) === separator) {
      result.push(current.trim());
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += ch;
  }

  if (current.trim().length > 0) {
    result.push(current.trim());
  }
  return result;
}

export function parseDeclarations(style: string, ctx: StyleContext): Declarations {
  if (new TextEncoder().encode(style).byteLength > LIMITS.style.maxBytes) {
    throw new LimitExceededError(
      `Style attribute exceeds ${LIMITS.style.maxBytes} bytes`,
      ctx.path,
    );
  }
  if (containsForbiddenCss(style)) {
    throw new SecurityViolationError('Forbidden CSS construct in style attribute', ctx.path);
  }

  const map = new Map<string, string>();
  if (!style.trim()) return map;

  try {
    const ast = csstree.parse(style, {
      context: 'declarationList',
      parseValue: false,
    });
    let count = 0;
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        count += 1;
        if (count > LIMITS.style.maxDeclarationsPerLayer) {
          throw new LimitExceededError(
            `Style attribute exceeds ${LIMITS.style.maxDeclarationsPerLayer} declarations`,
            ctx.path,
          );
        }
        const prop = node.property.trim().toLowerCase();
        const val = csstree.generate(node.value).trim();
        if (containsForbiddenCss(val)) {
          throw new SecurityViolationError(`Forbidden CSS value in ${prop}`, ctx.path);
        }
        map.set(prop, val);
      }
    });
  } catch (err) {
    if (err instanceof SecurityViolationError || err instanceof LimitExceededError) throw err;
    for (const chunk of splitTopLevel(style, ';')) {
      const colonIdx = chunk.indexOf(':');
      if (colonIdx <= 0) continue;
      const prop = chunk.slice(0, colonIdx).trim().toLowerCase();
      const val = chunk.slice(colonIdx + 1).trim();
      if (containsForbiddenCss(val)) {
        throw new SecurityViolationError(`Forbidden CSS value in ${prop}`, ctx.path);
      }
      if (prop && val) {
        map.set(prop, val);
      }
    }
  }

  return map;
}

export const parseStyleDeclarations = parseDeclarations;

export function ensureNoUnknownCriticalProperties(
  declarations: Declarations,
  ctx: StyleContext,
): void {
  for (const prop of declarations.keys()) {
    if (prop.startsWith('--')) continue;
    if (!KNOWN_PROPERTIES.has(prop)) {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_PROPERTY',
        `Property is not supported: ${prop}`,
        ctx.path,
        ctx.layerId,
      );
    }
  }
}

export function assertAbsolutePosition(declarations: Declarations, ctx: StyleContext): void {
  const pos = declarations.get('position')?.trim().toLowerCase();
  if (pos !== 'absolute') {
    throw new DesignError('INVALID_DOC', 'Layers must declare position:absolute', ctx.path);
  }
}

function parseRotation(raw: string, ctx: StyleContext): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'none') return 0;

  const match = /rotate\(\s*([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|turn|grad)?\s*\)/i.exec(trimmed);
  if (!match) {
    pushWarning(
      ctx.warnings,
      'UNSUPPORTED_VALUE',
      `Unsupported transform: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return undefined;
  }

  const num = Number.parseFloat(match[1]!);
  if (!Number.isFinite(num)) return undefined;
  const unit = (match[2] ?? 'deg').toLowerCase();
  let deg = num;
  if (unit === 'rad') deg = (num * 180) / Math.PI;
  else if (unit === 'turn') deg = num * 360;
  else if (unit === 'grad') deg = num * 0.9;
  return normalizeAngle(deg);
}

function parseGeometryLength(
  declarations: Declarations,
  prop: 'left' | 'top' | 'width' | 'height',
  ctx: StyleContext,
): number | undefined {
  const raw = declarations.get(prop);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) {
    pushWarning(
      ctx.warnings,
      'PERCENTAGE_DROPPED',
      `Percentage value dropped for ${prop}: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return undefined;
  }
  const value = parseFlexibleLength(trimmed);
  if (value === null) {
    pushWarning(
      ctx.warnings,
      'UNSUPPORTED_VALUE',
      `Invalid length for ${prop}: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return undefined;
  }
  return value;
}

export function parseCommonGeometry(
  declarations: Declarations,
  ctx: StyleContext,
  requireHeight: boolean,
): CommonGeometry {
  const left = parseGeometryLength(declarations, 'left', ctx);
  const top = parseGeometryLength(declarations, 'top', ctx);
  const width = parseGeometryLength(declarations, 'width', ctx);
  const height = parseGeometryLength(declarations, 'height', ctx);

  if (width === undefined || width <= 0) {
    throw new DesignError('INVALID_DOC', 'Layer must declare a positive width in px', ctx.path);
  }
  if (requireHeight && (height === undefined || height <= 0)) {
    throw new DesignError('INVALID_DOC', 'Layer must declare a positive height in px', ctx.path);
  }

  let rotation: number | undefined;
  const transformRaw = declarations.get('transform');
  if (transformRaw !== undefined) {
    rotation = parseRotation(transformRaw, ctx);
  }

  let opacity: number | undefined;
  const opacityRaw = declarations.get('opacity');
  if (opacityRaw !== undefined) {
    const parsed = parseNumber(opacityRaw);
    if (parsed === null) {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_VALUE',
        `Invalid opacity: ${opacityRaw}`,
        ctx.path,
        ctx.layerId,
      );
    } else {
      if (parsed < 0 || parsed > 1) {
        pushWarning(
          ctx.warnings,
          'NUMBER_CLAMPED',
          `Clamped opacity ${parsed} to [0, 1]`,
          ctx.path,
          ctx.layerId,
        );
      }
      opacity = clampQuantized(parsed, 0, 1);
    }
  }

  return {
    left: left ?? 0,
    top: top ?? 0,
    width,
    ...(height !== undefined ? { height } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
  };
}

function parseGradientAngleOrDirection(token: string): number | null {
  const normalized = token.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized in DIRECTION_ANGLES) {
    return DIRECTION_ANGLES[normalized]!;
  }
  const angleMatch = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|turn|grad)$/i.exec(normalized);
  if (!angleMatch) return null;
  const val = Number.parseFloat(angleMatch[1]!);
  const unit = angleMatch[2]!.toLowerCase();
  if (unit === 'rad') return normalizeAngle((val * 180) / Math.PI);
  if (unit === 'turn') return normalizeAngle(val * 360);
  if (unit === 'grad') return normalizeAngle(val * 0.9);
  return normalizeAngle(val);
}

function parseGradientStopsList(
  stopTokens: string[],
  ctx: StyleContext,
  raw: string,
): GradientStop[] | null {
  type RawStop = { color: string; pos?: number };
  const rawStops: RawStop[] = [];

  for (const stopStr of stopTokens) {
    const trimmed = stopStr.trim();
    if (!trimmed) continue;

    // Match trailing one or two percentages (e.g. "#ff0000 0%" or "rgba(0,0,0,0.5) 20% 80%" or "#ff0000")
    const doubleStopMatch = /^(.+?)\s+(-?\d+\.?\d*)%\s+(-?\d+\.?\d*)%$/.exec(trimmed);
    if (doubleStopMatch) {
      const color = normalizeColor(doubleStopMatch[1]!.trim());
      if (!color) return null;
      const pos1 = clampQuantized(Number.parseFloat(doubleStopMatch[2]!), 0, 100);
      const pos2 = clampQuantized(Number.parseFloat(doubleStopMatch[3]!), 0, 100);
      rawStops.push({ color, pos: pos1 }, { color, pos: pos2 });
      continue;
    }

    const singleStopMatch = /^(.+?)\s+(-?\d+\.?\d*)%$/.exec(trimmed);
    if (singleStopMatch) {
      const color = normalizeColor(singleStopMatch[1]!.trim());
      if (!color) return null;
      const rawPos = Number.parseFloat(singleStopMatch[2]!);
      if (rawPos < 0 || rawPos > 100) {
        pushWarning(
          ctx.warnings,
          'NUMBER_CLAMPED',
          `Gradient stop clamped to [0, 100]: ${rawPos}%`,
          ctx.path,
          ctx.layerId,
        );
      }
      rawStops.push({ color, pos: clampQuantized(rawPos, 0, 100) });
      continue;
    }

    // Color without percentage (auto-interpolated below)
    const colorOnly = normalizeColor(trimmed);
    if (colorOnly) {
      rawStops.push({ color: colorOnly });
      continue;
    }

    return null;
  }

  if (rawStops.length < 2) {
    pushWarning(
      ctx.warnings,
      'UNSUPPORTED_VALUE',
      `Gradient requires at least 2 color stops: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return null;
  }

  // Fill in missing start/end positions
  if (rawStops[0]!.pos === undefined) rawStops[0]!.pos = 0;
  if (rawStops[rawStops.length - 1]!.pos === undefined) rawStops[rawStops.length - 1]!.pos = 100;

  // Linearly interpolate any intermediate stops without explicit positions
  let lastDefinedIdx = 0;
  for (let i = 1; i < rawStops.length; i += 1) {
    if (rawStops[i]!.pos !== undefined) {
      const gap = i - lastDefinedIdx;
      if (gap > 1) {
        const startPos = rawStops[lastDefinedIdx]!.pos!;
        const endPos = rawStops[i]!.pos!;
        for (let j = 1; j < gap; j += 1) {
          rawStops[lastDefinedIdx + j]!.pos = quantize(startPos + ((endPos - startPos) * j) / gap);
        }
      }
      lastDefinedIdx = i;
    }
  }

  const maxStops = LIMITS.gradient?.maxStops ?? 16;
  let finalStops = rawStops.map((s) => ({
    color: s.color,
    pos: quantize(s.pos ?? 0),
  }));

  if (finalStops.length > maxStops) {
    pushWarning(
      ctx.warnings,
      'GRADIENT_LIMIT',
      `Gradient stops truncated to ${maxStops}`,
      ctx.path,
      ctx.layerId,
    );
    finalStops = finalStops.slice(0, maxStops);
  }

  return finalStops;
}

export function parseFill(raw: string, ctx: StyleContext, property = 'background'): Fill {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return { kind: 'solid', color: '#00000000' };
  }

  // 1. Direct solid color
  const directColor = normalizeColor(trimmed);
  if (directColor) {
    return { kind: 'solid', color: directColor };
  }

  // 2. Linear or repeating-linear gradient
  const linearMatch = /^(?:repeating-)?linear-gradient\(([\s\S]+)\)$/i.exec(trimmed);
  if (linearMatch) {
    const inner = linearMatch[1]!.trim();
    const parts = splitTopLevel(inner, ',');
    if (parts.length === 0) {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_VALUE',
        `Empty linear-gradient in ${property}`,
        ctx.path,
        ctx.layerId,
      );
      return { kind: 'solid', color: '#00000000' };
    }

    let angle = 180;
    let stopStartIndex = 0;
    const maybeAngle = parseGradientAngleOrDirection(parts[0]!);
    if (maybeAngle !== null) {
      angle = maybeAngle;
      stopStartIndex = 1;
    }

    const stops = parseGradientStopsList(parts.slice(stopStartIndex), ctx, raw);
    if (!stops) {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_COLOR',
        `Invalid linear-gradient in ${property}: ${raw}`,
        ctx.path,
        ctx.layerId,
      );
      return { kind: 'solid', color: '#00000000' };
    }

    return {
      kind: 'linear',
      angle,
      stops,
    };
  }

  // 3. Radial or conic gradient -> convert stops gracefully to a linear gradient
  const radialOrConicMatch = /^(?:repeating-)?(?:radial|conic)-gradient\(([\s\S]+)\)$/i.exec(
    trimmed,
  );
  if (radialOrConicMatch) {
    const inner = radialOrConicMatch[1]!.trim();
    const parts = splitTopLevel(inner, ',');
    let stopStartIndex = 0;
    let angle = 135;

    if (parts.length > 0) {
      const first = parts[0]!.trim().toLowerCase();
      // Skip radial/conic shape or position header like "circle at center", "from 90deg at 50% 50%", etc.
      if (
        first.startsWith('circle') ||
        first.startsWith('ellipse') ||
        first.startsWith('closest-') ||
        first.startsWith('farthest-') ||
        first.startsWith('at ') ||
        first.startsWith('from ') ||
        first.includes(' at ')
      ) {
        stopStartIndex = 1;
        const fromMatch = /from\s+([+-]?\d+\.?\d*(?:deg|rad|turn|grad))/i.exec(first);
        if (fromMatch) {
          const parsedAngle = parseGradientAngleOrDirection(fromMatch[1]!);
          if (parsedAngle !== null) angle = parsedAngle;
        }
      }
    }

    const stops = parseGradientStopsList(parts.slice(stopStartIndex), ctx, raw);
    if (stops) {
      return {
        kind: 'linear',
        angle,
        stops,
      };
    }
  }

  // 4. Shorthand background containing a gradient or a solid color token
  const embeddedGradientMatch = /((?:repeating-)?(?:linear|radial|conic)-gradient\([^)]+\))/i.exec(
    trimmed,
  );
  if (embeddedGradientMatch && embeddedGradientMatch[1] !== trimmed) {
    return parseFill(embeddedGradientMatch[1]!, ctx, property);
  }

  for (const token of splitTopLevel(trimmed, ' ')) {
    const candidate = normalizeColor(token);
    if (candidate) {
      return { kind: 'solid', color: candidate };
    }
  }

  pushWarning(
    ctx.warnings,
    'UNSUPPORTED_COLOR',
    `Unsupported ${property}: ${raw}`,
    ctx.path,
    ctx.layerId,
  );
  return { kind: 'solid', color: '#00000000' };
}

export function parseBorder(raw: string, ctx: StyleContext): Border | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed === '0' || trimmed === '0px') {
    return undefined;
  }

  const tokens = splitTopLevel(trimmed, ' ').filter(Boolean);
  let width: number | null = null;
  let style: BorderStyle | null = null;
  let color: string | null = null;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (width === null) {
      if (lower === 'thin') {
        width = 1;
        continue;
      }
      if (lower === 'medium') {
        width = 3;
        continue;
      }
      if (lower === 'thick') {
        width = 5;
        continue;
      }
      const len = parseFlexibleLength(token);
      if (len !== null) {
        width = len;
        continue;
      }
    }
    if (style === null) {
      if (lower === 'solid' || lower === 'dashed' || lower === 'dotted') {
        style = lower;
        continue;
      }
      if (
        lower === 'double' ||
        lower === 'groove' ||
        lower === 'ridge' ||
        lower === 'inset' ||
        lower === 'outset'
      ) {
        style = 'solid';
        continue;
      }
      if (lower === 'none' || lower === 'hidden') {
        return undefined;
      }
    }
    if (color === null) {
      const normalized = normalizeColor(token);
      if (normalized) {
        color = normalized;
        continue;
      }
    }
  }

  if (width === null || width <= 0 || style === null || color === null) {
    pushWarning(
      ctx.warnings,
      color === null ? 'UNSUPPORTED_COLOR' : 'UNSUPPORTED_VALUE',
      `Unsupported border: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return undefined;
  }

  return {
    width: clampQuantized(width, 0, 500),
    style,
    color,
  };
}

function parseFallbackBorder(declarations: Declarations, ctx: StyleContext): Border | undefined {
  const direct = declarations.get('border');
  if (direct !== undefined) {
    return parseBorder(direct, ctx);
  }

  // Check longhand border-width / border-style / border-color
  const bw = declarations.get('border-width');
  const bs = declarations.get('border-style');
  const bc = declarations.get('border-color');
  if (bw || bs || bc) {
    const firstWidth = bw ? (splitTopLevel(bw, ' ')[0] ?? '1px') : '1px';
    const firstStyle = bs ? (splitTopLevel(bs, ' ')[0] ?? 'solid') : 'solid';
    const firstColor = bc ? (splitTopLevel(bc, ' ')[0] ?? '#000000') : '#000000';
    return parseBorder(`${firstWidth} ${firstStyle} ${firstColor}`, ctx);
  }

  // Check directional borders or outline
  for (const side of ['border-top', 'border-bottom', 'border-left', 'border-right', 'outline']) {
    const val = declarations.get(side);
    if (val && val.trim().toLowerCase() !== 'none') {
      return parseBorder(val, ctx);
    }
  }

  return undefined;
}

export function parseShadow(
  raw: string,
  ctx: StyleContext,
  property: 'box-shadow' | 'text-shadow',
): Shadow | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return undefined;

  const firstShadow = splitTopLevel(trimmed, ',')[0]?.trim() ?? '';
  if (!firstShadow) return undefined;

  const tokens = splitTopLevel(firstShadow, ' ').filter(Boolean);
  const lengths: number[] = [];
  let color: string | null = null;
  let hasInset = false;

  for (const token of tokens) {
    if (token.toLowerCase() === 'inset') {
      hasInset = true;
      continue;
    }
    const maybeColor = normalizeColor(token);
    if (maybeColor !== null) {
      color = maybeColor;
      continue;
    }
    const maybePx = parseFlexibleLength(token);
    if (maybePx !== null) {
      lengths.push(maybePx);
      continue;
    }
    pushWarning(
      ctx.warnings,
      color === null ? 'UNSUPPORTED_COLOR' : 'UNSUPPORTED_VALUE',
      `Invalid ${property}: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return undefined;
  }

  if (hasInset) {
    pushWarning(
      ctx.warnings,
      'UNSUPPORTED_VALUE',
      `Inset shadow is not supported in ${property}: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return undefined;
  }

  if (lengths.length < 2 || lengths.length > 4 || color === null) {
    pushWarning(
      ctx.warnings,
      color === null ? 'UNSUPPORTED_COLOR' : 'UNSUPPORTED_VALUE',
      `Invalid ${property}: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return undefined;
  }

  const x = lengths[0]!;
  const y = lengths[1]!;
  const blur = Math.max(0, lengths[2] ?? 0);

  if (property === 'text-shadow' && lengths.length === 4) {
    pushWarning(
      ctx.warnings,
      'UNSUPPORTED_VALUE',
      `text-shadow has no spread; the fourth length was dropped: ${raw}`,
      `${ctx.path}.${property}`,
      ctx.layerId,
    );
    return { x, y, blur, color };
  }

  const spread = lengths[3];
  return spread !== undefined ? { x, y, blur, spread, color } : { x, y, blur, color };
}

function parseRadius(declarations: Declarations, ctx: StyleContext): number {
  const raw = declarations.get('border-radius');
  if (raw === undefined) return 0;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '0' || trimmed === '0px') return 0;

  // Support multi-corner shorthand like "16px 16px 0 0" or "50%"
  const firstCorner = splitTopLevel(trimmed.split('/')[0]!.trim(), ' ')[0]?.trim() ?? trimmed;

  if (firstCorner.endsWith('%')) {
    const pct = Number.parseFloat(firstCorner.slice(0, -1));
    if (Number.isFinite(pct) && pct >= 0) {
      const w = parseFlexibleLength(declarations.get('width') ?? '') ?? 100;
      const h = parseFlexibleLength(declarations.get('height') ?? '') ?? w;
      return clampQuantized((Math.min(w, h) * pct) / 100, 0, 5000);
    }
  }

  const px = parseFlexibleLength(firstCorner);
  if (px === null || px < 0) {
    pushWarning(
      ctx.warnings,
      'UNSUPPORTED_VALUE',
      `Invalid border-radius: ${raw}`,
      ctx.path,
      ctx.layerId,
    );
    return 0;
  }
  return clampQuantized(px, 0, 5000);
}

export function parseShapeStyle(
  declarations: Declarations,
  ctx: StyleContext,
): { fill: Fill; border?: Border; radius: number; shadow?: Shadow } {
  const bgRaw = declarations.get('background') ?? declarations.get('background-color');
  const fill: Fill =
    bgRaw !== undefined
      ? parseFill(bgRaw, ctx, declarations.has('background') ? 'background' : 'background-color')
      : { kind: 'solid', color: '#00000000' };

  const border = parseFallbackBorder(declarations, ctx);
  const radius = parseRadius(declarations, ctx);
  const shadowRaw = declarations.get('box-shadow');
  const shadow = shadowRaw !== undefined ? parseShadow(shadowRaw, ctx, 'box-shadow') : undefined;

  return {
    fill,
    ...(border ? { border } : {}),
    radius,
    ...(shadow ? { shadow } : {}),
  };
}

function parsePositionAxis(token: string, axis: 'x' | 'y'): number | null {
  const lower = token.trim().toLowerCase();
  if (lower === 'center') return 50;
  if (axis === 'x') {
    if (lower === 'left') return 0;
    if (lower === 'right') return 100;
  } else {
    if (lower === 'top') return 0;
    if (lower === 'bottom') return 100;
  }
  if (lower.endsWith('%')) {
    const num = Number.parseFloat(lower.slice(0, -1));
    if (Number.isFinite(num)) return clampQuantized(num, 0, 100);
  }
  return null;
}

export function parseImageStyle(declarations: Declarations, ctx: StyleContext): ImageStyle {
  let fit: ObjectFit = 'cover';
  const fitRaw = declarations.get('object-fit');
  if (fitRaw !== undefined) {
    const lower = fitRaw.trim().toLowerCase();
    if (lower === 'cover' || lower === 'contain' || lower === 'fill') {
      fit = lower;
    } else if (lower === 'scale-down' || lower === 'none') {
      fit = 'contain';
    } else {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_VALUE',
        `Invalid object-fit: ${fitRaw}`,
        ctx.path,
        ctx.layerId,
      );
    }
  }

  let position = { x: 50, y: 50 };
  const posRaw = declarations.get('object-position');
  if (posRaw !== undefined) {
    const parts = posRaw.trim().split(/\s+/);
    if (parts.length === 1) {
      const p0 = parts[0]!;
      const x = parsePositionAxis(p0, 'x');
      const y = parsePositionAxis(p0, 'y');
      if (x !== null) position = { x, y: 50 };
      else if (y !== null) position = { x: 50, y };
      else {
        pushWarning(
          ctx.warnings,
          'UNSUPPORTED_VALUE',
          `Invalid object-position: ${posRaw}`,
          ctx.path,
          ctx.layerId,
        );
      }
    } else if (parts.length >= 2) {
      const x = parsePositionAxis(parts[0]!, 'x');
      const y = parsePositionAxis(parts[1]!, 'y');
      if (x !== null && y !== null) {
        position = { x, y };
      } else {
        pushWarning(
          ctx.warnings,
          'UNSUPPORTED_VALUE',
          `Invalid object-position: ${posRaw}`,
          ctx.path,
          ctx.layerId,
        );
      }
    }
  }

  const radius = parseRadius(declarations, ctx);
  const border = parseFallbackBorder(declarations, ctx);
  const shadowRaw = declarations.get('box-shadow');
  const shadow = shadowRaw !== undefined ? parseShadow(shadowRaw, ctx, 'box-shadow') : undefined;

  return {
    fit,
    position,
    radius,
    ...(border ? { border } : {}),
    ...(shadow ? { shadow } : {}),
  };
}

export function parseTextStyle(declarations: Declarations, ctx: StyleContext): TextStyle {
  const hasArabicText = ctx.textContent ? containsArabic(ctx.textContent) : ctx.dir === 'rtl';
  const effectiveDir = hasArabicText ? 'rtl' : ctx.dir;

  let fontFamily = fallbackFont(effectiveDir);
  const fontRaw = declarations.get('font-family');
  if (fontRaw !== undefined) {
    const firstFamily = splitTopLevel(fontRaw, ',')[0]?.trim() ?? '';
    const matched = findAllowedFont(firstFamily);
    if (matched) {
      fontFamily = matched;
    } else {
      pushWarning(
        ctx.warnings,
        'FONT_FALLBACK',
        `Unsupported font "${firstFamily}", falling back to ${fontFamily}`,
        ctx.path,
        ctx.layerId,
      );
    }
  }

  if (hasArabicText && !isArabicFont(fontFamily)) {
    const arabicFallback = fallbackFont('rtl');
    pushWarning(
      ctx.warnings,
      'FONT_SCRIPT_MISMATCH',
      `Font "${fontFamily}" does not support Arabic script, switching to ${arabicFallback}`,
      ctx.path,
      ctx.layerId,
    );
    fontFamily = arabicFallback;
  }

  let fontSize = 32;
  const sizeRaw = declarations.get('font-size');
  if (sizeRaw !== undefined) {
    const lowerSize = sizeRaw.trim().toLowerCase();
    const parsedSize = KEYWORD_FONT_SIZES[lowerSize] ?? parseFlexibleLength(sizeRaw);
    if (parsedSize === null || parsedSize <= 0) {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_VALUE',
        `Invalid font-size: ${sizeRaw}`,
        ctx.path,
        ctx.layerId,
      );
    } else {
      if (parsedSize < LIMITS.text.minFontSize || parsedSize > LIMITS.text.maxFontSize) {
        pushWarning(
          ctx.warnings,
          'NUMBER_CLAMPED',
          `Clamped font-size ${parsedSize} to [${LIMITS.text.minFontSize}, ${LIMITS.text.maxFontSize}]`,
          ctx.path,
          ctx.layerId,
        );
      }
      fontSize = clampQuantized(parsedSize, LIMITS.text.minFontSize, LIMITS.text.maxFontSize);
    }
  }

  let fontWeight = 400;
  const weightRaw = declarations.get('font-weight');
  if (weightRaw !== undefined) {
    fontWeight = normalizeFontWeight(weightRaw);
  }

  const italic = declarations.get('font-style')?.trim().toLowerCase() === 'italic';
  const textDecRaw = (
    declarations.get('text-decoration') ??
    declarations.get('text-decoration-line') ??
    ''
  )
    .trim()
    .toLowerCase();
  const underline = textDecRaw.includes('underline');

  let color = '#000000';
  const colorRaw = declarations.get('color');
  if (colorRaw !== undefined) {
    const normalized = normalizeColor(colorRaw);
    if (normalized) {
      color = normalized;
    } else {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_COLOR',
        `Invalid text color: ${colorRaw}`,
        ctx.path,
        ctx.layerId,
      );
    }
  }

  let align: TextAlign = ctx.dir === 'rtl' ? 'right' : 'left';
  const alignRaw = declarations.get('text-align')?.trim().toLowerCase();
  if (alignRaw !== undefined) {
    if (
      alignRaw === 'left' ||
      alignRaw === 'center' ||
      alignRaw === 'right' ||
      alignRaw === 'justify'
    ) {
      align = alignRaw;
    } else if (alignRaw === 'start') {
      align = ctx.dir === 'rtl' ? 'right' : 'left';
    } else if (alignRaw === 'end') {
      align = ctx.dir === 'rtl' ? 'left' : 'right';
    } else {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_VALUE',
        `Invalid text-align: ${alignRaw}`,
        ctx.path,
        ctx.layerId,
      );
    }
  }

  let lineHeight = 1.2;
  const lhRaw = declarations.get('line-height');
  if (lhRaw !== undefined) {
    const trimmedLh = lhRaw.trim().toLowerCase();
    if (trimmedLh === 'normal') {
      lineHeight = 1.2;
    } else if (trimmedLh.endsWith('%')) {
      const pct = Number.parseFloat(trimmedLh.slice(0, -1));
      if (Number.isFinite(pct) && pct > 0) {
        lineHeight = clampQuantized(
          pct / 100,
          LIMITS.text.minLineHeight,
          LIMITS.text.maxLineHeight,
        );
      }
    } else {
      const pxLh = parseFlexibleLength(trimmedLh, fontSize);
      if (pxLh !== null && trimmedLh.endsWith('px')) {
        lineHeight = clampQuantized(
          pxLh / Math.max(1, fontSize),
          LIMITS.text.minLineHeight,
          LIMITS.text.maxLineHeight,
        );
      } else {
        const numLh = parseNumber(trimmedLh);
        if (numLh !== null && numLh > 0) {
          lineHeight = clampQuantized(numLh, LIMITS.text.minLineHeight, LIMITS.text.maxLineHeight);
        } else {
          pushWarning(
            ctx.warnings,
            'UNSUPPORTED_VALUE',
            `Invalid line-height: ${lhRaw}`,
            ctx.path,
            ctx.layerId,
          );
        }
      }
    }
  }

  let letterSpacing = 0;
  const lsRaw = declarations.get('letter-spacing');
  if (lsRaw !== undefined) {
    const trimmedLs = lsRaw.trim().toLowerCase();
    if (trimmedLs === 'normal' || trimmedLs === '0') {
      letterSpacing = 0;
    } else {
      const parsedLs = parseFlexibleLength(trimmedLs, fontSize);
      if (parsedLs !== null) {
        letterSpacing = clampQuantized(
          parsedLs,
          LIMITS.text.minLetterSpacing,
          LIMITS.text.maxLetterSpacing,
        );
      } else {
        pushWarning(
          ctx.warnings,
          'UNSUPPORTED_VALUE',
          `Invalid letter-spacing: ${lsRaw}`,
          ctx.path,
          ctx.layerId,
        );
      }
    }
  }

  if (letterSpacing !== 0 && requiresZeroLetterSpacing(ctx.dir, ctx.textContent ?? '')) {
    letterSpacing = 0;
    pushWarning(
      ctx.warnings,
      'ARABIC_LETTER_SPACING_DROPPED',
      'Nonzero letter-spacing was removed to preserve Arabic/RTL joining',
      ctx.path,
      ctx.layerId,
    );
  }

  let textTransform: TextTransform = 'none';
  const ttRaw = declarations.get('text-transform')?.trim().toLowerCase();
  if (ttRaw !== undefined) {
    if (
      ttRaw === 'none' ||
      ttRaw === 'uppercase' ||
      ttRaw === 'lowercase' ||
      ttRaw === 'capitalize'
    ) {
      textTransform = ttRaw;
    } else {
      pushWarning(
        ctx.warnings,
        'UNSUPPORTED_VALUE',
        `Invalid text-transform: ${ttRaw}`,
        ctx.path,
        ctx.layerId,
      );
    }
  }

  const shadowRaw = declarations.get('text-shadow');
  const shadow = shadowRaw !== undefined ? parseShadow(shadowRaw, ctx, 'text-shadow') : undefined;

  return {
    fontFamily,
    fontSize,
    fontWeight,
    italic,
    underline,
    color,
    align,
    lineHeight,
    letterSpacing,
    textTransform,
    ...(shadow ? { shadow } : {}),
  };
}
