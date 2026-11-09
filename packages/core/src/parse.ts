import * as parse5 from 'parse5';
import { normalizeColor } from './color.js';
import { containsForbiddenCss } from './css-guard.js';
import { DesignError, LimitExceededError, SecurityViolationError } from './errors.js';
import { containsArabic } from './fonts.js';
import { LIMITS } from './limits.js';
import {
  DESIGN_DOC_VERSION,
  type InlineNode,
  type Layer,
  type ParseOutput,
  type Warning,
} from './model.js';
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
import { canonicalInlineText } from './text.js';
import { pushWarning } from './warnings.js';

type HtmlAttr = { name: string; value: string };
type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: HtmlAttr[];
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
  'applet',
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

const TEXT_SEMANTIC_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'blockquote',
  'figcaption',
  'label',
  'a',
  'li',
  'small',
  'mark',
  'code',
  'pre',
]);

const ALLOWED_INLINE_TAGS = new Set([
  'span',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  'mark',
  'small',
  'code',
  'a',
  'label',
  'sub',
  'sup',
  'q',
  'cite',
  'time',
  'p',
  'div',
]);

const URL_ATTRS = new Set(['href', 'xlink:href', 'srcset', 'action', 'formaction', 'poster']);

const ASSET_SRC_RE = /^asset:[A-Za-z0-9_-]{1,64}$/;

function isElement(node: HtmlNode): node is HtmlNode & { tagName: string } {
  return typeof node.tagName === 'string';
}

function getAttr(node: HtmlNode, name: string): string | undefined {
  const lower = name.toLowerCase();
  return node.attrs?.find((attr) => attr.name.toLowerCase() === lower)?.value;
}

function hasClass(node: HtmlNode, className: string): boolean {
  const raw = getAttr(node, 'class');
  if (!raw) return false;
  return raw
    .trim()
    .split(/\s+/)
    .some((token) => token === className);
}

function textOf(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? '';
  if (!isElement(node)) return '';
  if (node.tagName.toLowerCase() === 'br') return '\n';
  return (node.childNodes ?? []).map(textOf).join('');
}

function walkSecurity(node: HtmlNode, path: string): void {
  if (isElement(node)) {
    const tag = node.tagName.toLowerCase();
    const curPath = `${path}.${tag}`;
    if (BANNED_TAGS.has(tag)) {
      throw new SecurityViolationError(`Forbidden HTML tag: ${node.tagName}`, curPath);
    }

    for (const attr of node.attrs ?? []) {
      const attrName = attr.name.toLowerCase();
      const attrVal = attr.value.trim();
      if (attrName.startsWith('on')) {
        throw new SecurityViolationError(`Forbidden event attribute: ${attr.name}`, curPath);
      }
      if (URL_ATTRS.has(attrName)) {
        throw new SecurityViolationError(`Forbidden URL attribute: ${attr.name}`, curPath);
      }
      if (attrName === 'src') {
        const trimmed = attrVal;
        if (!ASSET_SRC_RE.test(trimmed)) {
          throw new SecurityViolationError('Image src must use the asset: scheme', curPath);
        }
      }
      if (attrName === 'style' && containsForbiddenCss(attrVal)) {
        throw new SecurityViolationError('Forbidden CSS value in style attribute', curPath);
      }
    }

    for (const child of node.childNodes ?? []) {
      walkSecurity(child, curPath);
    }
    return;
  }

  for (const child of node.childNodes ?? []) {
    walkSecurity(child, path);
  }
}

function collectArtboards(node: HtmlNode, out: Array<HtmlNode & { tagName: string }>): void {
  if (isElement(node) && hasClass(node, 'artboard')) {
    out.push(node);
  }
  for (const child of node.childNodes ?? []) {
    collectArtboards(child, out);
  }
}

function findArtboard(root: HtmlNode): HtmlNode & { tagName: string } {
  const found: Array<HtmlNode & { tagName: string }> = [];
  collectArtboards(root, found);
  if (found.length === 0) {
    throw new DesignError('INVALID_DOC', 'Design HTML must contain a .artboard root', 'artboard');
  }
  if (found.length > 1) {
    throw new DesignError(
      'INVALID_DOC',
      'Design HTML must contain exactly one .artboard',
      'artboard',
    );
  }
  return found[0]!;
}

type InheritedInlineFormatting = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

function collectInlineNodes(
  parent: HtmlNode,
  ctx: StyleContext,
  inherited: InheritedInlineFormatting = {},
): InlineNode[] {
  const nodes: InlineNode[] = [];

  for (const child of parent.childNodes ?? []) {
    if (child.nodeName === '#text') {
      const rawText = child.value ?? '';
      if (!rawText) continue;
      if (inherited.bold || inherited.italic || inherited.underline || inherited.color) {
        nodes.push({
          kind: 'span',
          text: rawText,
          ...(inherited.bold ? { bold: true } : {}),
          ...(inherited.italic ? { italic: true } : {}),
          ...(inherited.underline ? { underline: true } : {}),
          ...(inherited.color ? { color: inherited.color } : {}),
        });
      } else {
        nodes.push({ kind: 'text', text: rawText });
      }
      continue;
    }

    if (!isElement(child)) continue;
    const tag = child.tagName.toLowerCase();

    if (tag === 'br') {
      nodes.push({ kind: 'br' });
      continue;
    }

    if (!ALLOWED_INLINE_TAGS.has(tag)) {
      pushWarning(
        ctx.warnings,
        'UNKNOWN_TAG_DROPPED',
        `Unsupported inline tag <${tag}> dropped`,
        ctx.path,
        ctx.layerId,
      );
      continue;
    }

    if ((tag === 'p' || tag === 'div') && nodes.length > 0) {
      const prev = nodes[nodes.length - 1];
      if (prev && prev.kind !== 'br') {
        nodes.push({ kind: 'br' });
      }
    }

    const nextInherited: InheritedInlineFormatting = { ...inherited };
    if (tag === 'b' || tag === 'strong' || tag === 'mark') nextInherited.bold = true;
    if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'q') nextInherited.italic = true;
    if (tag === 'u' || tag === 'ins') nextInherited.underline = true;

    const styleAttr = getAttr(child, 'style');
    if (styleAttr) {
      const spanDecls = parseDeclarations(styleAttr, ctx);
      const fw = spanDecls.get('font-weight')?.trim().toLowerCase();
      if (fw === 'bold' || fw === 'bolder' || (fw && Number.parseInt(fw, 10) >= 600)) {
        nextInherited.bold = true;
      }
      if (spanDecls.get('font-style')?.trim().toLowerCase() === 'italic') {
        nextInherited.italic = true;
      }
      const td = (spanDecls.get('text-decoration') ?? spanDecls.get('text-decoration-line') ?? '')
        .trim()
        .toLowerCase();
      if (td.includes('underline')) {
        nextInherited.underline = true;
      }
      const cRaw = spanDecls.get('color');
      if (cRaw !== undefined) {
        const norm = normalizeColor(cRaw);
        if (norm) {
          nextInherited.color = norm;
        } else {
          pushWarning(
            ctx.warnings,
            'UNSUPPORTED_VALUE',
            `Invalid span color: ${cRaw}`,
            ctx.path,
            ctx.layerId,
          );
        }
      }
    }

    const childNodes = collectInlineNodes(child, ctx, nextInherited);
    nodes.push(...childNodes);
  }

  return canonicalInlineText(nodes);
}

function inferLayerTypeFromElement(
  node: HtmlNode & { tagName: string },
): 'text' | 'shape' | 'image' | 'svg' {
  const explicit = getAttr(node, 'data-type')?.trim().toLowerCase();
  if (explicit === 'text' || explicit === 'shape' || explicit === 'image' || explicit === 'svg') {
    return explicit;
  }

  const tag = node.tagName.toLowerCase();
  if (tag === 'img') return 'image';
  if (tag === 'svg') return 'svg';
  if (tag === 'hr') return 'shape';
  if (TEXT_SEMANTIC_TAGS.has(tag)) return 'text';
  if (textOf(node).trim().length > 0) return 'text';
  return 'shape';
}

function parseLayer(
  node: HtmlNode & { tagName: string },
  index: number,
  rootDir: 'ltr' | 'rtl',
  usedIds: Set<string>,
  warnings: Warning[],
): Layer {
  const rawId = getAttr(node, 'data-id')?.trim() || getAttr(node, 'id')?.trim();
  const path = `artboard.layers[${index}]`;
  if (!rawId) {
    pushWarning(warnings, 'MISSING_ATTRIBUTE', 'Layer is missing data-id', path);
  }

  const id = (rawId || `layer-${index + 1}`).slice(0, LIMITS.document.maxLayerIdLength);
  if (usedIds.has(id)) {
    throw new DesignError('DUPLICATE_ID', `Duplicate layer id "${id}"`, path);
  }
  usedIds.add(id);

  const name =
    getAttr(node, 'data-layer')?.trim() ||
    getAttr(node, 'data-name')?.trim() ||
    `Layer ${index + 1}`;
  const hidden = getAttr(node, 'data-hidden') === 'true';
  const locked = getAttr(node, 'data-locked') === 'true';
  const type = inferLayerTypeFromElement(node);

  const plainText = type === 'text' ? textOf(node) : undefined;
  const explicitDirAttr = getAttr(node, 'dir')?.trim().toLowerCase();
  let dir: 'ltr' | 'rtl' =
    explicitDirAttr === 'rtl' || explicitDirAttr === 'ltr' ? explicitDirAttr : rootDir;

  const styleCtx: StyleContext = {
    warnings,
    path,
    layerId: id,
    dir,
    ...(plainText !== undefined ? { textContent: plainText } : {}),
  };

  const declarations = parseDeclarations(getAttr(node, 'style') ?? '', styleCtx);
  ensureNoUnknownCriticalProperties(declarations, styleCtx);
  assertAbsolutePosition(declarations, styleCtx);

  const cssDir = declarations.get('direction')?.trim().toLowerCase();
  if (!explicitDirAttr && (cssDir === 'rtl' || cssDir === 'ltr')) {
    dir = cssDir;
    styleCtx.dir = dir;
  }

  if (
    type === 'text' &&
    plainText &&
    containsArabic(plainText) &&
    dir !== 'rtl' &&
    !explicitDirAttr
  ) {
    dir = 'rtl';
    styleCtx.dir = 'rtl';
    pushWarning(
      warnings,
      'RTL_DIRECTION_INFERRED',
      'Inferred RTL direction from Arabic text content',
      path,
      id,
    );
  }

  const requireHeight = type !== 'text';
  const geom = parseCommonGeometry(declarations, styleCtx, requireHeight);

  const base = {
    id,
    name,
    left: geom.left ?? 0,
    top: geom.top ?? 0,
    width: geom.width!,
    rotation: geom.rotation ?? 0,
    opacity: geom.opacity ?? 1,
    hidden,
    locked,
  };

  if (type === 'text') {
    const content = collectInlineNodes(node, styleCtx);
    const totalChars = content.reduce(
      (sum, item) => sum + (item.kind === 'br' ? 1 : [...item.text].length),
      0,
    );
    if (totalChars > LIMITS.text.maxCodepointsPerLayer) {
      throw new LimitExceededError(
        `Text layer exceeds ${LIMITS.text.maxCodepointsPerLayer} codepoints`,
        path,
      );
    }
    if (content.length > LIMITS.text.maxInlineNodesPerLayer) {
      throw new LimitExceededError(
        `Text layer exceeds ${LIMITS.text.maxInlineNodesPerLayer} inline nodes`,
        path,
      );
    }
    const style = parseTextStyle(declarations, styleCtx);
    return {
      ...base,
      type: 'text',
      dir,
      content,
      style,
    };
  }

  if (type === 'shape') {
    const style = parseShapeStyle(declarations, styleCtx);
    return {
      ...base,
      type: 'shape',
      height: geom.height!,
      style,
    };
  }

  if (type === 'image') {
    const src = (getAttr(node, 'src') ?? '').trim();
    if (!src) {
      throw new DesignError('INVALID_DOC', 'Image layer requires a src attribute', path);
    }
    if (!ASSET_SRC_RE.test(src)) {
      throw new SecurityViolationError(
        `External or invalid image src "${src}" is not allowed; use asset:<id>`,
        path,
      );
    }
    const style = parseImageStyle(declarations, styleCtx);
    const prompt = getAttr(node, 'data-prompt')?.trim();
    const alt = getAttr(node, 'alt')?.trim();
    return {
      ...base,
      type: 'image',
      height: geom.height!,
      src,
      ...(prompt ? { prompt } : {}),
      ...(alt ? { alt } : {}),
      style,
    };
  }

  // SVG layer
  const svgCtx: SvgContext = {
    warnings,
    path,
    layerId: id,
  };
  const viewBoxRaw = getAttr(node, 'viewBox') ?? getAttr(node, 'viewbox');
  const parsedVb = parseViewBox(viewBoxRaw, svgCtx);
  const nodes = parseSvgNodes(
    {
      tagName: node.tagName,
      attrs: node.attrs ?? [],
      childNodes: node.childNodes ?? [],
    },
    svgCtx,
  );

  return {
    ...base,
    type: 'svg',
    height: geom.height!,
    ...(parsedVb ? { viewBox: parsedVb } : {}),
    nodes,
  };
}

export function parseDesignHtml(input: string): ParseOutput {
  const bytes = new TextEncoder().encode(input).byteLength;
  if (bytes > LIMITS.document.maxBytes) {
    throw new LimitExceededError(
      `Design HTML exceeds ${LIMITS.document.maxBytes} bytes`,
      'document',
      { bytes, maxBytes: LIMITS.document.maxBytes },
    );
  }

  const root = parse5.parse(input) as unknown as HtmlNode;
  walkSecurity(root, 'document');

  const artboard = findArtboard(root);
  const warnings: Warning[] = [];

  const rootDirAttr = getAttr(artboard, 'dir')?.trim().toLowerCase();
  const rootDir: 'ltr' | 'rtl' = rootDirAttr === 'rtl' ? 'rtl' : 'ltr';

  const artboardStyleCtx: StyleContext = {
    warnings,
    path: 'artboard',
    dir: rootDir,
  };
  const artboardDecls = parseDeclarations(getAttr(artboard, 'style') ?? '', artboardStyleCtx);

  const widthRaw = getAttr(artboard, 'data-width') ?? artboardDecls.get('width');
  const heightRaw = getAttr(artboard, 'data-height') ?? artboardDecls.get('height');
  const width = widthRaw ? parsePx(widthRaw) : null;
  const height = heightRaw ? parsePx(heightRaw) : null;

  if (width === null || height === null) {
    throw new DesignError(
      'INVALID_DOC',
      'Artboard must specify width and height in px',
      'artboard',
    );
  }

  if (
    width < LIMITS.document.minArtboardSide ||
    width > LIMITS.document.maxArtboardSide ||
    height < LIMITS.document.minArtboardSide ||
    height > LIMITS.document.maxArtboardSide ||
    width * height > LIMITS.document.maxArtboardPixels
  ) {
    throw new LimitExceededError(
      `Artboard dimensions ${width}x${height} are outside allowed bounds`,
      'artboard',
    );
  }

  const bgRaw = artboardDecls.get('background') ?? artboardDecls.get('background-color');
  const background = bgRaw
    ? parseFill(
        bgRaw,
        artboardStyleCtx,
        artboardDecls.has('background') ? 'background' : 'background-color',
      )
    : { kind: 'solid' as const, color: '#ffffff' };

  const elementChildren = (artboard.childNodes ?? []).filter(
    (child): child is HtmlNode & { tagName: string } => {
      if (child.nodeName === '#text') {
        if ((child.value ?? '').trim().length > 0) {
          pushWarning(
            warnings,
            'UNKNOWN_TAG_DROPPED',
            'Dropped bare text node inside .artboard',
            'artboard',
          );
        }
        return false;
      }
      return isElement(child);
    },
  );

  if (elementChildren.length > LIMITS.document.maxLayers) {
    throw new LimitExceededError(
      `Document exceeds maximum of ${LIMITS.document.maxLayers} layers`,
      'artboard',
    );
  }

  const usedIds = new Set<string>();
  const layers: Layer[] = [];
  for (let i = 0; i < elementChildren.length; i += 1) {
    layers.push(parseLayer(elementChildren[i]!, i, rootDir, usedIds, warnings));
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

export const parseDocument = parseDesignHtml;
