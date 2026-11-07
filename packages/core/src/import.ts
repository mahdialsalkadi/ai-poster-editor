import * as csstree from 'css-tree';
import * as parse5 from 'parse5';
import { DesignError, LimitExceededError } from './errors.js';
import { LIMITS } from './limits.js';
import type { DesignDoc, Warning } from './model.js';
import { parsePx } from './numbers.js';
import { parseDesignHtml } from './parse.js';
import { pushWarning } from './warnings.js';

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  value?: string;
};

/** An image inlined by the HTML exporter, still to be stored by the caller. */
export type ImportedAsset = {
  /** Placeholder id used in the returned doc's `asset:` refs. */
  id: string;
  mimeType: string;
  base64: string;
};

export type ImportDesignOutput = {
  doc: DesignDoc;
  warnings: Warning[];
  assets: ImportedAsset[];
};

/**
 * The exporter's own properties plus the layer envelope. Everything else
 * (`display`, `white-space`, `direction`, …) is either re-derived by the parser
 * or intentionally dropped, and would only produce noise warnings.
 */
const STYLE_PROPERTIES = new Set([
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

const INLINE_STYLE_PROPERTIES = new Set(['font-weight', 'font-style', 'text-decoration', 'color']);
const INLINE_TAGS = new Set(['span', 'b', 'strong', 'i', 'em', 'u']);
const LAYER_TYPES = new Set(['text', 'shape', 'image', 'svg']);
const DATA_URI_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

/** An exported document inlines fonts and images, so it is far larger than Design HTML. */
const MAX_IMPORT_BYTES = LIMITS.export.maxRequestBytes;

function getAttr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((attr) => attr.name.toLowerCase() === name.toLowerCase())?.value;
}

function hasClass(node: HtmlNode, className: string): boolean {
  return (getAttr(node, 'class') ?? '').split(/\s+/).includes(className);
}

function isElement(node: HtmlNode): node is HtmlNode & { tagName: string } {
  return node.nodeName !== '#text' && node.nodeName !== '#comment' && Boolean(node.tagName);
}

function textOf(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(textOf).join('');
}

/** Text with line breaks as spaces, used for layer names. */
function readableText(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? '';
  if (isElement(node) && node.tagName.toLowerCase() === 'br') return ' ';
  return (node.childNodes ?? []).map(readableText).join('');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/** Reads a style attribute into a declaration map, ignoring anything unparsable. */
function declarationsOf(style: string | undefined): Map<string, string> {
  const declarations = new Map<string, string>();
  if (!style) return declarations;
  let ast: unknown;
  try {
    ast = csstree.parse(style, { context: 'declarationList', parseValue: true, positions: false });
  } catch {
    return declarations;
  }
  const list = ast as { children?: { forEach(callback: (node: csstree.CssNode) => void): void } };
  list.children?.forEach((node) => {
    if (node.type !== 'Declaration') return;
    declarations.set(node.property.toLowerCase(), csstree.generate(node.value).trim());
  });
  return declarations;
}

/** Keeps only the declarations the design parser understands. */
function cleanStyle(style: string | undefined, allowed: ReadonlySet<string>): string {
  const declarations = declarationsOf(style);
  const kept: string[] = [];
  for (const [property, value] of declarations) {
    if (allowed.has(property)) kept.push(`${property}:${value}`);
  }
  return kept.join(';');
}

function findArtboard(node: HtmlNode): HtmlNode | null {
  if (isElement(node) && hasClass(node, 'artboard')) return node;
  for (const child of node.childNodes ?? []) {
    const found = findArtboard(child);
    if (found) return found;
  }
  return null;
}

/**
 * Exported SVGs are already restricted to the parser's allow-list; the rebuilt
 * fragment is validated again by `parseDesignHtml`, so this only has to keep
 * the markup intact.
 */
function serializeSvgNode(node: HtmlNode): string {
  if (node.nodeName === '#text') return escapeText(node.value ?? '');
  if (!isElement(node)) return '';
  const tag = node.tagName;
  const attrs = (node.attrs ?? [])
    .map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`)
    .join('');
  const children = (node.childNodes ?? []).map(serializeSvgNode).join('');
  return `<${tag}${attrs}>${children}</${tag}>`;
}

function serializeInlineNode(node: HtmlNode, warnings: Warning[], layerPath: string): string {
  if (node.nodeName === '#text') return escapeText(node.value ?? '');
  if (!isElement(node)) return '';
  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '<br>';
  if (!INLINE_TAGS.has(tag)) {
    pushWarning(
      warnings,
      'UNKNOWN_TAG_DROPPED',
      `Inline tag is not supported: ${node.tagName}`,
      `${layerPath}.content`,
    );
    return (node.childNodes ?? [])
      .map((child) => serializeInlineNode(child, warnings, layerPath))
      .join('');
  }
  const style = cleanStyle(getAttr(node, 'style'), INLINE_STYLE_PROPERTIES);
  const children = (node.childNodes ?? [])
    .map((child) => serializeInlineNode(child, warnings, layerPath))
    .join('');
  return `<${tag}${style ? ` style="${escapeAttr(style)}"` : ''}>${children}</${tag}>`;
}

function hasInlineContent(node: HtmlNode): boolean {
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === '#text') {
      if ((child.value ?? '').trim()) return true;
      continue;
    }
    if (!isElement(child)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br' || INLINE_TAGS.has(tag)) return true;
    if (hasInlineContent(child)) return true;
  }
  return false;
}

function inferType(node: HtmlNode & { tagName: string }): 'text' | 'shape' | 'image' | 'svg' {
  const tag = node.tagName.toLowerCase();
  if (tag === 'img') return 'image';
  if (tag === 'svg') return 'svg';
  if (tag === 'div') return hasInlineContent(node) ? 'text' : 'shape';
  return 'shape';
}

function layerName(node: HtmlNode, fallback: string): string {
  const explicit = getAttr(node, 'data-layer')?.trim();
  if (explicit) return explicit;
  const alt = getAttr(node, 'alt')?.trim();
  if (alt) return alt;
  const text = readableText(node).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 32) : fallback;
}

function layerId(node: HtmlNode, index: number): string {
  const explicit = getAttr(node, 'data-id')?.trim();
  return explicit || `layer_${index + 1}`;
}

function envelope(node: HtmlNode, index: number, type: string): string {
  const id = layerId(node, index);
  const name = layerName(node, `Layer ${index + 1}`);
  const hidden = getAttr(node, 'data-hidden') === 'true' ? ' data-hidden="true"' : '';
  const locked = getAttr(node, 'data-locked') === 'true' ? ' data-locked="true"' : '';
  return ` data-id="${escapeAttr(id)}" data-layer="${escapeAttr(
    name,
  )}" data-type="${type}"${hidden}${locked}`;
}

function imageHtml(
  node: HtmlNode & { tagName: string },
  index: number,
  assets: ImportedAsset[],
): string {
  let src = (getAttr(node, 'src') ?? '').trim();
  const inlined = DATA_URI_RE.exec(src);
  if (inlined?.[1] && inlined[2]) {
    const id = `imported_${assets.length + 1}`;
    assets.push({
      id,
      mimeType: inlined[1].toLowerCase(),
      base64: inlined[2].replace(/\s+/g, ''),
    });
    src = `asset:${id}`;
  }

  const style = cleanStyle(getAttr(node, 'style'), STYLE_PROPERTIES);
  const alt = getAttr(node, 'alt');
  const prompt = getAttr(node, 'data-prompt');
  const attrs = [
    envelope(node, index, 'image'),
    ` src="${escapeAttr(src)}"`,
    alt ? ` alt="${escapeAttr(alt)}"` : '',
    prompt ? ` data-prompt="${escapeAttr(prompt)}"` : '',
    style ? ` style="${escapeAttr(style)}"` : '',
  ].join('');
  return `<img${attrs}>`;
}

function svgHtml(node: HtmlNode & { tagName: string }, index: number): string {
  const style = cleanStyle(getAttr(node, 'style'), STYLE_PROPERTIES);
  const viewBox = getAttr(node, 'viewBox');
  const children = (node.childNodes ?? []).map(serializeSvgNode).join('');
  const attrs = [
    envelope(node, index, 'svg'),
    viewBox ? ` viewBox="${escapeAttr(viewBox)}"` : '',
    style ? ` style="${escapeAttr(style)}"` : '',
  ].join('');
  return `<svg${attrs}>${children}</svg>`;
}

function textHtml(
  node: HtmlNode & { tagName: string },
  index: number,
  warnings: Warning[],
): string {
  const style = cleanStyle(getAttr(node, 'style'), STYLE_PROPERTIES);
  const dirRaw = getAttr(node, 'dir')?.trim().toLowerCase();
  const dir = dirRaw === 'rtl' || dirRaw === 'ltr' ? ` dir="${dirRaw}"` : '';
  const path = `layers[${index}]`;
  const children = (node.childNodes ?? [])
    .map((child) => serializeInlineNode(child, warnings, path))
    .join('');
  const attrs = [
    envelope(node, index, 'text'),
    dir,
    style ? ` style="${escapeAttr(style)}"` : '',
  ].join('');
  return `<div${attrs}>${children}</div>`;
}

function layerHtml(
  node: HtmlNode & { tagName: string },
  index: number,
  warnings: Warning[],
  assets: ImportedAsset[],
): string | null {
  const declared = getAttr(node, 'data-type')?.trim().toLowerCase();
  const type = declared && LAYER_TYPES.has(declared) ? declared : inferType(node);

  if (type === 'image') {
    if (node.tagName.toLowerCase() !== 'img') return null;
    return imageHtml(node, index, assets);
  }
  if (type === 'svg') {
    if (node.tagName.toLowerCase() !== 'svg') return null;
    return svgHtml(node, index);
  }
  if (node.tagName.toLowerCase() !== 'div') return null;
  if (type === 'shape') {
    const style = cleanStyle(getAttr(node, 'style'), STYLE_PROPERTIES);
    const attrs = [
      envelope(node, index, 'shape'),
      style ? ` style="${escapeAttr(style)}"` : '',
    ].join('');
    return `<div${attrs}></div>`;
  }
  return textHtml(node, index, warnings);
}

/**
 * The HTML export carries the artboard size and background in a `.artboard`
 * stylesheet rule rather than an inline style, so the wrapper's CSS is read
 * back here. Only that rule is consumed; the rest of the sheet is ignored.
 */
function artboardCssDeclarations(root: HtmlNode): Map<string, string> {
  const declarations = new Map<string, string>();

  const readStyleRules = (css: string): void => {
    let ast: unknown;
    try {
      ast = csstree.parse(css, { context: 'stylesheet' });
    } catch {
      return;
    }
    const walk = (children?: {
      forEach(callback: (node: csstree.CssNode) => void): void;
    }): void => {
      children?.forEach((node) => {
        if (node.type === 'Rule') {
          const selector = csstree.generate(node.prelude).trim();
          const matches = selector.split(',').some((part) => part.trim() === '.artboard');
          if (!matches) return;
          node.block.children.forEach((child) => {
            if (child.type !== 'Declaration') return;
            declarations.set(child.property.toLowerCase(), csstree.generate(child.value).trim());
          });
          return;
        }
        if ('children' in node && node.children) walk(node.children);
      });
    };
    walk((ast as { children?: Parameters<typeof walk>[0] }).children);
  };

  const visit = (node: HtmlNode): void => {
    if (isElement(node) && node.tagName.toLowerCase() === 'style') {
      readStyleRules(textOf(node));
      return;
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);

  return declarations;
}

function pxValue(raw: string | undefined, property: string): string {
  if (raw === undefined) {
    throw new DesignError(
      'INVALID_DOC',
      `The artboard requires ${property} in px`,
      `artboard.${property}`,
    );
  }
  const value = parsePx(raw);
  if (value === null) {
    throw new DesignError(
      'INVALID_DOC',
      `The artboard requires ${property} in px`,
      `artboard.${property}`,
    );
  }
  return `${value}px`;
}

/**
 * Turns an exported (or any full) HTML document back into a Design HTML
 * fragment and hands it to `parseDesignHtml`, mapping inlined images to
 * placeholder `asset:` ids for the caller to store.
 *
 * The document wrapper is discarded before validation, so `<head>` metadata
 * cannot block the import, while every layer still goes through the strict
 * parser (banned tags, event handlers, CSS guards, limits).
 */
export function importDesignDocument(input: string): ImportDesignOutput {
  const bytes = new TextEncoder().encode(input).length;
  if (bytes > MAX_IMPORT_BYTES) {
    throw new LimitExceededError(`Imported HTML exceeds ${MAX_IMPORT_BYTES} bytes`, 'document');
  }

  const document = parse5.parse(input) as unknown as HtmlNode;
  const artboard = findArtboard(document);
  if (!artboard) {
    throw new DesignError('INVALID_DOC', 'Design HTML must contain a .artboard root', 'document');
  }

  // Inline styles win over the exported `.artboard` rule.
  const artboardDeclarations = new Map([
    ...artboardCssDeclarations(document),
    ...declarationsOf(getAttr(artboard, 'style')),
  ]);
  const width = pxValue(
    getAttr(artboard, 'data-width') ?? artboardDeclarations.get('width'),
    'width',
  );
  const height = pxValue(
    getAttr(artboard, 'data-height') ?? artboardDeclarations.get('height'),
    'height',
  );
  const background =
    artboardDeclarations.get('background') ??
    artboardDeclarations.get('background-color') ??
    'transparent';

  const warnings: Warning[] = [];
  const assets: ImportedAsset[] = [];
  const layers: string[] = [];
  let index = 0;

  for (const child of artboard.childNodes ?? []) {
    if (!isElement(child)) {
      if (child.nodeName === '#text' && (child.value ?? '').trim()) {
        pushWarning(
          warnings,
          'UNKNOWN_TAG_DROPPED',
          'Text directly inside .artboard was ignored; use a text layer',
          'artboard',
        );
      }
      continue;
    }
    const html = layerHtml(child, index, warnings, assets);
    if (html === null) {
      pushWarning(
        warnings,
        'UNKNOWN_TAG_DROPPED',
        `Layer tag is not supported: ${child.tagName}`,
        `layers[${index}]`,
      );
      continue;
    }
    layers.push(html);
    index += 1;
  }

  const fragment =
    `<div class="artboard" data-width="${width}" data-height="${height}"` +
    ` style="${escapeAttr(`background:${background}`)}">\n${layers.join('\n')}\n</div>`;

  const parsed = parseDesignHtml(fragment);
  return { doc: parsed.doc, warnings: [...warnings, ...parsed.warnings], assets };
}
