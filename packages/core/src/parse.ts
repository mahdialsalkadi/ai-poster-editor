import * as parse5 from 'parse5';
import { normalizeColor } from './color.js';
import { containsForbiddenCss } from './css-guard.js';
import { DesignError, LimitExceededError, SecurityViolationError } from './errors.js';
import { containsArabic } from './fonts.js';
import { LIMITS } from './limits.js';
import type { InlineNode, Layer, ParseOutput, SvgLayer, TextLayer, Warning } from './model.js';
import { DESIGN_DOC_VERSION } from './model.js';
import { parsePx, quantize } from './numbers.js';
import {
  assertAbsolutePosition,
  ensureNoUnknownCriticalProperties,
  parseCommonGeometry,
  parseDeclarations,
  parseFill,
  parseImageStyle,
  parseShapeStyle,
  parseTextStyle,
  type StyleContext,
} from './style.js';
import { parseSvgNodes, parseViewBox, type SvgContext } from './svg.js';
import { pushWarning } from './warnings.js';

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  value?: string;
};

const BANNED_TAGS = new Set([
  'script',
  'style',
  'link',
  'iframe',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'object',
  'embed',
  'meta',
  'base',
  'template',
  'video',
  'audio',
  'source',
  'track',
  'math',
  'foreignobject',
  'use',
  'image',
]);

const URL_ATTRS = new Set([
  'href',
  'xlink:href',
  'srcset',
  'action',
  'formaction',
  'poster',
]);

const ALLOWED_LAYER_DATA_ATTRS = new Set([
  'data-id',
  'data-layer',
  'data-type',
  'data-hidden',
  'data-locked',
  'data-prompt',
]);

const LAYER_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ASSET_SRC_RE = /^asset:[A-Za-z0-9_-]{1,64}$/;

function getAttr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((attr) => attr.name.toLowerCase() === name.toLowerCase())?.value;
}

function hasClass(node: HtmlNode, className: string): boolean {
  return (getAttr(node, 'class') ?? '').split(/\s+/).includes(className);
}

function textOf(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(textOf).join('');
}

function isElement(node: HtmlNode): node is HtmlNode & { tagName: string } {
  return node.nodeName !== '#text' && node.nodeName !== '#comment' && Boolean(node.tagName);
}

function walkSecurity(node: HtmlNode, path = 'html'): void {
  if (node.nodeName === '#comment') return;
  if (isElement(node)) {
    const tag = node.tagName.toLowerCase();
    if (BANNED_TAGS.has(tag)) {
      throw new SecurityViolationError(`Forbidden HTML tag: ${node.tagName}`, path);
    }
    for (const attr of node.attrs ?? []) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on')) {
        throw new SecurityViolationError(`Forbidden event attribute: ${attr.name}`, path);
      }
      if (URL_ATTRS.has(name)) {
        throw new SecurityViolationError(`Forbidden URL attribute: ${attr.name}`, path);
      }
      if (name === 'src') {
        const trimmed = value.trim();
        if (!ASSET_SRC_RE.test(trimmed)) {
          throw new SecurityViolationError('Image src must use the asset: scheme', path);
        }
      }
      if (name === 'style' && containsForbiddenCss(value)) {
        throw new SecurityViolationError('Forbidden CSS value in style attribute', path);
      }
    }
    for (const child of node.childNodes ?? []) walkSecurity(child, `${path}/${tag}`);
    return;
  }
  for (const child of node.childNodes ?? []) walkSecurity(child, path);
}

function findArtboard(node: HtmlNode): HtmlNode | null {
  if (isElement(node) && hasClass(node, 'artboard')) return node;
  for (const child of node.childNodes ?? []) {
    const found = findArtboard(child);
    if (found) return found;
  }
  return null;
}

function normalizeInlineText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t\n\f\r]+/g, ' ');
}

type SpanStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

function inlineStyleToSpan(node: HtmlNode): SpanStyle {
  const style = getAttr(node, 'style');
  if (!style) return {};
  const ctx: StyleContext = {
    warnings: [],
    path: 'inline',
    dir: 'ltr',
  };
  const declarations = parseDeclarations(style, ctx);
  const span: SpanStyle = {};
  const weight = declarations.get('font-weight')?.trim().toLowerCase();
  if (weight && (weight === 'bold' || Number.parseInt(weight, 10) >= 600)) {
    span.bold = true;
  }
  const fontStyle = declarations.get('font-style')?.trim().toLowerCase();
  if (fontStyle === 'italic') span.italic = true;
  const decoration = declarations.get('text-decoration')?.trim().toLowerCase();
  if (decoration === 'underline') span.underline = true;
  const color = declarations.get('color');
  if (color) {
    const normalized = normalizeColor(color);
    if (normalized) span.color = normalized;
  }
  return span;
}

function collectInlineNodes(
  nodes: readonly HtmlNode[],
  warnings: Warning[],
  layerId: string,
): InlineNode[] {
  const result: InlineNode[] = [];

  const pushText = (text: string): void => {
    if (!text) return;
    const normalized = normalizeInlineText(text);
    const last = result[result.length - 1];
    if (last?.kind === 'text') last.text += normalized;
    else result.push({ kind: 'text', text: normalized });
  };

  const visit = (node: HtmlNode, inherited?: SpanStyle): void => {
    if (node.nodeName === '#text') {
      const text = normalizeInlineText(node.value ?? '');
      if (inherited) {
        if (text) result.push({ kind: 'span', text, ...inherited });
      } else {
        pushText(text);
      }
      return;
    }
    if (node.nodeName === '#comment') return;
    if (!isElement(node)) return;
    const tag = node.tagName.toLowerCase();

    if (tag === 'br') {
      result.push({ kind: 'br' });
      return;
    }

    const nextInherited: SpanStyle | undefined =
      tag === 'b' || tag === 'strong'
        ? { ...inherited, bold: true }
        : tag === 'i' || tag === 'em'
          ? { ...inherited, italic: true }
          : tag === 'u'
            ? { ...inherited, underline: true }
            : tag === 'span'
              ? { ...inherited, ...inlineStyleToSpan(node) }
              : inherited;

    if (tag === 'span' || tag === 'b' || tag === 'strong' || tag === 'i' || tag === 'em' || tag === 'u') {
      for (const child of node.childNodes ?? []) visit(child, nextInherited);
      return;
    }

    if (tag === 'p' || tag === 'div') {
      if (result.length > 0 && result[result.length - 1]?.kind !== 'br') result.push({ kind: 'br' });
      for (const child of node.childNodes ?? []) visit(child);
      return;
    }

    pushWarning(
      warnings,
      'UNKNOWN_TAG_DROPPED',
      `Inline tag is not supported: ${node.tagName}`,
      `layers.${layerId}.content`,
      layerId,
    );
    for (const child of node.childNodes ?? []) visit(child, inherited);
  };

  for (const node of nodes) visit(node);

  const cleaned: InlineNode[] = [];
  for (const node of result) {
    if (node.kind === 'text') {
      if (!node.text) continue;
      const last = cleaned[cleaned.length - 1];
      if (last?.kind === 'text') last.text += node.text;
      else cleaned.push(node);
    } else if (node.kind === 'span') {
      if (!node.text) continue;
      const last = cleaned[cleaned.length - 1];
      if (last?.kind === 'span' && JSON.stringify(last) === JSON.stringify(node)) {
        last.text += node.text;
      } else {
        cleaned.push(node);
      }
    } else {
      if (cleaned.length === 0 || cleaned[cleaned.length - 1]?.kind === 'br') continue;
      cleaned.push(node);
    }
  }

  if (cleaned[0]?.kind === 'text') cleaned[0].text = cleaned[0].text.replace(/^ +/, '');
  const last = cleaned[cleaned.length - 1];
  if (last?.kind === 'text') last.text = last.text.replace(/ +$/, '');
  return cleaned;
}

function parseLayer(
  element: HtmlNode & { tagName: string },
  index: number,
  warnings: Warning[],
): Layer {
  const type = getAttr(element, 'data-type')?.trim().toLowerCase();
  if (type !== 'text' && type !== 'shape' && type !== 'image' && type !== 'svg') {
    throw new DesignError(
      'INVALID_DOC',
      `Layer ${index + 1} has an invalid or missing data-type`,
      `layers[${index}]`,
    );
  }

  const id = getAttr(element, 'data-id')?.trim();
  if (!id) {
    throw new DesignError('INVALID_DOC', `Layer ${index + 1} is missing data-id`, `layers[${index}]`);
  }
  if (!LAYER_ID_RE.test(id) || id.length > LIMITS.document.maxLayerIdLength) {
    throw new DesignError('INVALID_DOC', `Invalid layer id: ${id}`, `layers[${index}].id`);
  }

  const nameRaw = getAttr(element, 'data-layer')?.trim();
  const name = (nameRaw || `Layer ${index + 1}`).slice(0, LIMITS.document.maxLayerNameLength);
  if (!nameRaw) {
    pushWarning(
      warnings,
      'MISSING_ATTRIBUTE',
      'data-layer is missing; a default name was used',
      `layers[${index}].name`,
      id,
    );
  }

  for (const attr of element.attrs ?? []) {
    if (attr.name.toLowerCase().startsWith('data-') && !ALLOWED_LAYER_DATA_ATTRS.has(attr.name.toLowerCase())) {
      pushWarning(
        warnings,
        'UNSUPPORTED_PROPERTY',
        `Unknown data attribute dropped: ${attr.name}`,
        `layers[${index}].${attr.name}`,
        id,
      );
    }
  }

  const styleRaw = getAttr(element, 'style') ?? '';
  const dirRaw = getAttr(element, 'dir')?.trim().toLowerCase();
  const textContent = type === 'text' ? textOf(element) : '';
  const dir: 'ltr' | 'rtl' =
    dirRaw === 'rtl' || dirRaw === 'ltr'
      ? dirRaw
      : containsArabic(textContent)
        ? 'rtl'
        : 'ltr';
  if (type === 'text' && dirRaw !== 'rtl' && dirRaw !== 'ltr' && dir === 'rtl') {
    pushWarning(
      warnings,
      'RTL_DIRECTION_INFERRED',
      'Arabic text was detected; dir="rtl" was inferred',
      `layers[${index}].dir`,
      id,
    );
  }

  const ctx: StyleContext = {
    warnings,
    path: `layers[${index}].style`,
    layerId: id,
    dir,
    textContent,
  };
  const declarations = parseDeclarations(styleRaw, ctx);
  assertAbsolutePosition(declarations, ctx);
  ensureNoUnknownCriticalProperties(declarations, ctx);
  const geometry = parseCommonGeometry(declarations, ctx, type !== 'text');

  const left = geometry.left;
  const top = geometry.top;
  const width = geometry.width;
  if (left === undefined || top === undefined || width === undefined) {
    throw new DesignError(
      'INVALID_DOC',
      `Layer ${id} requires left, top, and width in px`,
      `layers[${index}]`,
    );
  }

  const base = {
    id,
    name,
    left,
    top,
    width,
    rotation: geometry.rotation ?? 0,
    opacity: geometry.opacity ?? 1,
    hidden: getAttr(element, 'data-hidden') === 'true',
    locked: getAttr(element, 'data-locked') === 'true',
  };

  if (type === 'text') {
    const content = collectInlineNodes(element.childNodes ?? [], warnings, id);
    const codepoints = content.reduce(
      (total, node) => total + (node.kind === 'br' ? 0 : [...node.text].length),
      0,
    );
    if (codepoints > LIMITS.text.maxCodepointsPerLayer) {
      throw new LimitExceededError(
        `Text layer ${id} exceeds ${LIMITS.text.maxCodepointsPerLayer} codepoints`,
        `layers[${index}].content`,
      );
    }
    if (content.length > LIMITS.text.maxInlineNodesPerLayer) {
      throw new LimitExceededError(
        `Text layer ${id} exceeds ${LIMITS.text.maxInlineNodesPerLayer} inline nodes`,
        `layers[${index}].content`,
      );
    }
    const textLayer: TextLayer = {
      ...base,
      type: 'text',
      dir,
      content,
      style: parseTextStyle(declarations, ctx),
    };
    return textLayer;
  }

  const height = geometry.height;
  if (height === undefined) {
    throw new DesignError(
      'INVALID_DOC',
      `Layer ${id} requires height in px`,
      `layers[${index}].height`,
    );
  }

  if (type === 'shape') {
    return {
      ...base,
      type: 'shape',
      height,
      style: parseShapeStyle(declarations, ctx),
    };
  }

  if (type === 'image') {
    const src = getAttr(element, 'src')?.trim();
    if (!src || !ASSET_SRC_RE.test(src)) {
      throw new SecurityViolationError(
        'Image layers require an asset: src',
        `layers[${index}].src`,
      );
    }
    const prompt = getAttr(element, 'data-prompt');
    const alt = getAttr(element, 'alt');
    return {
      ...base,
      type: 'image',
      height,
      src,
      ...(prompt ? { prompt } : {}),
      ...(alt ? { alt } : {}),
      style: parseImageStyle(declarations, ctx),
    };
  }

  const svgCtx: SvgContext = { warnings, path: `layers[${index}].svg`, layerId: id };
  const viewBox = parseViewBox(getAttr(element, 'viewBox'), svgCtx);
  const svgLayer: SvgLayer = {
    ...base,
    type: 'svg',
    height,
    ...(viewBox ? { viewBox } : {}),
    nodes: parseSvgNodes(
      {
        tagName: element.tagName,
        attrs: element.attrs ?? [],
        childNodes: element.childNodes ?? [],
      },
      svgCtx,
    ),
  };
  return svgLayer;
}

export function parseDesignHtml(input: string): ParseOutput {
  const bytes = new TextEncoder().encode(input).length;
  if (bytes > LIMITS.document.maxBytes) {
    throw new LimitExceededError(
      `Design HTML exceeds ${LIMITS.document.maxBytes} bytes`,
      'document',
    );
  }

  const document = parse5.parse(input) as unknown as HtmlNode;
  walkSecurity(document);

  const artboard = findArtboard(document);
  if (!artboard) {
    throw new DesignError('INVALID_DOC', 'Design HTML must contain a .artboard root', 'document');
  }

  const widthRaw = getAttr(artboard, 'data-width');
  const heightRaw = getAttr(artboard, 'data-height');
  const width = widthRaw ? parsePx(widthRaw) : null;
  const height = heightRaw ? parsePx(heightRaw) : null;
  if (width === null || height === null) {
    throw new DesignError(
      'INVALID_DOC',
      'The artboard requires data-width and data-height in px',
      'artboard',
    );
  }
  if (
    width < LIMITS.document.minArtboardSide ||
    height < LIMITS.document.minArtboardSide ||
    width > LIMITS.document.maxArtboardSide ||
    height > LIMITS.document.maxArtboardSide ||
    width * height > LIMITS.document.maxArtboardPixels
  ) {
    throw new LimitExceededError('Artboard dimensions are outside the allowed range', 'artboard');
  }

  const warnings: Warning[] = [];
  const artboardCtx: StyleContext = {
    warnings,
    path: 'artboard.style',
    dir: 'ltr',
  };
  const artboardDeclarations = parseDeclarations(getAttr(artboard, 'style') ?? '', artboardCtx);
  for (const property of artboardDeclarations.keys()) {
    if (property !== 'background' && property !== 'background-color') {
      pushWarning(
        warnings,
        'UNSUPPORTED_PROPERTY',
        `Artboard style only supports background; dropped ${property}`,
        `artboard.style.${property}`,
      );
    }
  }
  const background = parseFill(
    artboardDeclarations.get('background') ??
      artboardDeclarations.get('background-color') ??
      'transparent',
    artboardCtx,
    'background',
  );

  const layers: Layer[] = [];
  const seenIds = new Set<string>();
  for (const child of artboard.childNodes ?? []) {
    if (child.nodeName === '#text') {
      if ((child.value ?? '').trim()) {
        pushWarning(
          warnings,
          'UNKNOWN_TAG_DROPPED',
          'Text directly inside .artboard was ignored; use a text layer',
          'artboard',
        );
      }
      continue;
    }
    if (child.nodeName === '#comment') continue;
    if (!isElement(child)) continue;

    if (layers.length >= LIMITS.document.maxLayers) {
      throw new LimitExceededError(
        `Design exceeds ${LIMITS.document.maxLayers} layers`,
        'artboard.layers',
      );
    }

    const layer = parseLayer(child, layers.length, warnings);
    if (seenIds.has(layer.id)) {
      throw new DesignError('DUPLICATE_ID', `Duplicate layer id: ${layer.id}`, `layers.${layer.id}`);
    }
    seenIds.add(layer.id);
    layers.push(layer);
  }

  return {
    doc: {
      schemaVersion: DESIGN_DOC_VERSION,
      width: quantize(width),
      height: quantize(height),
      background,
      layers,
    },
    warnings,
  };
}
