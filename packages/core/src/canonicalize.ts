import { normalizeColor } from './color.js';
import { DesignError } from './errors.js';
import {
  containsArabic,
  fallbackFont,
  findAllowedFont,
  isArabicFont,
  requiresZeroLetterSpacing,
} from './fonts.js';
import { LIMITS } from './limits.js';
import { canonicalInlineText } from './text.js';
import type {
  Border,
  DesignDoc,
  Fill,
  ImageLayer,
  InlineNode,
  Layer,
  LayerBase,
  Shadow,
  ShapeLayer,
  SvgLayer,
  SvgNode,
  TextLayer,
  TextStyle,
} from './model.js';
import { DESIGN_DOC_VERSION } from './model.js';
import { clamp, normalizeAngle, quantize } from './numbers.js';

const LAYER_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ASSET_SRC_RE = /^asset:[A-Za-z0-9_-]{1,64}$/;

function canonicalColor(input: string, path: string): string {
  const color = normalizeColor(input);
  if (!color) throw new DesignError('INVALID_DOC', `Invalid color: ${input}`, path);
  return color;
}

function canonicalFill(fill: Fill, path: string): Fill {
  if (fill.kind === 'solid') {
    return { kind: 'solid', color: canonicalColor(fill.color, `${path}.color`) };
  }
  const stops = fill.stops
    .slice(0, LIMITS.gradient.maxStops)
    .map((stop, index) => ({
      color: canonicalColor(stop.color, `${path}.stops[${index}].color`),
      pos: quantize(clamp(stop.pos, 0, 100)),
    }))
    .sort((a, b) => a.pos - b.pos);
  if (stops.length < LIMITS.gradient.minStops) {
    throw new DesignError('INVALID_DOC', 'A gradient needs at least two stops', path);
  }
  return {
    kind: 'linear',
    angle: normalizeAngle(fill.angle),
    stops,
  };
}

function canonicalShadow(shadow: Shadow, path: string): Shadow {
  const result: Shadow = {
    x: quantize(shadow.x),
    y: quantize(shadow.y),
    blur: quantize(Math.max(0, shadow.blur)),
    color: canonicalColor(shadow.color, `${path}.color`),
  };
  if (shadow.spread !== undefined) result.spread = quantize(shadow.spread);
  return result;
}

function canonicalBorder(border: Border, path: string): Border {
  if (border.width <= 0) {
    throw new DesignError('INVALID_DOC', 'Border width must be positive', `${path}.width`);
  }
  return {
    width: quantize(border.width),
    style: border.style,
    color: canonicalColor(border.color, `${path}.color`),
  };
}

function canonicalInline(nodes: readonly InlineNode[], path: string): InlineNode[] {
  return nodes.map((node, index) => {
    if (node.kind === 'text') return { kind: 'text', text: node.text };
    if (node.kind === 'br') return { kind: 'br' };
    return {
      kind: 'span',
      text: node.text,
      ...(node.bold ? { bold: true } : {}),
      ...(node.italic ? { italic: true } : {}),
      ...(node.underline ? { underline: true } : {}),
      ...(node.color ? { color: canonicalColor(node.color, `${path}[${index}].color`) } : {}),
    };
  });
}

function canonicalTextStyle(style: TextStyle, dir: 'ltr' | 'rtl', text: string): TextStyle {
  let fontFamily = style.fontFamily;
  const allowed = findAllowedFont(fontFamily);
  if (!allowed) fontFamily = fallbackFont(dir);
  else fontFamily = allowed;
  if (containsArabic(text) && !isArabicFont(fontFamily)) {
    fontFamily = fallbackFont('rtl');
  }
  return {
    fontFamily,
    fontSize: quantize(clamp(style.fontSize, LIMITS.text.minFontSize, LIMITS.text.maxFontSize)),
    fontWeight: Math.round(clamp(style.fontWeight, 100, 900) / 100) * 100,
    italic: style.italic,
    underline: style.underline,
    color: canonicalColor(style.color, 'style.color'),
    align: style.align,
    lineHeight: quantize(
      clamp(style.lineHeight, LIMITS.text.minLineHeight, LIMITS.text.maxLineHeight),
    ),
    letterSpacing: requiresZeroLetterSpacing(dir, text)
      ? 0
      : quantize(
          clamp(style.letterSpacing, LIMITS.text.minLetterSpacing, LIMITS.text.maxLetterSpacing),
        ),
    textTransform: style.textTransform,
    ...(style.shadow ? { shadow: canonicalShadow(style.shadow, 'style.shadow') } : {}),
  };
}

function canonicalTextLayer(layer: TextLayer): TextLayer {
  const text = layer.content.map((node) => (node.kind === 'br' ? '\n' : node.text)).join('');
  return {
    ...canonicalBase(layer),
    type: 'text',
    dir: layer.dir,
    content: canonicalInlineText(canonicalInline(layer.content, 'content')),
    style: canonicalTextStyle(layer.style, layer.dir, text),
  };
}

function canonicalBase(layer: LayerBase): LayerBase {
  if (!LAYER_ID_RE.test(layer.id) || layer.id.length > LIMITS.document.maxLayerIdLength) {
    throw new DesignError('INVALID_DOC', `Invalid layer id: ${layer.id}`, 'id');
  }
  return {
    id: layer.id,
    name: layer.name.slice(0, LIMITS.document.maxLayerNameLength),
    left: quantize(clamp(layer.left, -100_000, 100_000)),
    top: quantize(clamp(layer.top, -100_000, 100_000)),
    width: quantize(clamp(layer.width, 1, 10_000)),
    rotation: normalizeAngle(layer.rotation),
    opacity: quantize(clamp(layer.opacity, 0, 1)),
    hidden: layer.hidden,
    locked: layer.locked,
  };
}

function canonicalShapeLayer(layer: ShapeLayer): ShapeLayer {
  return {
    ...canonicalBase(layer),
    type: 'shape',
    height: quantize(clamp(layer.height, 1, 10_000)),
    style: {
      fill: canonicalFill(layer.style.fill, 'style.fill'),
      radius: quantize(clamp(layer.style.radius, 0, 10_000)),
      ...(layer.style.border
        ? { border: canonicalBorder(layer.style.border, 'style.border') }
        : {}),
      ...(layer.style.shadow
        ? { shadow: canonicalShadow(layer.style.shadow, 'style.shadow') }
        : {}),
    },
  };
}

function canonicalImageLayer(layer: ImageLayer): ImageLayer {
  if (!ASSET_SRC_RE.test(layer.src)) {
    throw new DesignError('INVALID_DOC', `Invalid image src: ${layer.src}`, 'src');
  }
  return {
    ...canonicalBase(layer),
    type: 'image',
    height: quantize(clamp(layer.height, 1, 10_000)),
    src: layer.src,
    ...(layer.prompt ? { prompt: layer.prompt } : {}),
    ...(layer.alt ? { alt: layer.alt } : {}),
    style: {
      fit: layer.style.fit,
      position: {
        x: quantize(clamp(layer.style.position.x, 0, 100)),
        y: quantize(clamp(layer.style.position.y, 0, 100)),
      },
      radius: quantize(clamp(layer.style.radius, 0, 10_000)),
      ...(layer.style.border
        ? { border: canonicalBorder(layer.style.border, 'style.border') }
        : {}),
      ...(layer.style.shadow
        ? { shadow: canonicalShadow(layer.style.shadow, 'style.shadow') }
        : {}),
    },
  };
}

function canonicalSvgPaint(value: string, path: string): string {
  const trimmed = value.trim();
  if (trimmed === 'none') return 'none';
  if (trimmed.startsWith('url(')) return trimmed;
  return canonicalColor(trimmed, path);
}

function canonicalSvgNodes(nodes: readonly SvgNode[]): SvgNode[] {
  return nodes.map((node) => {
    if (node.kind === 'text') return { kind: 'text', text: node.text };
    return {
      kind: 'element',
      tag: node.tag,
      attrs: Object.fromEntries(
        Object.entries(node.attrs).map(([key, value]) => [
          key,
          key === 'fill' || key === 'stroke' ? canonicalSvgPaint(value, `svg.${key}`) : value,
        ]),
      ),
      children: canonicalSvgNodes(node.children),
    };
  });
}

function canonicalSvgLayer(layer: SvgLayer): SvgLayer {
  return {
    ...canonicalBase(layer),
    type: 'svg',
    height: quantize(clamp(layer.height, 1, 10_000)),
    ...(layer.viewBox ? { viewBox: layer.viewBox } : {}),
    nodes: canonicalSvgNodes(layer.nodes),
  };
}

function canonicalLayer(layer: Layer): Layer {
  switch (layer.type) {
    case 'text':
      return canonicalTextLayer(layer);
    case 'shape':
      return canonicalShapeLayer(layer);
    case 'image':
      return canonicalImageLayer(layer);
    case 'svg':
      return canonicalSvgLayer(layer);
  }
}

/**
 * Returns a new canonical document. Canonicalization is the contract that makes
 * `parse(serialize(doc))` deterministic: colors, numbers, fonts, angles, and
 * defaults are normalized before serialization.
 */
export function canonicalizeDoc(doc: DesignDoc): DesignDoc {
  if (doc.schemaVersion !== DESIGN_DOC_VERSION) {
    throw new DesignError(
      'UNSUPPORTED_FEATURE',
      `Unsupported schema version: ${String(doc.schemaVersion)}`,
      'schemaVersion',
    );
  }
  if (doc.layers.length > LIMITS.document.maxLayers) {
    throw new DesignError('LIMIT_EXCEEDED', `Too many layers: ${doc.layers.length}`, 'layers');
  }
  const seen = new Set<string>();
  const layers = doc.layers.map((layer) => {
    const canonical = canonicalLayer(layer);
    if (seen.has(canonical.id)) {
      throw new DesignError('DUPLICATE_ID', `Duplicate layer id: ${canonical.id}`, 'layers');
    }
    seen.add(canonical.id);
    return canonical;
  });

  const width = quantize(doc.width);
  const height = quantize(doc.height);
  if (
    width < LIMITS.document.minArtboardSide ||
    height < LIMITS.document.minArtboardSide ||
    width > LIMITS.document.maxArtboardSide ||
    height > LIMITS.document.maxArtboardSide ||
    width * height > LIMITS.document.maxArtboardPixels
  ) {
    throw new DesignError(
      'LIMIT_EXCEEDED',
      'Artboard dimensions are outside the allowed range',
      'artboard',
    );
  }

  return {
    schemaVersion: DESIGN_DOC_VERSION,
    width,
    height,
    background: canonicalFill(doc.background, 'background'),
    layers,
  };
}
