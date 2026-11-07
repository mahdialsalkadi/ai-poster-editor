import * as csstree from 'css-tree';
import { normalizeColor } from './color.js';
import { DesignError, LimitExceededError, SecurityViolationError } from './errors.js';
import { containsArabic, fallbackFont, findAllowedFont, isArabicFont, normalizeFontWeight } from './fonts.js';
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
import { clamp, normalizeAngle, parseNumber, parsePx, quantize } from './numbers.js';
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

const SECURITY_VALUE_RE = /(?:url\s*\(|@import|expression\s*\(|javascript\s*:)/i;
const SECURITY_PROPERTY_RE = /^(?:behavior|-moz-binding)$/i;
const DROPPED_PROPERTIES = new Set([
  'display',
  'float',
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
  'clip',
  'clip-path',
  'filter',
  'backdrop-filter',
  'white-space',
  'direction',
  'writing-mode',
]);

function warn(
  ctx: StyleContext,
  code: Parameters<typeof pushWarning>[1],
  message: string,
  path: string,
): void {
  pushWarning(ctx.warnings, code, message, `${ctx.path}.${path}`, ctx.layerId);
}

/**
 * Parses a style attribute into a declaration map.
 *
 * Security-sensitive values are rejected immediately. Non-executable but
 * unsupported properties are dropped with warnings.
 */
export function parseDeclarations(style: string, ctx: StyleContext): Declarations {
  if (style.length > LIMITS.style.maxBytes) {
    throw new LimitExceededError(
      `Style attribute exceeds ${LIMITS.style.maxBytes} bytes`,
      ctx.path,
    );
  }

  const declarations = new Map<string, string>();
  let ast: unknown;
  try {
    ast = csstree.parse(style, {
      context: 'declarationList',
      parseValue: true,
      positions: false,
    });
  } catch {
    warn(ctx, 'UNSUPPORTED_VALUE', 'Could not parse style attribute', 'style');
    return declarations;
  }

  const list = ast as { children?: { forEach(callback: (node: csstree.CssNode) => void): void } };
  if (!list.children) {
    warn(ctx, 'UNSUPPORTED_VALUE', 'Could not parse style attribute', 'style');
    return declarations;
  }

  let count = 0;
  list.children.forEach((node) => {
    if (node.type !== 'Declaration') return;
    count += 1;
    if (count > LIMITS.style.maxDeclarationsPerLayer) {
      throw new LimitExceededError(
        `Style attribute exceeds ${LIMITS.style.maxDeclarationsPerLayer} declarations`,
        ctx.path,
      );
    }

    const property = node.property.toLowerCase();
    const value = csstree.generate(node.value).trim();

    if (SECURITY_PROPERTY_RE.test(property)) {
      throw new SecurityViolationError(`Forbidden CSS property: ${property}`, ctx.path);
    }
    if (SECURITY_VALUE_RE.test(value)) {
      throw new SecurityViolationError(`Forbidden CSS value in ${property}`, ctx.path);
    }
    if (property.startsWith('--')) {
      warn(ctx, 'UNSUPPORTED_PROPERTY', `CSS variables are not supported: ${property}`, property);
      return;
    }
    if (DROPPED_PROPERTIES.has(property)) {
      warn(ctx, 'UNSUPPORTED_PROPERTY', `Property is not supported: ${property}`, property);
      return;
    }

    declarations.set(property, value);
  });

  return declarations;
}

function readLength(
  declarations: Declarations,
  property: string,
  ctx: StyleContext,
  min: number,
  max: number,
): number | undefined {
  const raw = declarations.get(property);
  if (raw === undefined) return undefined;
  if (raw.trim().endsWith('%')) {
    warn(ctx, 'PERCENTAGE_DROPPED', `${property} must be expressed in px`, property);
    return undefined;
  }
  const parsed = parsePx(raw);
  if (parsed === null) {
    warn(ctx, 'UNSUPPORTED_VALUE', `Invalid ${property} value: ${raw}`, property);
    return undefined;
  }
  const clamped = clamp(parsed, min, max);
  if (clamped !== parsed) {
    warn(ctx, 'NUMBER_CLAMPED', `${property} was clamped to ${clamped}`, property);
  }
  return quantize(clamped);
}

export function parseCommonGeometry(
  declarations: Declarations,
  ctx: StyleContext,
  requireHeight: boolean,
): CommonGeometry {
  const geometry: CommonGeometry = {};
  const left = readLength(declarations, 'left', ctx, -100_000, 100_000);
  const top = readLength(declarations, 'top', ctx, -100_000, 100_000);
  const width = readLength(declarations, 'width', ctx, 1, 10_000);
  const height = readLength(declarations, 'height', ctx, 1, 10_000);

  if (left !== undefined) geometry.left = left;
  if (top !== undefined) geometry.top = top;
  if (width !== undefined) geometry.width = width;
  if (height !== undefined) geometry.height = height;

  if (requireHeight && height === undefined) {
    warn(ctx, 'MISSING_ATTRIBUTE', 'height is required for this layer type', 'height');
  }
  if (!requireHeight && height !== undefined) {
    warn(ctx, 'UNSUPPORTED_PROPERTY', 'Text height is automatic and cannot be fixed', 'height');
  }

  const transform = declarations.get('transform');
  if (transform !== undefined) {
    const match = transform.trim().match(/^rotate\(\s*(-?(?:\d+\.?\d*|\.\d+))deg\s*\)$/i);
    if (!match?.[1]) {
      warn(ctx, 'UNSUPPORTED_VALUE', 'Only rotate(<n>deg) is supported', 'transform');
    } else {
      geometry.rotation = normalizeAngle(Number.parseFloat(match[1]));
    }
  }

  const opacityRaw = declarations.get('opacity');
  if (opacityRaw !== undefined) {
    const opacity = parseNumber(opacityRaw);
    if (opacity === null) {
      warn(ctx, 'UNSUPPORTED_VALUE', `Invalid opacity: ${opacityRaw}`, 'opacity');
    } else {
      const clamped = clamp(opacity, 0, 1);
      if (clamped !== opacity) {
        warn(ctx, 'NUMBER_CLAMPED', `opacity was clamped to ${clamped}`, 'opacity');
      }
      geometry.opacity = quantize(clamped);
    }
  }

  return geometry;
}

function parseAngle(input: string): number | null {
  const value = input.trim().toLowerCase();
  if (value.endsWith('deg')) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? normalizeAngle(parsed) : null;
  }
  const keyword = value.replace(/^to\s+/, '').trim();
  const angles: Record<string, number> = {
    top: 0,
    'top right': 45,
    right: 90,
    'bottom right': 135,
    bottom: 180,
    'bottom left': 225,
    left: 270,
    'top left': 315,
  };
  return angles[keyword] ?? null;
}

export function splitTopLevel(input: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function splitWhitespace(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (/\s/.test(char ?? '') && depth === 0) {
      if (index > start) parts.push(input.slice(start, index));
      start = index + 1;
    }
  }
  if (start < input.length) parts.push(input.slice(start));
  return parts;
}

function parseStop(raw: string): GradientStop | null {
  const value = raw.trim();
  if (!value) return null;
  const match = value.match(/^(.*?)(?:\s+(-?(?:\d+\.?\d*|\.\d+))%)?$/);
  if (!match?.[1]) return null;
  const color = normalizeColor(match[1].trim());
  if (!color) return null;
  const pos = match[2] === undefined ? undefined : clamp(Number.parseFloat(match[2]), 0, 100);
  return { color, pos: pos === undefined ? Number.NaN : quantize(pos) };
}

export function parseFill(raw: string, ctx: StyleContext, property = 'background'): Fill {
  const value = raw.trim();
  const gradient = value.match(/^linear-gradient\((.*)\)$/i);
  if (!gradient?.[1]) {
    const color = normalizeColor(value);
    if (color) return { kind: 'solid', color };
    warn(ctx, 'UNSUPPORTED_VALUE', `Unsupported background: ${value}`, property);
    return { kind: 'solid', color: '#00000000' };
  }

  const parts = splitTopLevel(gradient[1]);
  if (parts.length === 0) {
    warn(ctx, 'UNSUPPORTED_VALUE', 'Empty linear-gradient', property);
    return { kind: 'solid', color: '#00000000' };
  }

  let angle = 180;
  let stopParts = parts;
  const possibleAngle = parseAngle(parts[0] ?? '');
  if (possibleAngle !== null && !normalizeColor(parts[0] ?? '')) {
    angle = possibleAngle;
    stopParts = parts.slice(1);
  }

  if (stopParts.length > LIMITS.gradient.maxStops) {
    warn(
      ctx,
      'GRADIENT_LIMIT',
      `Gradient has ${stopParts.length} stops; only the first ${LIMITS.gradient.maxStops} are kept`,
      property,
    );
    stopParts = stopParts.slice(0, LIMITS.gradient.maxStops);
  }

  const stops = stopParts.map(parseStop).filter((stop): stop is GradientStop => stop !== null);
  if (stops.length < LIMITS.gradient.minStops) {
    warn(ctx, 'UNSUPPORTED_VALUE', 'A gradient needs at least two color stops', property);
    return { kind: 'solid', color: stops[0]?.color ?? '#00000000' };
  }

  const missing = stops.filter((stop) => Number.isNaN(stop.pos));
  if (missing.length === stops.length) {
    stops.forEach((stop, index) => {
      stop.pos = quantize((index / (stops.length - 1)) * 100);
    });
  } else if (missing.length > 0) {
    const known = stops.filter((stop) => !Number.isNaN(stop.pos));
    if (!Number.isNaN(stops[0]?.pos ?? Number.NaN)) {
      // Keep explicitly positioned stops; fill gaps evenly between neighbors.
    }
    for (let index = 0; index < stops.length; index += 1) {
      const stop = stops[index];
      if (!stop || !Number.isNaN(stop.pos)) continue;
      const previous = [...stops.slice(0, index)].reverse().find((item) => !Number.isNaN(item.pos));
      const next = stops.slice(index + 1).find((item) => !Number.isNaN(item.pos));
      const previousPos = previous?.pos ?? 0;
      const nextPos = next?.pos ?? 100;
      stop.pos = quantize(previousPos + (nextPos - previousPos) / 2);
      void known;
    }
  }

  stops.forEach((stop) => {
    if (Number.isNaN(stop.pos)) stop.pos = 0;
  });
  stops.sort((a, b) => a.pos - b.pos);

  return { kind: 'linear', angle, stops };
}

export function parseShadow(
  raw: string,
  ctx: StyleContext,
  property: 'box-shadow' | 'text-shadow',
): Shadow | undefined {
  const value = raw.trim();
  if (value === 'none' || value === '') return undefined;
  if (/\binset\b/i.test(value)) {
    warn(ctx, 'UNSUPPORTED_VALUE', 'Inset shadows are not supported', property);
    return undefined;
  }
  if (splitTopLevel(value).length > 1) {
    warn(ctx, 'UNSUPPORTED_VALUE', 'Only one shadow is supported', property);
    return undefined;
  }

  const tokens = splitWhitespace(value);
  let color: string | null = null;
  const lengths: number[] = [];

  for (const token of tokens) {
    const normalized = normalizeColor(token);
    if (normalized && lengths.length === 0) {
      color = normalized;
      continue;
    }
    const length = parsePx(token);
    if (length !== null) {
      lengths.push(length);
      continue;
    }
    const trailingColor = normalizeColor(token);
    if (trailingColor) {
      color = trailingColor;
      continue;
    }
    warn(ctx, 'UNSUPPORTED_VALUE', `Invalid shadow token: ${token}`, property);
    return undefined;
  }

  if (lengths.length < 3 || lengths.length > 4) {
    warn(ctx, 'UNSUPPORTED_VALUE', `Invalid shadow value: ${value}`, property);
    return undefined;
  }

  const [x, y, blur, spread] = lengths as [number, number, number, number?];
  const result: Shadow = {
    x: quantize(x),
    y: quantize(y),
    blur: quantize(Math.max(0, blur)),
    color: color ?? '#000000',
  };
  if (property === 'box-shadow' && spread !== undefined) result.spread = quantize(spread);
  return result;
}

export function parseBorder(raw: string, ctx: StyleContext): Border | undefined {
  const value = raw.trim();
  if (value === 'none' || value === '0' || value === '') return undefined;
  const tokens = splitWhitespace(value);
  if (tokens.length < 2) {
    warn(ctx, 'UNSUPPORTED_VALUE', `Invalid border: ${value}`, 'border');
    return undefined;
  }

  let width = 1;
  let style: BorderStyle = 'solid';
  let color = '#000000';

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'solid' || lower === 'dashed' || lower === 'dotted') {
      style = lower;
      continue;
    }
    const parsedWidth = parsePx(token);
    if (parsedWidth !== null) {
      width = Math.max(0, parsedWidth);
      continue;
    }
    const parsedColor = normalizeColor(token);
    if (parsedColor) {
      color = parsedColor;
      continue;
    }
    warn(ctx, 'UNSUPPORTED_VALUE', `Invalid border token: ${token}`, 'border');
    return undefined;
  }

  if (width === 0) return undefined;
  return { width: quantize(width), style, color };
}

function parseRadius(declarations: Declarations, ctx: StyleContext): number {
  const raw = declarations.get('border-radius');
  if (raw === undefined) return 0;
  if (splitWhitespace(raw).length > 1 || raw.includes('/')) {
    warn(ctx, 'UNSUPPORTED_VALUE', 'Only a single border-radius value is supported', 'border-radius');
    return 0;
  }
  const parsed = parsePx(raw);
  if (parsed === null) {
    warn(ctx, 'UNSUPPORTED_VALUE', `Invalid border-radius: ${raw}`, 'border-radius');
    return 0;
  }
  return quantize(clamp(parsed, 0, 10_000));
}

export function parseTextStyle(declarations: Declarations, ctx: StyleContext): TextStyle {
  const text = ctx.textContent ?? '';
  let fontFamily = fallbackFont(ctx.dir);
  const fontRaw = declarations.get('font-family');
  if (fontRaw !== undefined) {
    const found = findAllowedFont(fontRaw);
    if (found) {
      fontFamily = found;
    } else {
      warn(ctx, 'FONT_FALLBACK', `Font is not allowed; using ${fontFamily}`, 'font-family');
    }
  }
  if (containsArabic(text) && !isArabicFont(fontFamily)) {
    const fallback = fallbackFont('rtl');
    warn(
      ctx,
      'FONT_SCRIPT_MISMATCH',
      `${fontFamily} does not cover Arabic text; using ${fallback}`,
      'font-family',
    );
    fontFamily = fallback;
  }

  const fontSizeRaw = declarations.get('font-size');
  let fontSize = 16;
  if (fontSizeRaw !== undefined) {
    if (fontSizeRaw.endsWith('%')) {
      warn(ctx, 'PERCENTAGE_DROPPED', 'font-size must be expressed in px', 'font-size');
    } else {
      const parsed = parsePx(fontSizeRaw);
      if (parsed === null) {
        warn(ctx, 'UNSUPPORTED_VALUE', `Invalid font-size: ${fontSizeRaw}`, 'font-size');
      } else {
        const clamped = clamp(parsed, LIMITS.text.minFontSize, LIMITS.text.maxFontSize);
        if (clamped !== parsed) {
          warn(ctx, 'NUMBER_CLAMPED', `font-size was clamped to ${clamped}`, 'font-size');
        }
        fontSize = clamped;
      }
    }
  }

  const fontWeightRaw = declarations.get('font-weight');
  const fontWeight = fontWeightRaw === undefined ? 400 : normalizeFontWeight(fontWeightRaw);
  const fontStyle = declarations.get('font-style')?.trim().toLowerCase();
  const italic = fontStyle === 'italic';
  if (fontStyle !== undefined && fontStyle !== 'normal' && fontStyle !== 'italic') {
    warn(ctx, 'UNSUPPORTED_VALUE', `Unsupported font-style: ${fontStyle}`, 'font-style');
  }

  const decoration = declarations.get('text-decoration')?.trim().toLowerCase();
  let underline = decoration === 'underline';
  if (decoration !== undefined && decoration !== 'none' && decoration !== 'underline') {
    warn(ctx, 'UNSUPPORTED_VALUE', `Unsupported text-decoration: ${decoration}`, 'text-decoration');
    underline = false;
  }

  const colorRaw = declarations.get('color');
  let color = '#000000';
  if (colorRaw !== undefined) {
    const parsed = normalizeColor(colorRaw);
    if (parsed) color = parsed;
    else warn(ctx, 'UNSUPPORTED_VALUE', `Invalid color: ${colorRaw}`, 'color');
  }

  const alignRaw = declarations.get('text-align')?.trim().toLowerCase();
  let align: TextAlign = 'left';
  if (alignRaw === 'left' || alignRaw === 'center' || alignRaw === 'right' || alignRaw === 'justify') {
    align = alignRaw;
  } else if (alignRaw === 'start') {
    align = ctx.dir === 'rtl' ? 'right' : 'left';
  } else if (alignRaw === 'end') {
    align = ctx.dir === 'rtl' ? 'left' : 'right';
  } else if (alignRaw !== undefined) {
    warn(ctx, 'UNSUPPORTED_VALUE', `Unsupported text-align: ${alignRaw}`, 'text-align');
  }

  const lineHeightRaw = declarations.get('line-height');
  let lineHeight = 1.2;
  if (lineHeightRaw !== undefined) {
    if (lineHeightRaw.trim().toLowerCase() === 'normal') {
      lineHeight = 1.2;
    } else {
      const parsed = parseNumber(lineHeightRaw);
      if (parsed === null || parsed <= 0) {
        warn(ctx, 'UNSUPPORTED_VALUE', `Invalid line-height: ${lineHeightRaw}`, 'line-height');
      } else {
        lineHeight = parsed;
      }
    }
  }

  const letterSpacingRaw = declarations.get('letter-spacing');
  let letterSpacing = 0;
  if (letterSpacingRaw !== undefined) {
    const parsed = parsePx(letterSpacingRaw);
    if (parsed === null) {
      warn(ctx, 'UNSUPPORTED_VALUE', `Invalid letter-spacing: ${letterSpacingRaw}`, 'letter-spacing');
    } else {
      letterSpacing = clamp(
        parsed,
        LIMITS.text.minLetterSpacing,
        LIMITS.text.maxLetterSpacing,
      );
      if (ctx.dir === 'rtl' && containsArabic(text) && letterSpacing !== 0) {
        warn(
          ctx,
          'UNSUPPORTED_VALUE',
          'letter-spacing can break Arabic cursive joining',
          'letter-spacing',
        );
      }
    }
  }

  const transformRaw = declarations.get('text-transform')?.trim().toLowerCase();
  let textTransform: TextTransform = 'none';
  if (
    transformRaw === 'none' ||
    transformRaw === 'uppercase' ||
    transformRaw === 'lowercase' ||
    transformRaw === 'capitalize'
  ) {
    textTransform = transformRaw;
  } else if (transformRaw !== undefined) {
    warn(ctx, 'UNSUPPORTED_VALUE', `Unsupported text-transform: ${transformRaw}`, 'text-transform');
  }

  const shadowRaw = declarations.get('text-shadow');
  const shadow = shadowRaw === undefined ? undefined : parseShadow(shadowRaw, ctx, 'text-shadow');

  return {
    fontFamily,
    fontSize: quantize(fontSize),
    fontWeight,
    italic,
    underline,
    color,
    align,
    lineHeight,
    letterSpacing: quantize(letterSpacing),
    textTransform,
    ...(shadow ? { shadow } : {}),
  };
}

export function parseShapeStyle(declarations: Declarations, ctx: StyleContext): {
  fill: Fill;
  border?: Border;
  radius: number;
  shadow?: Shadow;
} {
  const backgroundRaw = declarations.get('background');
  const backgroundColorRaw = declarations.get('background-color');
  const fill = parseFill(backgroundRaw ?? backgroundColorRaw ?? 'transparent', ctx);
  const borderRaw = declarations.get('border');
  const border = borderRaw === undefined ? undefined : parseBorder(borderRaw, ctx);
  const shadowRaw = declarations.get('box-shadow');
  const shadow = shadowRaw === undefined ? undefined : parseShadow(shadowRaw, ctx, 'box-shadow');
  return {
    fill,
    radius: parseRadius(declarations, ctx),
    ...(border ? { border } : {}),
    ...(shadow ? { shadow } : {}),
  };
}

export function parseImageStyle(declarations: Declarations, ctx: StyleContext): ImageStyle {
  const fitRaw = declarations.get('object-fit')?.trim().toLowerCase();
  let fit: ObjectFit = 'fill';
  if (fitRaw === 'cover' || fitRaw === 'contain' || fitRaw === 'fill') fit = fitRaw;
  else if (fitRaw !== undefined) {
    warn(ctx, 'UNSUPPORTED_VALUE', `Unsupported object-fit: ${fitRaw}`, 'object-fit');
  }

  let position = { x: 50, y: 50 };
  const positionRaw = declarations.get('object-position');
  if (positionRaw !== undefined) {
    const parts = splitWhitespace(positionRaw);
    if (parts.length > 2) {
      warn(ctx, 'UNSUPPORTED_VALUE', `Invalid object-position: ${positionRaw}`, 'object-position');
    } else {
      const values = parts.map((part) => {
        if (part.endsWith('%')) {
          const parsed = Number.parseFloat(part);
          return Number.isFinite(parsed) ? clamp(parsed, 0, 100) : null;
        }
        const keywords: Record<string, number> = {
          left: 0,
          center: 50,
          right: 100,
          top: 0,
          bottom: 100,
        };
        return keywords[part.toLowerCase()] ?? null;
      });
      if (values.some((value) => value === null)) {
        warn(ctx, 'UNSUPPORTED_VALUE', `Invalid object-position: ${positionRaw}`, 'object-position');
      } else {
        position = {
          x: quantize(values[0] ?? 50),
          y: quantize(values[1] ?? 50),
        };
      }
    }
  }

  const borderRaw = declarations.get('border');
  const border = borderRaw === undefined ? undefined : parseBorder(borderRaw, ctx);
  const shadowRaw = declarations.get('box-shadow');
  const shadow = shadowRaw === undefined ? undefined : parseShadow(shadowRaw, ctx, 'box-shadow');

  return {
    fit,
    position,
    radius: parseRadius(declarations, ctx),
    ...(border ? { border } : {}),
    ...(shadow ? { shadow } : {}),
  };
}

export function ensureNoUnknownCriticalProperties(declarations: Declarations, ctx: StyleContext): void {
  const supported = new Set([
    'position',
    'left',
    'top',
    'width',
    'height',
    'transform',
    'opacity',
    'background',
    'background-color',
    'border',
    'border-radius',
    'box-shadow',
    'text-shadow',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration',
    'color',
    'text-align',
    'line-height',
    'letter-spacing',
    'text-transform',
    'object-fit',
    'object-position',
  ]);
  for (const property of declarations.keys()) {
    if (!supported.has(property)) {
      warn(ctx, 'UNSUPPORTED_PROPERTY', `Property is not supported: ${property}`, property);
    }
  }
}

export function assertAbsolutePosition(declarations: Declarations, ctx: StyleContext): void {
  const position = declarations.get('position')?.trim().toLowerCase();
  if (position !== 'absolute') {
    throw new DesignError('INVALID_DOC', 'Layers must declare position:absolute', ctx.path);
  }
}
