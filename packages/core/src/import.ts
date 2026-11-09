import * as csstree from 'css-tree';
import * as parse5 from 'parse5';
import { normalizeColor } from './color.js';
import { DesignError, LimitExceededError } from './errors.js';
import { containsArabic, fallbackFont, findAllowedFont } from './fonts.js';
import { LIMITS } from './limits.js';
import type { DesignDoc, Fill, Warning } from './model.js';
import { clamp, clampQuantized, normalizeAngle, parsePx, quantize } from './numbers.js';
import { parseDesignHtml } from './parse.js';
import { parseFill, splitTopLevel } from './style.js';
import { ALLOWED_SVG_TAGS } from './svg.js';
import { pushWarning } from './warnings.js';

type HtmlAttr = { name: string; value: string };
type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: HtmlAttr[];
  childNodes?: HtmlNode[];
  value?: string;
  parentNode?: HtmlNode;
};

export type ImportedAsset = {
  id: string;
  mimeType: string;
  base64: string;
};

export type ImportDesignOutput = {
  doc: DesignDoc;
  warnings: Warning[];
  assets: ImportedAsset[];
};

export type ImportDesignOptions = {
  /**
   * When true, enforces legacy strict checks (requires explicit `.artboard` class
   * and `px`-only artboard dimensions). Defaults to `false` (expanded HTML support).
   */
  strict?: boolean;
  defaultWidth?: number;
  defaultHeight?: number;
};

const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

const DATA_URI_RE =
  /^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/i;
const CSS_URL_DATA_RE =
  /url\(\s*['"]?(data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]+))['"]?\s*\)/i;
const CSS_URL_ASSET_RE = /url\(\s*['"]?(asset:[A-Za-z0-9_-]+)['"]?\s*\)/i;

const ALLOWED_SVG_TAG_SET = new Set<string>(ALLOWED_SVG_TAGS);
const SVG_TAG_CASE_MAP: Readonly<Record<string, string>> = {
  svg: 'svg',
  g: 'g',
  defs: 'defs',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  stop: 'stop',
  path: 'path',
  rect: 'rect',
  circle: 'circle',
  ellipse: 'ellipse',
  line: 'line',
  polyline: 'polyline',
  polygon: 'polygon',
  title: 'title',
  desc: 'desc',
};

const SVG_ATTR_CASE_MAP: Readonly<Record<string, string>> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  spreadmethod: 'spreadMethod',
  xlinkhref: ' href',
};

const IGNORED_HEAD_OR_SCRIPT_TAGS = new Set([
  'head',
  'meta',
  'title',
  'link',
  'style',
  'script',
  'noscript',
  'template',
  'base',
  'iframe',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'textarea',
  'select',
  'option',
  'audio',
  'video',
  'source',
  'track',
]);

const INLINE_TEXT_TAGS = new Set([
  'span',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  'mark',
  'small',
  'sub',
  'sup',
  's',
  'del',
  'code',
  'kbd',
  'samp',
  'var',
  'a',
  'abbr',
  'cite',
  'q',
  'time',
  'font',
  'label',
  'br',
]);

const HEADING_DEFAULTS: Readonly<Record<string, { fontSize: number; fontWeight: number }>> = {
  h1: { fontSize: 56, fontWeight: 700 },
  h2: { fontSize: 42, fontWeight: 700 },
  h3: { fontSize: 32, fontWeight: 700 },
  h4: { fontSize: 24, fontWeight: 600 },
  h5: { fontSize: 20, fontWeight: 600 },
  h6: { fontSize: 16, fontWeight: 600 },
  p: { fontSize: 20, fontWeight: 400 },
  blockquote: { fontSize: 24, fontWeight: 500 },
  figcaption: { fontSize: 16, fontWeight: 400 },
  li: { fontSize: 20, fontWeight: 400 },
  button: { fontSize: 20, fontWeight: 700 },
  a: { fontSize: 20, fontWeight: 600 },
  small: { fontSize: 14, fontWeight: 400 },
  code: { fontSize: 16, fontWeight: 500 },
  pre: { fontSize: 16, fontWeight: 400 },
  label: { fontSize: 16, fontWeight: 600 },
  th: { fontSize: 18, fontWeight: 700 },
  td: { fontSize: 16, fontWeight: 400 },
};

const ARTBOARD_CLASS_CANDIDATES = [
  'artboard',
  'poster',
  'canvas',
  'banner',
  'flyer',
  'card',
  'slide',
  'post',
  'frame',
  'stage',
  'design',
  'board',
  'poster-container',
  'poster-canvas',
];

const ARTBOARD_ID_CANDIDATES = [
  'artboard',
  'poster',
  'canvas',
  'banner',
  'flyer',
  'card',
  'slide',
  'stage',
  'design',
];

const INHERITED_TEXT_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'color',
  'text-align',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-shadow',
  'direction',
] as const;

type CssRuleEntry = {
  selector: string;
  specificity: number;
  order: number;
  declarations: Map<string, string>;
};

type BoxBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TraversalContext = {
  artboardWidth: number;
  artboardHeight: number;
  parentBox: BoxBox;
  inheritedStyles: Map<string, string>;
  dir: 'ltr' | 'rtl';
  opacity: number;
  rotation: number;
  cssRules: CssRuleEntry[];
  cssVariables: Map<string, string>;
  warnings: Warning[];
  assets: ImportedAsset[];
  usedIds: Set<string>;
  layerCounter: { value: number };
};

function isElement(node: HtmlNode): node is HtmlNode & { tagName: string } {
  return typeof node.tagName === 'string';
}

function getAttr(node: HtmlNode, name: string): string | undefined {
  const lower = name.toLowerCase();
  return node.attrs?.find((attr) => attr.name.toLowerCase() === lower)?.value;
}

function getClasses(node: HtmlNode): string[] {
  const cls = getAttr(node, 'class');
  if (!cls) return [];
  return cls.trim().split(/\s+/).filter(Boolean);
}

function hasClass(node: HtmlNode, className: string): boolean {
  const target = className.toLowerCase();
  return getClasses(node).some((c) => c.toLowerCase() === target);
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function textOf(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? '';
  if (!isElement(node)) return '';
  if (node.tagName.toLowerCase() === 'br') return '\n';
  return (node.childNodes ?? []).map(textOf).join('');
}

function readableText(node: HtmlNode): string {
  return textOf(node).replace(/\s+/g, ' ').trim();
}

function attachParents(node: HtmlNode, parent?: HtmlNode): void {
  if (parent) node.parentNode = parent;
  for (const child of node.childNodes ?? []) {
    attachParents(child, node);
  }
}

function resolveCssVariables(value: string, vars: ReadonlyMap<string, string>, depth = 0): string {
  if (depth > 8 || !value.includes('var(')) return value;
  return value.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]+))?\)/g, (_match, name, fb) => {
    const found = vars.get(name.trim());
    if (found !== undefined) {
      return resolveCssVariables(found, vars, depth + 1);
    }
    if (fb !== undefined) {
      return resolveCssVariables(fb.trim(), vars, depth + 1);
    }
    return '';
  });
}

function declarationsOf(
  style: string | undefined,
  vars?: ReadonlyMap<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!style || !style.trim()) return map;
  try {
    const ast = csstree.parse(style, { context: 'declarationList', parseValue: false });
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        const prop = node.property.trim().toLowerCase();
        let val = csstree.generate(node.value).trim();
        val = val.replace(/\s*!important\s*$/i, '').trim();
        if (vars && val.includes('var(')) {
          val = resolveCssVariables(val, vars);
        }
        map.set(prop, val);
      }
    });
  } catch {
    for (const part of splitTopLevel(style, ';')) {
      const idx = part.indexOf(':');
      if (idx <= 0) continue;
      const prop = part.slice(0, idx).trim().toLowerCase();
      let val = part.slice(idx + 1).trim();
      val = val.replace(/\s*!important\s*$/i, '').trim();
      if (vars && val.includes('var(')) {
        val = resolveCssVariables(val, vars);
      }
      if (prop && val) map.set(prop, val);
    }
  }
  return map;
}

function extractStylesheetRules(root: HtmlNode): {
  rules: CssRuleEntry[];
  vars: Map<string, string>;
} {
  const styleBlocks: string[] = [];
  const walk = (node: HtmlNode): void => {
    if (isElement(node) && node.tagName.toLowerCase() === 'style') {
      styleBlocks.push(textOf(node));
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);

  const vars = new Map<string, string>();
  const rawRules: Array<{ selector: string; decls: Map<string, string>; order: number }> = [];
  let order = 0;

  for (const cssText of styleBlocks) {
    try {
      const ast = csstree.parse(cssText, { parseValue: false });
      csstree.walk(ast, (node) => {
        if (node.type === 'Rule' && node.prelude && node.block) {
          const preludeRaw = csstree.generate(node.prelude).trim();
          const decls = new Map<string, string>();
          csstree.walk(node.block, (child) => {
            if (child.type === 'Declaration') {
              const prop = child.property.trim().toLowerCase();
              const val = csstree
                .generate(child.value)
                .trim()
                .replace(/\s*!important\s*$/i, '')
                .trim();
              if (prop.startsWith('--')) {
                vars.set(prop, val);
              } else {
                decls.set(prop, val);
              }
            }
          });
          for (const sel of splitTopLevel(preludeRaw, ',')) {
            if (sel) {
              rawRules.push({ selector: sel.trim(), decls, order: order++ });
            }
          }
        }
      });
    } catch {
      // Ignore malformed CSS blocks
    }
  }

  // Also collect inline CSS custom properties on root/body/artboard
  const collectInlineVars = (node: HtmlNode): void => {
    if (isElement(node)) {
      const styleAttr = getAttr(node, 'style');
      if (styleAttr && styleAttr.includes('--')) {
        const d = declarationsOf(styleAttr);
        for (const [k, v] of d) {
          if (k.startsWith('--')) vars.set(k, v);
        }
      }
    }
    for (const child of node.childNodes ?? []) collectInlineVars(child);
  };
  collectInlineVars(root);

  const rules: CssRuleEntry[] = rawRules.map((r) => {
    const resolved = new Map<string, string>();
    for (const [k, v] of r.decls) {
      resolved.set(k, resolveCssVariables(v, vars));
    }
    return {
      selector: r.selector,
      specificity: computeSpecificity(r.selector),
      order: r.order,
      declarations: resolved,
    };
  });

  return { rules, vars };
}

function computeSpecificity(selector: string): number {
  const cleaned = selector.replace(/:not\(([^)]*)\)/g, ' $1 ').replace(/::?[a-zA-Z-]+/g, '');
  const ids = (cleaned.match(/#[a-zA-Z0-9_-]+/g) ?? []).length;
  const classes = (cleaned.match(/\.[a-zA-Z0-9_-]+/g) ?? []).length;
  const attrs = (cleaned.match(/\[[^\]]+\]/g) ?? []).length;
  const tags = (
    cleaned
      .replace(/#[a-zA-Z0-9_-]+/g, ' ')
      .replace(/\.[a-zA-Z0-9_-]+/g, ' ')
      .replace(/\[[^\]]+\]/g, ' ')
      .match(/\b[a-zA-Z][a-zA-Z0-9-]*/g) ?? []
  ).length;
  return ids * 10000 + (classes + attrs) * 100 + tags;
}

function matchesSimpleSelector(node: HtmlNode & { tagName: string }, simple: string): boolean {
  const trimmed = simple.trim();
  if (!trimmed) return false;
  if (trimmed === '*') return true;

  // Strip pseudo-classes like :first-child / :nth-child / :root
  if (trimmed === ':root') return node.tagName.toLowerCase() === 'html';
  const baseSelector = trimmed.replace(/::?[a-zA-Z-]+(?:\([^)]*\))?/g, '').trim();
  if (!baseSelector) return false;

  // Tag name at start
  const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(baseSelector);
  if (tagMatch) {
    if (node.tagName.toLowerCase() !== tagMatch[0]!.toLowerCase()) return false;
  }

  // ID matches
  const idMatches = baseSelector.match(/#([a-zA-Z0-9_-]+)/g);
  if (idMatches) {
    const nodeId = getAttr(node, 'id') ?? '';
    for (const rawId of idMatches) {
      if (nodeId !== rawId.slice(1)) return false;
    }
  }

  // Class matches
  const classMatches = baseSelector.match(/\.([a-zA-Z0-9_-]+)/g);
  if (classMatches) {
    for (const rawCls of classMatches) {
      if (!hasClass(node, rawCls.slice(1))) return false;
    }
  }

  // Attribute matches [attr] or [attr="val"]
  const attrRe = /\[([a-zA-Z0-9_-]+)(?:([~|^$*]?=)['"]?([^'"\]]*)['"]?)?\]/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRe.exec(baseSelector)) !== null) {
    const attrName = attrMatch[1]!;
    const op = attrMatch[2];
    const expected = attrMatch[3] ?? '';
    const actual = getAttr(node, attrName);
    if (actual === undefined) return false;
    if (op === '=' && actual !== expected) return false;
    if (op === '^=' && !actual.startsWith(expected)) return false;
    if (op === '$=' && !actual.endsWith(expected)) return false;
    if (op === '*=' && !actual.includes(expected)) return false;
    if (op === '~=' && !actual.split(/\s+/).includes(expected)) return false;
  }

  return true;
}

function matchesSelector(node: HtmlNode & { tagName: string }, selector: string): boolean {
  // Normalize child combinator `>` with spaces around it
  const tokens = selector
    .replace(/\s*>\s*/g, ' > ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;

  let current: HtmlNode | undefined = node;
  let i = tokens.length - 1;

  if (!matchesSimpleSelector(node, tokens[i]!)) return false;
  i -= 1;

  while (i >= 0) {
    const tok = tokens[i]!;
    if (tok === '>') {
      i -= 1;
      if (i < 0) return false;
      const parent: HtmlNode | undefined = current?.parentNode;
      if (!parent || !isElement(parent) || !matchesSimpleSelector(parent, tokens[i]!)) {
        return false;
      }
      current = parent;
      i -= 1;
    } else {
      let ancestor: HtmlNode | undefined = current?.parentNode;
      let found = false;
      while (ancestor) {
        if (isElement(ancestor) && matchesSimpleSelector(ancestor, tok)) {
          found = true;
          current = ancestor;
          break;
        }
        ancestor = ancestor.parentNode;
      }
      if (!found) return false;
      i -= 1;
    }
  }

  return true;
}

function computeMergedStyles(
  node: HtmlNode & { tagName: string },
  rules: CssRuleEntry[],
  vars: ReadonlyMap<string, string>,
  inherited?: ReadonlyMap<string, string>,
): Map<string, string> {
  const merged = new Map<string, string>();

  if (inherited) {
    for (const prop of INHERITED_TEXT_PROPS) {
      const val = inherited.get(prop);
      if (val !== undefined) merged.set(prop, val);
    }
  }

  // Apply tag-level typography defaults if not inherited
  const tag = node.tagName.toLowerCase();
  const tagDef = HEADING_DEFAULTS[tag];
  if (tagDef) {
    merged.set('font-size', `${tagDef.fontSize}px`);
    merged.set('font-weight', `${tagDef.fontWeight}`);
  }
  if (tag === 'blockquote') {
    merged.set('font-style', 'italic');
  }
  if (
    tag === 'button' ||
    (tag === 'a' && (hasClass(node, 'btn') || hasClass(node, 'button') || hasClass(node, 'cta')))
  ) {
    if (!merged.has('text-align')) merged.set('text-align', 'center');
  }

  const matched = rules
    .filter((r) => matchesSelector(node, r.selector))
    .sort((a, b) =>
      a.specificity !== b.specificity ? a.specificity - b.specificity : a.order - b.order,
    );

  for (const rule of matched) {
    for (const [k, v] of rule.declarations) {
      merged.set(k, v);
    }
  }

  const inlineMap = declarationsOf(getAttr(node, 'style'), vars);
  for (const [k, v] of inlineMap) {
    if (!k.startsWith('--')) {
      merged.set(k, v);
    }
  }

  // HTML attributes fallback (width, height, bgcolor, color, align)
  const attrColor = getAttr(node, 'color');
  if (attrColor && !merged.has('color')) merged.set('color', attrColor);
  const attrBg = getAttr(node, 'bgcolor');
  if (attrBg && !merged.has('background') && !merged.has('background-color')) {
    merged.set('background-color', attrBg);
  }
  const attrAlign = getAttr(node, 'align');
  if (attrAlign && !merged.has('text-align')) merged.set('text-align', attrAlign);

  return merged;
}

function findExplicitArtboard(node: HtmlNode): (HtmlNode & { tagName: string }) | null {
  if (isElement(node)) {
    if (
      hasClass(node, 'artboard') ||
      getAttr(node, 'data-artboard') !== undefined ||
      getAttr(node, 'id')?.toLowerCase() === 'artboard'
    ) {
      return node;
    }
  }
  for (const child of node.childNodes ?? []) {
    const found = findExplicitArtboard(child);
    if (found) return found;
  }
  return null;
}

function findFlexibleArtboard(
  root: HtmlNode,
  rules: CssRuleEntry[],
  vars: ReadonlyMap<string, string>,
): (HtmlNode & { tagName: string }) | null {
  // 1. Explicit .artboard / #artboard / [data-artboard]
  const explicit = findExplicitArtboard(root);
  if (explicit) return explicit;

  // 2. Common poster container classes or IDs
  const findByCandidate = (node: HtmlNode): (HtmlNode & { tagName: string }) | null => {
    if (isElement(node)) {
      const id = getAttr(node, 'id')?.toLowerCase() ?? '';
      if (ARTBOARD_ID_CANDIDATES.includes(id)) return node;
      for (const cls of ARTBOARD_CLASS_CANDIDATES) {
        if (hasClass(node, cls)) return node;
      }
    }
    for (const child of node.childNodes ?? []) {
      const found = findByCandidate(child);
      if (found) return found;
    }
    return null;
  };
  const byCandidate = findByCandidate(root);
  if (byCandidate) return byCandidate;

  // 3. Find <body>
  const findTag = (node: HtmlNode, targetTag: string): (HtmlNode & { tagName: string }) | null => {
    if (isElement(node) && node.tagName.toLowerCase() === targetTag) return node;
    for (const child of node.childNodes ?? []) {
      const found = findTag(child, targetTag);
      if (found) return found;
    }
    return null;
  };

  const body = findTag(root, 'body');
  if (body) {
    const elementChildren = (body.childNodes ?? []).filter(
      (c): c is HtmlNode & { tagName: string } =>
        isElement(c) && !IGNORED_HEAD_OR_SCRIPT_TAGS.has(c.tagName.toLowerCase()),
    );

    // If body has a single container element (like <main>, <article>, <section>, or a wrapper <div>)
    if (elementChildren.length === 1) {
      const only = elementChildren[0]!;
      const onlyTag = only.tagName.toLowerCase();
      const onlyStyles = computeMergedStyles(only, rules, vars);
      const hasNestedElements = (only.childNodes ?? []).some((c) => isElement(c));
      if (
        onlyTag === 'main' ||
        onlyTag === 'article' ||
        onlyTag === 'section' ||
        (onlyTag === 'div' &&
          (hasNestedElements || onlyStyles.has('width') || onlyStyles.has('height')))
      ) {
        return only;
      }
    }

    // If body itself has visible children, check if body is a design container
    if (elementChildren.length > 0) {
      return body;
    }
  }

  return null;
}

function resolveLengthToPx(
  raw: string | undefined,
  referenceSize: number,
  artboardW: number,
  artboardH: number,
  fontSize = 16,
): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'auto' || trimmed === 'none' || trimmed === 'initial') return null;

  const directPx = parsePx(trimmed);
  if (directPx !== null) return directPx;

  const numOnly = /^(-?(?:\d+\.?\d*|\.\d+))$/.exec(trimmed);
  if (numOnly) {
    return quantize(Number.parseFloat(numOnly[1]!));
  }

  if (trimmed.endsWith('%')) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    if (Number.isFinite(pct)) {
      return quantize((referenceSize * pct) / 100);
    }
  }

  const remMatch = /^(-?(?:\d+\.?\d*|\.\d+))rem$/i.exec(trimmed);
  if (remMatch) {
    return quantize(Number.parseFloat(remMatch[1]!) * 16);
  }

  const emMatch = /^(-?(?:\d+\.?\d*|\.\d+))em$/i.exec(trimmed);
  if (emMatch) {
    return quantize(Number.parseFloat(emMatch[1]!) * fontSize);
  }

  const vwMatch = /^(-?(?:\d+\.?\d*|\.\d+))vw$/i.exec(trimmed);
  if (vwMatch) {
    return quantize((artboardW * Number.parseFloat(vwMatch[1]!)) / 100);
  }

  const vhMatch = /^(-?(?:\d+\.?\d*|\.\d+))vh$/i.exec(trimmed);
  if (vhMatch) {
    return quantize((artboardH * Number.parseFloat(vhMatch[1]!)) / 100);
  }

  const vminMatch = /^(-?(?:\d+\.?\d*|\.\d+))vmin$/i.exec(trimmed);
  if (vminMatch) {
    return quantize((Math.min(artboardW, artboardH) * Number.parseFloat(vminMatch[1]!)) / 100);
  }

  const vmaxMatch = /^(-?(?:\d+\.?\d*|\.\d+))vmax$/i.exec(trimmed);
  if (vmaxMatch) {
    return quantize((Math.max(artboardW, artboardH) * Number.parseFloat(vmaxMatch[1]!)) / 100);
  }

  const ptMatch = /^(-?(?:\d+\.?\d*|\.\d+))pt$/i.exec(trimmed);
  if (ptMatch) {
    return quantize((Number.parseFloat(ptMatch[1]!) * 4) / 3);
  }

  // Simple calc(...) support, e.g. calc(100% - 80px) or calc(50% + 20px)
  const calcMatch = /^calc\((.+)\)$/i.exec(trimmed);
  if (calcMatch) {
    const expr = calcMatch[1]!.trim();
    const addSubMatch = /^(.+?)\s*([+-])\s*(.+)$/.exec(expr);
    if (addSubMatch) {
      const lhs = resolveLengthToPx(addSubMatch[1]!, referenceSize, artboardW, artboardH, fontSize);
      const rhs = resolveLengthToPx(addSubMatch[3]!, referenceSize, artboardW, artboardH, fontSize);
      if (lhs !== null && rhs !== null) {
        return quantize(addSubMatch[2] === '+' ? lhs + rhs : lhs - rhs);
      }
    }
    const mulMatch = /^(.+?)\s*\*\s*(-?(?:\d+\.?\d*|\.\d+))$/.exec(expr);
    if (mulMatch) {
      const lhs = resolveLengthToPx(mulMatch[1]!, referenceSize, artboardW, artboardH, fontSize);
      const factor = Number.parseFloat(mulMatch[2]!);
      if (lhs !== null && Number.isFinite(factor)) {
        return quantize(lhs * factor);
      }
    }
  }

  return null;
}

function parseBoxSides(
  styles: ReadonlyMap<string, string>,
  prefix: 'padding' | 'margin',
  refW: number,
  refH: number,
  artW: number,
  artH: number,
  fontSize: number,
): { top: number; right: number; bottom: number; left: number; autoX: boolean } {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  let autoX = false;

  const shorthand = styles.get(prefix);
  if (shorthand) {
    const parts = splitTopLevel(shorthand.trim(), ' ').filter(Boolean);
    if (parts.some((p) => p.toLowerCase() === 'auto') && parts.length >= 2) {
      autoX = true;
    }
    const vals = parts.map((p) => resolveLengthToPx(p, refW, artW, artH, fontSize) ?? 0);
    if (vals.length === 1) {
      top = right = bottom = left = vals[0]!;
    } else if (vals.length === 2) {
      top = bottom = vals[0]!;
      right = left = vals[1]!;
    } else if (vals.length === 3) {
      top = vals[0]!;
      right = left = vals[1]!;
      bottom = vals[2]!;
    } else if (vals.length >= 4) {
      top = vals[0]!;
      right = vals[1]!;
      bottom = vals[2]!;
      left = vals[3]!;
    }
  }

  const t = resolveLengthToPx(styles.get(`${prefix}-top`), refH, artW, artH, fontSize);
  const r = resolveLengthToPx(styles.get(`${prefix}-right`), refW, artW, artH, fontSize);
  const b = resolveLengthToPx(styles.get(`${prefix}-bottom`), refH, artW, artH, fontSize);
  const l = resolveLengthToPx(styles.get(`${prefix}-left`), refW, artW, artH, fontSize);
  if (t !== null) top = t;
  if (r !== null) right = r;
  if (b !== null) bottom = b;
  if (l !== null) left = l;

  if (
    styles.get(`${prefix}-left`)?.trim().toLowerCase() === 'auto' &&
    styles.get(`${prefix}-right`)?.trim().toLowerCase() === 'auto'
  ) {
    autoX = true;
  }

  return { top, right, bottom, left, autoX };
}

function registerDataUriAsset(rawSrc: string, assets: ImportedAsset[]): string | null {
  const trimmed = rawSrc.trim();
  const inlined = DATA_URI_RE.exec(trimmed);
  if (inlined) {
    let mimeType = inlined[1]!.toLowerCase();
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
    if (mimeType === 'image/gif' || mimeType === 'image/svg+xml') mimeType = 'image/png';
    const id = `imported_${assets.length + 1}`;
    assets.push({
      id,
      mimeType,
      base64: inlined[2]!.replace(/\s+/g, ''),
    });
    return `asset:${id}`;
  }
  if (/^asset:[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function extractBackgroundImageAsset(
  styles: ReadonlyMap<string, string>,
  assets: ImportedAsset[],
): string | null {
  for (const prop of ['background-image', 'background']) {
    const raw = styles.get(prop);
    if (!raw) continue;
    const dataMatch = CSS_URL_DATA_RE.exec(raw);
    if (dataMatch) {
      return registerDataUriAsset(dataMatch[1]!, assets);
    }
    const assetMatch = CSS_URL_ASSET_RE.exec(raw);
    if (assetMatch) {
      return assetMatch[1]!;
    }
  }
  return null;
}

function stripCssUrlsFromBackground(raw: string): string {
  return raw
    .replace(/url\([^)]*\)/gi, '')
    .replace(/\b(?:no-repeat|repeat-x|repeat-y|repeat|cover|contain|center)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasVisualBox(styles: ReadonlyMap<string, string>): boolean {
  const bg = styles.get('background') ?? styles.get('background-color');
  if (bg) {
    const cleaned = stripCssUrlsFromBackground(bg).toLowerCase();
    if (cleaned && cleaned !== 'transparent' && cleaned !== 'none' && cleaned !== '#00000000') {
      return true;
    }
  }
  for (const bProp of [
    'border',
    'border-width',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'outline',
  ]) {
    const val = styles.get(bProp)?.trim().toLowerCase();
    if (val && val !== 'none' && val !== '0' && val !== '0px') {
      return true;
    }
  }
  const shadow = styles.get('box-shadow')?.trim().toLowerCase();
  if (shadow && shadow !== 'none') return true;
  return false;
}

function isCssBorderTriangle(styles: ReadonlyMap<string, string>): {
  direction: 'up' | 'down' | 'left' | 'right';
  width: number;
  height: number;
  color: string;
} | null {
  const w = parsePx(styles.get('width') ?? '0');
  const h = parsePx(styles.get('height') ?? '0');
  if ((w !== null && w > 0) || (h !== null && h > 0)) return null;

  const sides: Record<'top' | 'right' | 'bottom' | 'left', { size: number; color: string } | null> =
    {
      top: null,
      right: null,
      bottom: null,
      left: null,
    };

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const raw = styles.get(`border-${side}`);
    if (!raw) continue;
    const tokens = splitTopLevel(raw, ' ');
    let size = 0;
    let color = 'transparent';
    for (const tok of tokens) {
      const px = parsePx(tok);
      if (px !== null && px > 0) size = px;
      const norm = normalizeColor(tok);
      if (norm) color = norm;
    }
    if (size > 0) sides[side] = { size, color };
  }

  const coloredSides = (['top', 'right', 'bottom', 'left'] as const).filter(
    (s) => sides[s] && sides[s]!.color !== '#00000000',
  );
  if (coloredSides.length !== 1) return null;
  const active = coloredSides[0]!;
  const color = sides[active]!.color;

  if (active === 'bottom') {
    const l = sides.left?.size ?? sides.bottom!.size / 2;
    const r = sides.right?.size ?? sides.bottom!.size / 2;
    return { direction: 'up', width: l + r, height: sides.bottom!.size, color };
  }
  if (active === 'top') {
    const l = sides.left?.size ?? sides.top!.size / 2;
    const r = sides.right?.size ?? sides.top!.size / 2;
    return { direction: 'down', width: l + r, height: sides.top!.size, color };
  }
  if (active === 'left') {
    const t = sides.top?.size ?? sides.left!.size / 2;
    const b = sides.bottom?.size ?? sides.left!.size / 2;
    return { direction: 'right', width: sides.left!.size, height: t + b, color };
  }
  const t = sides.top?.size ?? sides.right!.size / 2;
  const b = sides.bottom?.size ?? sides.right!.size / 2;
  return { direction: 'left', width: sides.right!.size, height: t + b, color };
}

function detectNamedShape(
  node: HtmlNode & { tagName: string },
  styles: ReadonlyMap<string, string>,
): string | null {
  const attrShape = getAttr(node, 'data-shape')?.trim().toLowerCase();
  if (attrShape) return attrShape;

  for (const cls of getClasses(node)) {
    const lower = cls.toLowerCase();
    if (lower.startsWith('shape-')) {
      return lower.slice(6);
    }
    if (
      lower === 'triangle' ||
      lower === 'diamond' ||
      lower === 'hexagon' ||
      lower === 'pentagon' ||
      lower === 'octagon' ||
      lower === 'star' ||
      lower === 'heart' ||
      lower === 'badge-star' ||
      lower === 'shield' ||
      lower === 'ribbon' ||
      lower === 'blob' ||
      lower === 'arch' ||
      lower === 'cross' ||
      lower === 'plus'
    ) {
      return lower;
    }
  }

  const clipPath = (styles.get('clip-path') ?? styles.get('-webkit-clip-path'))?.trim();
  if (clipPath && clipPath.toLowerCase() !== 'none') {
    return `clip:${clipPath}`;
  }

  return null;
}

function regularPolygonPoints(sides: number, cx = 50, cy = 50, r = 48, startDeg = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const rad = ((startDeg + (i * 360) / sides) * Math.PI) / 180;
    const x = quantize(cx + r * Math.cos(rad));
    const y = quantize(cy + r * Math.sin(rad));
    pts.push(`${x},${y}`);
  }
  return pts.join(' ');
}

function starPolygonPoints(pointsCount = 5, cx = 50, cy = 50, outerR = 48, innerR = 22): string {
  const pts: string[] = [];
  const total = pointsCount * 2;
  for (let i = 0; i < total; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const rad = ((-90 + (i * 360) / total) * Math.PI) / 180;
    const x = quantize(cx + r * Math.cos(rad));
    const y = quantize(cy + r * Math.sin(rad));
    pts.push(`${x},${y}`);
  }
  return pts.join(' ');
}

function buildShapeSvgInner(
  shapeKind: string,
  fill: Fill,
  strokeColor: string | undefined,
  strokeWidth: number,
  gradId: string,
): string {
  let defs = '';
  let fillAttr = '#38bdf8';
  if (fill.kind === 'solid') {
    fillAttr = fill.color === '#00000000' ? 'none' : fill.color;
  } else if (fill.kind === 'linear') {
    const rad = ((fill.angle - 90) * Math.PI) / 180;
    const x1 = quantize(50 - Math.cos(rad) * 50);
    const y1 = quantize(50 - Math.sin(rad) * 50);
    const x2 = quantize(50 + Math.cos(rad) * 50);
    const y2 = quantize(50 + Math.sin(rad) * 50);
    const stopsXml = fill.stops
      .map((s) => `<stop offset="${s.pos}%" stop-color="${escapeAttr(s.color)}" />`)
      .join('');
    defs = `<defs><linearGradient id="${escapeAttr(gradId)}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stopsXml}</linearGradient></defs>`;
    fillAttr = `url(#${gradId})`;
  }

  const strokeAttrs =
    strokeColor && strokeWidth > 0
      ? ` stroke="${escapeAttr(strokeColor)}" stroke-width="${quantize(strokeWidth)}"`
      : '';

  if (shapeKind.startsWith('clip:')) {
    const clip = shapeKind.slice(5).trim();
    const polyMatch = /^polygon\(([\s\S]+)\)$/i.exec(clip);
    if (polyMatch) {
      const rawPairs = splitTopLevel(polyMatch[1]!, ',');
      const filteredPairs = rawPairs.filter(
        (p) => !['nonzero', 'evenodd'].includes(p.trim().toLowerCase()),
      );
      const pts: string[] = [];
      for (const pair of filteredPairs) {
        const coords = pair.trim().split(/\s+/);
        if (coords.length >= 2) {
          const parseCoord = (c: string): number => {
            if (c.endsWith('%')) return quantize(Number.parseFloat(c.slice(0, -1)));
            const px = parsePx(c);
            return px !== null ? quantize(px) : 0;
          };
          pts.push(`${parseCoord(coords[0]!)},${parseCoord(coords[1]!)}`);
        }
      }
      if (pts.length >= 3) {
        return `${defs}<polygon points="${pts.join(' ')}" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
      }
    }

    const circleMatch = /^circle\(([^)]*)\)$/i.exec(clip);
    if (circleMatch) {
      return `${defs}<circle cx="50" cy="50" r="48" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    }

    const ellipseMatch = /^ellipse\(([^)]*)\)$/i.exec(clip);
    if (ellipseMatch) {
      return `${defs}<ellipse cx="50" cy="50" rx="48" ry="35" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    }
  }

  switch (shapeKind) {
    case 'triangle':
    case 'triangle-up':
      return `${defs}<polygon points="50,4 96,96 4,96" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'triangle-down':
      return `${defs}<polygon points="4,4 96,4 50,96" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'triangle-left':
      return `${defs}<polygon points="96,4 96,96 4,50" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'triangle-right':
      return `${defs}<polygon points="4,4 96,50 4,96" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'diamond':
    case 'rhombus':
      return `${defs}<polygon points="50,2 98,50 50,98 2,50" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'pentagon':
      return `${defs}<polygon points="${regularPolygonPoints(5)}" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'hexagon':
      return `${defs}<polygon points="${regularPolygonPoints(6)}" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'octagon':
      return `${defs}<polygon points="${regularPolygonPoints(8, 50, 50, 48, -67.5)}" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'star':
    case 'star-5':
      return `${defs}<polygon points="${starPolygonPoints(5, 50, 50, 48, 20)}" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'star-4':
      return `${defs}<polygon points="${starPolygonPoints(4, 50, 50, 48, 16)}" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'star-6':
      return `${defs}<polygon points="${starPolygonPoints(6, 50, 50, 48, 25)}" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'burst':
    case 'badge-star':
    case 'seal':
      return `${defs}<polygon points="${starPolygonPoints(12, 50, 50, 48, 38)}" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'heart':
      return `${defs}<path d="M50 88 C50 88 10 62 10 34 C10 18 22 8 36 8 C43 8 48 12 50 18 C52 12 57 8 64 8 C78 8 90 18 90 34 C90 62 50 88 50 88 Z" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'arrow':
    case 'arrow-right':
      return `${defs}<polygon points="4,35 60,35 60,12 96,50 60,88 60,65 4,65" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'arrow-left':
      return `${defs}<polygon points="96,35 40,35 40,12 4,50 40,88 40,65 96,65" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'arrow-up':
      return `${defs}<polygon points="35,96 35,40 12,40 50,4 88,40 65,40 65,96" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'arrow-down':
      return `${defs}<polygon points="35,4 35,60 12,60 50,96 88,60 65,60 65,4" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'chevron':
    case 'chevron-right':
      return `${defs}<polygon points="25,8 75,50 25,92 12,78 48,50 12,22" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'cross':
    case 'plus':
      return `${defs}<polygon points="36,8 64,8 64,36 92,36 92,64 64,64 64,92 36,92 36,64 8,64 8,36 36,36" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'parallelogram':
      return `${defs}<polygon points="22,8 96,8 78,92 4,92" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'trapezoid':
      return `${defs}<polygon points="20,12 80,12 96,88 4,88" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'shield':
      return `${defs}<path d="M50 4 L90 18 L90 48 C90 72 72 88 50 96 C28 88 10 72 10 48 L10 18 Z" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'arch':
      return `${defs}<path d="M8 96 L8 46 A42 42 0 0 1 92 46 L92 96 Z" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'blob':
      return `${defs}<path d="M78,24 C92,38 94,64 80,78 C66,92 38,94 22,80 C6,66 8,36 24,20 C40,4 64,10 78,24 Z" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'ribbon':
    case 'tag':
      return `${defs}<polygon points="4,12 96,12 82,50 96,88 4,88" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    case 'wave':
      return `${defs}<path d="M0 30 Q25 5 50 30 T100 30 L100 100 L0 100 Z" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
    default:
      return `${defs}<rect x="4" y="4" width="92" height="92" rx="12" fill="${escapeAttr(fillAttr)}"${strokeAttrs} />`;
  }
}

function hasOnlyInlineOrTextChildren(
  node: HtmlNode,
  rules: CssRuleEntry[],
  vars: ReadonlyMap<string, string>,
): boolean {
  let hasSomeText = false;
  const check = (cur: HtmlNode): boolean => {
    for (const child of cur.childNodes ?? []) {
      if (child.nodeName === '#text') {
        if ((child.value ?? '').trim().length > 0) hasSomeText = true;
        continue;
      }
      if (!isElement(child)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') continue;
      if (
        tag === 'img' ||
        tag === 'svg' ||
        tag === 'hr' ||
        tag === 'table' ||
        tag === 'ul' ||
        tag === 'ol'
      ) {
        return false;
      }
      const childStyles = computeMergedStyles(child, rules, vars);
      if (
        childStyles.get('position')?.toLowerCase() === 'absolute' ||
        hasVisualBox(childStyles) ||
        extractBackgroundImageAsset(childStyles, []) !== null
      ) {
        return false;
      }
      if (!INLINE_TEXT_TAGS.has(tag) && tag !== 'p' && tag !== 'div') {
        return false;
      }
      if (!check(child)) return false;
    }
    return true;
  };
  return check(node) && hasSomeText;
}

function serializeInlineContent(
  node: HtmlNode,
  rules: CssRuleEntry[],
  vars: ReadonlyMap<string, string>,
): string {
  const out: string[] = [];

  for (const child of node.childNodes ?? []) {
    if (child.nodeName === '#text') {
      out.push(escapeText(child.value ?? ''));
      continue;
    }
    if (!isElement(child)) continue;
    const tag = child.tagName.toLowerCase();
    if (IGNORED_HEAD_OR_SCRIPT_TAGS.has(tag)) continue;

    if (tag === 'br') {
      out.push('<br>');
      continue;
    }

    const childStyles = computeMergedStyles(child, rules, vars);
    const spanStyles: string[] = [];

    if (tag === 'b' || tag === 'strong' || tag === 'mark') {
      spanStyles.push('font-weight:700');
    } else if (childStyles.has('font-weight')) {
      spanStyles.push(`font-weight:${childStyles.get('font-weight')!}`);
    }

    if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'q') {
      spanStyles.push('font-style:italic');
    } else if (childStyles.has('font-style')) {
      spanStyles.push(`font-style:${childStyles.get('font-style')!}`);
    }

    if (tag === 'u' || tag === 'ins' || (tag === 'a' && !childStyles.has('text-decoration'))) {
      spanStyles.push('text-decoration:underline');
    } else if (childStyles.has('text-decoration')) {
      spanStyles.push(`text-decoration:${childStyles.get('text-decoration')!}`);
    }

    const colorRaw = childStyles.get('color') ?? (tag === 'mark' ? '#facc15' : undefined);
    if (colorRaw) {
      const norm = normalizeColor(colorRaw);
      if (norm) spanStyles.push(`color:${norm}`);
    }

    const inner = serializeInlineContent(child, rules, vars);
    if (!inner.trim()) continue;

    if (tag === 'p' || tag === 'div' || tag === 'li') {
      if (out.length > 0 && !out[out.length - 1]!.endsWith('<br>')) {
        out.push('<br>');
      }
      if (tag === 'li') {
        out.push('• ');
      }
    }

    if (spanStyles.length > 0) {
      out.push(`<span style="${escapeAttr(spanStyles.join(';'))}">${inner}</span>`);
    } else {
      out.push(inner);
    }
  }

  return out.join('');
}

function serializeSvgNode(node: HtmlNode, vars: ReadonlyMap<string, string>): string {
  if (node.nodeName === '#text') {
    return escapeText(node.value ?? '');
  }
  if (!isElement(node)) return '';
  const rawTag = node.tagName.toLowerCase();
  const canonicalTag = SVG_TAG_CASE_MAP[rawTag];
  if (!canonicalTag || !ALLOWED_SVG_TAG_SET.has(canonicalTag)) {
    return '';
  }

  const attrs = (node.attrs ?? [])
    .filter((attr) => {
      const n = attr.name.toLowerCase();
      return !n.startsWith('on') && n !== 'xmlns' && n !== 'xmlns:xlink';
    })
    .map((attr) => {
      const lower = attr.name.toLowerCase();
      const name = SVG_ATTR_CASE_MAP[lower]?.trim() ?? attr.name;
      const val = resolveCssVariables(attr.value, vars);
      return ` ${name}="${escapeAttr(val)}"`;
    })
    .join('');

  const children = (node.childNodes ?? []).map((c) => serializeSvgNode(c, vars)).join('');
  return `<${canonicalTag}${attrs}>${children}</${canonicalTag}>`;
}

function estimateTextHeight(
  text: string,
  width: number,
  fontSize: number,
  lineHeight: number,
): number {
  const clean = text.trim();
  if (!clean) return Math.ceil(fontSize * lineHeight);
  const explicitLines = clean.split(/\r?\n/);
  const avgCharWidth = fontSize * 0.55;
  const charsPerLine = Math.max(1, Math.floor(width / Math.max(1, avgCharWidth)));
  let totalLines = 0;
  for (const line of explicitLines) {
    totalLines += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  return quantize(Math.max(fontSize * lineHeight, totalLines * fontSize * lineHeight + 4));
}

function nextUniqueId(
  node: HtmlNode,
  fallbackPrefix: string,
  usedIds: Set<string>,
  counter: { value: number },
): string {
  counter.value += 1;
  const candidateRaw =
    getAttr(node, 'data-id')?.trim() ||
    getAttr(node, 'id')?.trim() ||
    `${fallbackPrefix}-${counter.value}`;
  const sanitized =
    candidateRaw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, LIMITS.document.maxLayerIdLength) ||
    `layer-${counter.value}`;
  let unique = sanitized;
  let suffix = 2;
  while (usedIds.has(unique)) {
    unique = `${sanitized.slice(0, Math.max(1, LIMITS.document.maxLayerIdLength - 4))}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(unique);
  return unique;
}

function inferLayerName(node: HtmlNode & { tagName: string }, fallback: string): string {
  const explicit =
    getAttr(node, 'data-layer')?.trim() ||
    getAttr(node, 'data-name')?.trim() ||
    getAttr(node, 'aria-label')?.trim() ||
    getAttr(node, 'title')?.trim() ||
    getAttr(node, 'alt')?.trim();
  if (explicit) return explicit;
  const id = getAttr(node, 'id')?.trim();
  if (id) return id;
  const classes = getClasses(node).filter((c) => c.toLowerCase() !== 'layer');
  if (classes.length > 0) return classes[0]!;
  const txt = readableText(node);
  if (txt) return txt.slice(0, 28);
  return fallback;
}

function parseRotationFromTransform(transformRaw: string | undefined): number {
  if (!transformRaw) return 0;
  const match = /rotate\(\s*([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|turn|grad)?\s*\)/i.exec(
    transformRaw,
  );
  if (!match) return 0;
  const val = Number.parseFloat(match[1]!);
  if (!Number.isFinite(val)) return 0;
  const unit = (match[2] ?? 'deg').toLowerCase();
  if (unit === 'rad') return normalizeAngle((val * 180) / Math.PI);
  if (unit === 'turn') return normalizeAngle(val * 360);
  if (unit === 'grad') return normalizeAngle(val * 0.9);
  return normalizeAngle(val);
}

function applyTranslateOffset(
  transformRaw: string | undefined,
  box: BoxBox,
  artW: number,
  artH: number,
  fontSize: number,
): { dx: number; dy: number } {
  if (!transformRaw) return { dx: 0, dy: 0 };
  let dx = 0;
  let dy = 0;

  const translateMatch = /translate\(\s*([^,)]+)(?:\s*,\s*([^)]+))?\s*\)/i.exec(transformRaw);
  if (translateMatch) {
    dx += resolveLengthToPx(translateMatch[1]!, box.width, artW, artH, fontSize) ?? 0;
    if (translateMatch[2]) {
      dy += resolveLengthToPx(translateMatch[2]!, box.height, artW, artH, fontSize) ?? 0;
    }
  }

  const txMatch = /translateX\(\s*([^)]+)\s*\)/i.exec(transformRaw);
  if (txMatch) {
    dx += resolveLengthToPx(txMatch[1]!, box.width, artW, artH, fontSize) ?? 0;
  }

  const tyMatch = /translateY\(\s*([^)]+)\s*\)/i.exec(transformRaw);
  if (tyMatch) {
    dy += resolveLengthToPx(tyMatch[1]!, box.height, artW, artH, fontSize) ?? 0;
  }

  return { dx: quantize(dx), dy: quantize(dy) };
}

function computeElementBox(
  node: HtmlNode & { tagName: string },
  styles: ReadonlyMap<string, string>,
  ctx: TraversalContext,
  flowCursorY: number,
): { box: BoxBox; advancesFlow: boolean; nextFlowY: number } {
  const pBox = ctx.parentBox;
  const artW = ctx.artboardWidth;
  const artH = ctx.artboardHeight;
  const tag = node.tagName.toLowerCase();

  const fontSize =
    resolveLengthToPx(styles.get('font-size'), pBox.width, artW, artH, 16) ??
    HEADING_DEFAULTS[tag]?.fontSize ??
    20;

  const margin = parseBoxSides(styles, 'margin', pBox.width, pBox.height, artW, artH, fontSize);
  const padding = parseBoxSides(styles, 'padding', pBox.width, pBox.height, artW, artH, fontSize);

  const posMode = styles.get('position')?.trim().toLowerCase() ?? 'static';
  const isAbs = posMode === 'absolute' || posMode === 'fixed';

  // Handle inset shorthand (e.g. inset: 0 or inset: 20px 40px)
  let insetTop: number | null = null;
  let insetRight: number | null = null;
  let insetBottom: number | null = null;
  let insetLeft: number | null = null;
  const insetRaw = styles.get('inset');
  if (insetRaw) {
    const parts = splitTopLevel(insetRaw.trim(), ' ').filter(Boolean);
    const v0 = resolveLengthToPx(parts[0], pBox.width, artW, artH, fontSize);
    const v1 = resolveLengthToPx(parts[1] ?? parts[0], pBox.width, artW, artH, fontSize);
    const v2 = resolveLengthToPx(parts[2] ?? parts[0], pBox.height, artW, artH, fontSize);
    const v3 = resolveLengthToPx(
      parts[3] ?? parts[1] ?? parts[0],
      pBox.width,
      artW,
      artH,
      fontSize,
    );
    insetTop = v0;
    insetRight = v1;
    insetBottom = v2;
    insetLeft = v3;
  }

  const rawLeft =
    resolveLengthToPx(styles.get('left'), pBox.width, artW, artH, fontSize) ?? insetLeft;
  const rawRight =
    resolveLengthToPx(styles.get('right'), pBox.width, artW, artH, fontSize) ?? insetRight;
  const rawTop =
    resolveLengthToPx(styles.get('top'), pBox.height, artW, artH, fontSize) ?? insetTop;
  const rawBottom =
    resolveLengthToPx(styles.get('bottom'), pBox.height, artW, artH, fontSize) ?? insetBottom;

  const attrWidth = getAttr(node, 'width') ?? getAttr(node, 'data-width');
  const attrHeight = getAttr(node, 'height') ?? getAttr(node, 'data-height');

  let width =
    resolveLengthToPx(styles.get('width') ?? attrWidth, pBox.width, artW, artH, fontSize) ?? null;
  let height =
    resolveLengthToPx(styles.get('height') ?? attrHeight, pBox.height, artW, artH, fontSize) ??
    null;

  if (width === null) {
    if (isAbs && rawLeft !== null && rawRight !== null) {
      width = Math.max(10, pBox.width - rawLeft - rawRight);
    } else if (tag === 'button' || tag === 'span' || tag === 'a' || tag === 'label') {
      const txtLen = readableText(node).length;
      width = clampQuantized(
        Math.max(80, txtLen * fontSize * 0.62 + padding.left + padding.right + 24),
        40,
        pBox.width,
      );
    } else {
      width = Math.max(20, pBox.width - margin.left - margin.right);
    }
  }

  const maxW = resolveLengthToPx(styles.get('max-width'), pBox.width, artW, artH, fontSize);
  if (maxW !== null && width > maxW) width = maxW;

  if (height === null) {
    if (isAbs && rawTop !== null && rawBottom !== null) {
      height = Math.max(10, pBox.height - rawTop - rawBottom);
    } else if (tag === 'hr') {
      height = 2;
    } else if (tag === 'img' || tag === 'svg') {
      height = width;
    } else {
      const txt = textOf(node);
      const lh = Number.parseFloat(styles.get('line-height') ?? '1.2') || 1.2;
      const estimatedTextH = estimateTextHeight(
        txt,
        Math.max(20, width - padding.left - padding.right),
        fontSize,
        lh,
      );
      height = Math.max(24, estimatedTextH + padding.top + padding.bottom);
    }
  }

  let localLeft: number;
  if (isAbs) {
    if (rawLeft !== null) {
      localLeft = rawLeft + margin.left;
    } else if (rawRight !== null) {
      localLeft = pBox.width - width - rawRight - margin.right;
    } else if (margin.autoX) {
      localLeft = (pBox.width - width) / 2;
    } else {
      localLeft = margin.left;
    }
  } else {
    if (margin.autoX) {
      localLeft = (pBox.width - width) / 2;
    } else if (styles.get('text-align')?.toLowerCase() === 'center' && width < pBox.width) {
      localLeft = (pBox.width - width) / 2;
    } else if (ctx.dir === 'rtl' && width < pBox.width) {
      localLeft = pBox.width - width - margin.right;
    } else {
      localLeft = margin.left;
    }
    if (posMode === 'relative' && rawLeft !== null) {
      localLeft += rawLeft;
    }
  }

  let localTop: number;
  if (isAbs) {
    if (rawTop !== null) {
      localTop = rawTop + margin.top;
    } else if (rawBottom !== null) {
      localTop = pBox.height - height - rawBottom - margin.bottom;
    } else {
      localTop = margin.top;
    }
  } else {
    localTop = flowCursorY + margin.top;
    if (posMode === 'relative' && rawTop !== null) {
      localTop += rawTop;
    }
  }

  const candidateBox: BoxBox = {
    left: quantize(pBox.left + localLeft),
    top: quantize(pBox.top + localTop),
    width: quantize(Math.max(1, width)),
    height: quantize(Math.max(1, height)),
  };

  const { dx, dy } = applyTranslateOffset(
    styles.get('transform'),
    candidateBox,
    artW,
    artH,
    fontSize,
  );
  candidateBox.left = quantize(candidateBox.left + dx);
  candidateBox.top = quantize(candidateBox.top + dy);

  const nextFlowY = isAbs ? flowCursorY : quantize(localTop + candidateBox.height + margin.bottom);
  return {
    box: candidateBox,
    advancesFlow: !isAbs,
    nextFlowY,
  };
}

function buildEnvelopeAttrs(
  node: HtmlNode & { tagName: string },
  type: 'text' | 'shape' | 'image' | 'svg',
  idPrefix: string,
  nameFallback: string,
  ctx: TraversalContext,
): string {
  const id = nextUniqueId(node, idPrefix, ctx.usedIds, ctx.layerCounter);
  const name = inferLayerName(node, `${nameFallback} ${ctx.layerCounter.value}`);
  const hidden =
    getAttr(node, 'data-hidden') === 'true' || getAttr(node, 'hidden') !== undefined || false;
  const locked = getAttr(node, 'data-locked') === 'true';

  const parts = [
    `data-id="${escapeAttr(id)}"`,
    `data-layer="${escapeAttr(name)}"`,
    `data-type="${type}"`,
  ];
  if (hidden) parts.push('data-hidden="true"');
  if (locked) parts.push('data-locked="true"');
  return parts.join(' ');
}

function buildCommonStyleParts(
  box: BoxBox,
  rotation: number,
  opacity: number,
  includeHeight: boolean,
): string[] {
  const parts = [
    'position:absolute',
    `left:${quantize(box.left)}px`,
    `top:${quantize(box.top)}px`,
    `width:${quantize(Math.max(1, box.width))}px`,
  ];
  if (includeHeight) {
    parts.push(`height:${quantize(Math.max(1, box.height))}px`);
  }
  if (rotation !== 0) {
    parts.push(`transform:rotate(${quantize(rotation)}deg)`);
  }
  if (opacity < 1) {
    parts.push(`opacity:${clampQuantized(opacity, 0, 1)}`);
  }
  return parts;
}

function buildShapeLayerHtml(
  node: HtmlNode & { tagName: string },
  styles: ReadonlyMap<string, string>,
  box: BoxBox,
  rotation: number,
  opacity: number,
  ctx: TraversalContext,
): string {
  const attrs = buildEnvelopeAttrs(node, 'shape', 'shape', 'Shape', ctx);
  const styleParts = buildCommonStyleParts(box, rotation, opacity, true);

  // Fill (background / background-color)
  const rawBg = styles.get('background') ?? styles.get('background-color');
  if (rawBg) {
    const cleanedBg = stripCssUrlsFromBackground(rawBg);
    if (cleanedBg) {
      const dummyWarnings: Warning[] = [];
      const parsedFill = parseFill(cleanedBg, {
        warnings: dummyWarnings,
        path: 'import',
        dir: ctx.dir,
      });
      if (parsedFill.kind === 'solid') {
        styleParts.push(`background:${parsedFill.color}`);
      } else {
        const stops = parsedFill.stops.map((s) => `${s.color} ${s.pos}%`).join(', ');
        styleParts.push(`background:linear-gradient(${parsedFill.angle}deg, ${stops})`);
      }
    }
  } else if (node.tagName.toLowerCase() === 'hr') {
    const hrColor = normalizeColor(styles.get('color') ?? '#cbd5e1') ?? '#cbd5e1';
    styleParts.push(`background:${hrColor}`);
  }

  // Border (direct or longhand/directional)
  const borderStr = extractCanonicalBorderString(styles, ctx);
  if (borderStr) {
    styleParts.push(`border:${borderStr}`);
  }

  // Border radius
  const rawRadius = styles.get('border-radius');
  if (rawRadius) {
    const firstCorner = splitTopLevel(rawRadius.split('/')[0]!.trim(), ' ')[0]?.trim() ?? '';
    if (firstCorner.endsWith('%')) {
      const pct = Number.parseFloat(firstCorner.slice(0, -1));
      if (Number.isFinite(pct) && pct > 0) {
        const pxR = quantize((Math.min(box.width, box.height) * pct) / 100);
        styleParts.push(`border-radius:${pxR}px`);
      }
    } else {
      const pxR = resolveLengthToPx(
        firstCorner,
        Math.min(box.width, box.height),
        ctx.artboardWidth,
        ctx.artboardHeight,
      );
      if (pxR !== null && pxR > 0) {
        styleParts.push(`border-radius:${pxR}px`);
      }
    }
  }

  // Box shadow
  const rawShadow = styles.get('box-shadow');
  if (
    rawShadow &&
    rawShadow.trim().toLowerCase() !== 'none' &&
    !rawShadow.toLowerCase().includes('inset')
  ) {
    styleParts.push(`box-shadow:${rawShadow.trim()}`);
  }

  return `<div ${attrs} style="${escapeAttr(styleParts.join(';'))}"></div>`;
}

function extractCanonicalBorderString(
  styles: ReadonlyMap<string, string>,
  ctx: TraversalContext,
): string | null {
  const candidates = [
    styles.get('border'),
    styles.get('outline'),
    styles.get('border-top'),
    styles.get('border-bottom'),
    styles.get('border-left'),
    styles.get('border-right'),
  ];

  let raw = candidates.find((c) => c && c.trim().toLowerCase() !== 'none' && c.trim() !== '0');
  if (!raw) {
    const bw = styles.get('border-width');
    const bs = styles.get('border-style');
    const bc = styles.get('border-color');
    if (bw || bs || bc) {
      raw = `${bw ? splitTopLevel(bw, ' ')[0] : '1px'} ${bs ? splitTopLevel(bs, ' ')[0] : 'solid'} ${bc ? splitTopLevel(bc, ' ')[0] : '#000000'}`;
    }
  }
  if (!raw) return null;

  const tokens = splitTopLevel(raw, ' ').filter(Boolean);
  let widthPx: number | null = null;
  let style: 'solid' | 'dashed' | 'dotted' = 'solid';
  let color = '#000000';

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === 'none' || lower === 'hidden') return null;
    if (widthPx === null) {
      if (lower === 'thin') {
        widthPx = 1;
        continue;
      }
      if (lower === 'medium') {
        widthPx = 3;
        continue;
      }
      if (lower === 'thick') {
        widthPx = 5;
        continue;
      }
      const len = resolveLengthToPx(tok, 100, ctx.artboardWidth, ctx.artboardHeight);
      if (len !== null && !tok.endsWith('%')) {
        widthPx = len;
        continue;
      }
    }
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
    const normColor = normalizeColor(tok);
    if (normColor) {
      color = normColor;
    }
  }

  if (widthPx === null || widthPx <= 0) return null;
  return `${quantize(widthPx)}px ${style} ${color}`;
}

function buildTextLayerHtml(
  node: HtmlNode & { tagName: string },
  styles: ReadonlyMap<string, string>,
  box: BoxBox,
  rotation: number,
  opacity: number,
  innerHtml: string,
  plainText: string,
  ctx: TraversalContext,
): string {
  const attrs = buildEnvelopeAttrs(node, 'text', 'text', 'Text', ctx);
  const hasAr = containsArabic(plainText);
  const explicitDir = getAttr(node, 'dir')?.toLowerCase();
  const cssDir = styles.get('direction')?.toLowerCase();
  const dir: 'ltr' | 'rtl' =
    explicitDir === 'rtl' || explicitDir === 'ltr'
      ? explicitDir
      : cssDir === 'rtl' || cssDir === 'ltr'
        ? cssDir
        : hasAr
          ? 'rtl'
          : ctx.dir;

  const styleParts = buildCommonStyleParts(box, rotation, opacity, false);
  const tag = node.tagName.toLowerCase();

  // Font family
  const rawFont = styles.get('font-family');
  let fontFamily = fallbackFont(hasAr ? 'rtl' : dir);
  if (rawFont) {
    const first = splitTopLevel(rawFont, ',')[0]?.trim() ?? '';
    const matched = findAllowedFont(first);
    if (matched) {
      fontFamily = matched;
    } else {
      styleParts.push(`font-family:${rawFont}`);
    }
  }
  if (!styleParts.some((p) => p.startsWith('font-family:'))) {
    styleParts.push(`font-family:'${fontFamily}'`);
  }

  // Font size
  const fontSize =
    resolveLengthToPx(styles.get('font-size'), box.width, ctx.artboardWidth, ctx.artboardHeight) ??
    HEADING_DEFAULTS[tag]?.fontSize ??
    24;
  styleParts.push(`font-size:${clampQuantized(fontSize, 1, 1000)}px`);

  // Font weight
  const fontWeight = styles.get('font-weight') ?? `${HEADING_DEFAULTS[tag]?.fontWeight ?? 400}`;
  styleParts.push(`font-weight:${fontWeight}`);

  // Font style & decoration
  if (
    styles.get('font-style')?.toLowerCase() === 'italic' ||
    tag === 'i' ||
    tag === 'em' ||
    tag === 'blockquote'
  ) {
    styleParts.push('font-style:italic');
  }
  const textDec = (
    styles.get('text-decoration') ??
    styles.get('text-decoration-line') ??
    ''
  ).toLowerCase();
  if (textDec.includes('underline') || tag === 'u') {
    styleParts.push('text-decoration:underline');
  }

  // Color
  const colorNorm = normalizeColor(styles.get('color') ?? '#ffffff') ?? '#ffffff';
  styleParts.push(`color:${colorNorm}`);

  // Text align
  const rawAlign = styles.get('text-align')?.toLowerCase();
  let align = dir === 'rtl' ? 'right' : 'left';
  if (
    rawAlign === 'left' ||
    rawAlign === 'center' ||
    rawAlign === 'right' ||
    rawAlign === 'justify'
  ) {
    align = rawAlign;
  } else if (rawAlign === 'start') {
    align = dir === 'rtl' ? 'right' : 'left';
  } else if (rawAlign === 'end') {
    align = dir === 'rtl' ? 'left' : 'right';
  }
  styleParts.push(`text-align:${align}`);

  // Line height
  const rawLh = styles.get('line-height')?.trim().toLowerCase();
  let lineHeight = 1.25;
  if (rawLh && rawLh !== 'normal') {
    if (rawLh.endsWith('%')) {
      const pct = Number.parseFloat(rawLh.slice(0, -1));
      if (Number.isFinite(pct) && pct > 0) lineHeight = clampQuantized(pct / 100, 0.5, 5);
    } else if (rawLh.endsWith('px') || rawLh.endsWith('rem') || rawLh.endsWith('em')) {
      const pxLh = resolveLengthToPx(
        rawLh,
        fontSize,
        ctx.artboardWidth,
        ctx.artboardHeight,
        fontSize,
      );
      if (pxLh !== null && pxLh > 0)
        lineHeight = clampQuantized(pxLh / Math.max(1, fontSize), 0.5, 5);
    } else {
      const num = Number.parseFloat(rawLh);
      if (Number.isFinite(num) && num > 0) lineHeight = clampQuantized(num, 0.5, 5);
    }
  }
  styleParts.push(`line-height:${lineHeight}`);

  // Letter spacing
  const rawLs = styles.get('letter-spacing')?.trim();
  if (rawLs && rawLs.toLowerCase() !== 'normal') {
    const pxLs = resolveLengthToPx(
      rawLs,
      fontSize,
      ctx.artboardWidth,
      ctx.artboardHeight,
      fontSize,
    );
    if (pxLs !== null) {
      styleParts.push(`letter-spacing:${clampQuantized(pxLs, -50, 200)}px`);
    }
  }

  // Text transform
  const rawTt = styles.get('text-transform')?.trim().toLowerCase();
  if (
    rawTt === 'uppercase' ||
    rawTt === 'lowercase' ||
    rawTt === 'capitalize' ||
    rawTt === 'none'
  ) {
    styleParts.push(`text-transform:${rawTt}`);
  }

  // Text shadow
  const rawTs = styles.get('text-shadow')?.trim();
  if (rawTs && rawTs.toLowerCase() !== 'none') {
    styleParts.push(`text-shadow:${rawTs}`);
  }

  const dirAttr =
    getAttr(node, 'dir') !== undefined || styles.has('direction') || hasAr ? ` dir="${dir}"` : '';

  return `<div ${attrs}${dirAttr} style="${escapeAttr(styleParts.join(';'))}">${innerHtml}</div>`;
}

function buildImageLayerHtml(
  node: HtmlNode & { tagName: string },
  styles: ReadonlyMap<string, string>,
  box: BoxBox,
  rotation: number,
  opacity: number,
  resolvedSrc: string,
  ctx: TraversalContext,
): string {
  const attrs = buildEnvelopeAttrs(node, 'image', 'image', 'Image', ctx);
  const styleParts = buildCommonStyleParts(box, rotation, opacity, true);

  const fitRaw = (styles.get('object-fit') ?? styles.get('background-size') ?? 'cover')
    .trim()
    .toLowerCase();
  const fit = fitRaw === 'contain' || fitRaw === 'fill' ? fitRaw : 'cover';
  styleParts.push(`object-fit:${fit}`);

  const posRaw = styles.get('object-position');
  if (posRaw) {
    styleParts.push(`object-position:${posRaw.trim()}`);
  }

  const borderStr = extractCanonicalBorderString(styles, ctx);
  if (borderStr) styleParts.push(`border:${borderStr}`);

  const rawRadius = styles.get('border-radius');
  if (rawRadius) {
    const firstCorner = splitTopLevel(rawRadius.split('/')[0]!.trim(), ' ')[0]?.trim() ?? '';
    if (firstCorner.endsWith('%')) {
      const pct = Number.parseFloat(firstCorner.slice(0, -1));
      if (Number.isFinite(pct) && pct > 0) {
        styleParts.push(
          `border-radius:${quantize((Math.min(box.width, box.height) * pct) / 100)}px`,
        );
      }
    } else {
      const pxR = resolveLengthToPx(firstCorner, box.width, ctx.artboardWidth, ctx.artboardHeight);
      if (pxR !== null && pxR > 0) styleParts.push(`border-radius:${pxR}px`);
    }
  }

  const rawShadow = styles.get('box-shadow');
  if (
    rawShadow &&
    rawShadow.trim().toLowerCase() !== 'none' &&
    !rawShadow.toLowerCase().includes('inset')
  ) {
    styleParts.push(`box-shadow:${rawShadow.trim()}`);
  }

  const alt = getAttr(node, 'alt');
  const prompt = getAttr(node, 'data-prompt');
  const extraAttrs = [
    `src="${escapeAttr(resolvedSrc)}"`,
    ...(alt !== undefined ? [`alt="${escapeAttr(alt)}"`] : []),
    ...(prompt !== undefined ? [`data-prompt="${escapeAttr(prompt)}"`] : []),
  ].join(' ');

  return `<img ${attrs} ${extraAttrs} style="${escapeAttr(styleParts.join(';'))}">`;
}

function buildCustomSvgShapeLayerHtml(
  node: HtmlNode & { tagName: string },
  shapeKind: string,
  styles: ReadonlyMap<string, string>,
  box: BoxBox,
  rotation: number,
  opacity: number,
  ctx: TraversalContext,
): string {
  const attrs = buildEnvelopeAttrs(node, 'svg', 'shape', 'Vector Shape', ctx);
  const styleParts = buildCommonStyleParts(box, rotation, opacity, true);

  const rawBg = styles.get('background') ?? styles.get('background-color') ?? '#38bdf8';
  const dummyWarnings: Warning[] = [];
  const fill = parseFill(stripCssUrlsFromBackground(rawBg) || '#38bdf8', {
    warnings: dummyWarnings,
    path: 'import',
    dir: ctx.dir,
  });

  const borderStr = extractCanonicalBorderString(styles, ctx);
  let strokeColor: string | undefined;
  let strokeWidth = 0;
  if (borderStr) {
    const bParts = borderStr.split(' ');
    strokeWidth = parsePx(bParts[0] ?? '0') ?? 0;
    strokeColor = bParts[2];
  }

  const gradId = `grad_${ctx.layerCounter.value}`;
  const innerSvg = buildShapeSvgInner(shapeKind, fill, strokeColor, strokeWidth, gradId);

  return `<svg ${attrs} viewBox="0 0 100 100" style="${escapeAttr(styleParts.join(';'))}">${innerSvg}</svg>`;
}

function emitLayersFromElement(
  node: HtmlNode & { tagName: string },
  ctx: TraversalContext,
  flowCursorY: number,
  overrideBox?: BoxBox,
): { layers: string[]; nextFlowY: number } {
  const tag = node.tagName.toLowerCase();

  // Check forbidden / ignored tags
  if (IGNORED_HEAD_OR_SCRIPT_TAGS.has(tag)) {
    pushWarning(
      ctx.warnings,
      'UNKNOWN_TAG_DROPPED',
      `Dropped unsupported tag <${tag}>`,
      `artboard.${tag}`,
    );
    return { layers: [], nextFlowY: flowCursorY };
  }

  const styles = computeMergedStyles(node, ctx.cssRules, ctx.cssVariables, ctx.inheritedStyles);
  if (styles.get('display')?.trim().toLowerCase() === 'none') {
    return { layers: [], nextFlowY: flowCursorY };
  }

  // 1. Check CSS border-hack triangle
  const cssTriangle = isCssBorderTriangle(styles);
  if (cssTriangle) {
    const triBox: BoxBox = overrideBox ?? {
      left: quantize(
        ctx.parentBox.left +
          (resolveLengthToPx(
            styles.get('left'),
            ctx.parentBox.width,
            ctx.artboardWidth,
            ctx.artboardHeight,
          ) ?? 0),
      ),
      top: quantize(
        ctx.parentBox.top +
          (resolveLengthToPx(
            styles.get('top'),
            ctx.parentBox.height,
            ctx.artboardWidth,
            ctx.artboardHeight,
          ) ?? flowCursorY),
      ),
      width: quantize(cssTriangle.width),
      height: quantize(cssTriangle.height),
    };
    const triStyles = new Map(styles);
    triStyles.set('background-color', cssTriangle.color);
    const svgLayer = buildCustomSvgShapeLayerHtml(
      node,
      `triangle-${cssTriangle.direction}`,
      triStyles,
      triBox,
      (ctx.rotation + parseRotationFromTransform(styles.get('transform'))) % 360,
      ctx.opacity * (Number.parseFloat(styles.get('opacity') ?? '1') || 1),
      ctx,
    );
    return { layers: [svgLayer], nextFlowY: flowCursorY + triBox.height };
  }

  const computed = overrideBox
    ? { box: overrideBox, advancesFlow: true, nextFlowY: flowCursorY + overrideBox.height }
    : computeElementBox(node, styles, ctx, flowCursorY);
  const box = computed.box;

  const localOpacity = Number.parseFloat(styles.get('opacity') ?? '1');
  const effectiveOpacity = clampQuantized(
    ctx.opacity * (Number.isFinite(localOpacity) ? clamp(localOpacity, 0, 1) : 1),
    0,
    1,
  );
  const effectiveRotation = normalizeAngle(
    ctx.rotation + parseRotationFromTransform(styles.get('transform')),
  );

  const explicitType = getAttr(node, 'data-type')?.trim().toLowerCase();

  // 2. Direct <svg> element
  if (tag === 'svg' || explicitType === 'svg') {
    const attrs = buildEnvelopeAttrs(node, 'svg', 'svg', 'Vector', ctx);
    const styleParts = buildCommonStyleParts(box, effectiveRotation, effectiveOpacity, true);
    const viewBox =
      getAttr(node, 'viewBox') ??
      getAttr(node, 'viewbox') ??
      `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`;
    const inner = (node.childNodes ?? [])
      .map((c) => serializeSvgNode(c, ctx.cssVariables))
      .join('');
    return {
      layers: [
        `<svg ${attrs} viewBox="${escapeAttr(viewBox)}" style="${escapeAttr(styleParts.join(';'))}">${inner}</svg>`,
      ],
      nextFlowY: computed.nextFlowY,
    };
  }

  // 3. Direct <img> or <picture> or <video poster="...">
  if (tag === 'img' || tag === 'picture' || explicitType === 'image') {
    let targetImgNode: HtmlNode & { tagName: string } = node;
    if (tag === 'picture') {
      const innerImg = (node.childNodes ?? []).find(
        (c): c is HtmlNode & { tagName: string } =>
          isElement(c) && c.tagName.toLowerCase() === 'img',
      );
      if (innerImg) targetImgNode = innerImg;
    }
    const rawSrc =
      getAttr(targetImgNode, 'src') ??
      getAttr(targetImgNode, 'data-src') ??
      getAttr(targetImgNode, 'poster') ??
      '';
    const resolvedSrc =
      registerDataUriAsset(rawSrc, ctx.assets) ?? extractBackgroundImageAsset(styles, ctx.assets);
    if (resolvedSrc) {
      return {
        layers: [
          buildImageLayerHtml(
            targetImgNode,
            styles,
            box,
            effectiveRotation,
            effectiveOpacity,
            resolvedSrc,
            ctx,
          ),
        ],
        nextFlowY: computed.nextFlowY,
      };
    }
    // If external/unresolved image URL, convert to a placeholder shape layer with warning
    pushWarning(
      ctx.warnings,
      'ASSET_UNRESOLVED',
      `Image source "${rawSrc}" is external or unresolved; converted to shape placeholder`,
      `artboard.${tag}`,
    );
    const placeholderStyles = new Map(styles);
    if (!placeholderStyles.has('background') && !placeholderStyles.has('background-color')) {
      placeholderStyles.set('background-color', '#334155');
    }
    return {
      layers: [
        buildShapeLayerHtml(node, placeholderStyles, box, effectiveRotation, effectiveOpacity, ctx),
      ],
      nextFlowY: computed.nextFlowY,
    };
  }

  // 4. Explicit canonical text or shape layer
  if (explicitType === 'text') {
    const inner = serializeInlineContent(node, ctx.cssRules, ctx.cssVariables);
    return {
      layers: [
        buildTextLayerHtml(
          node,
          styles,
          box,
          effectiveRotation,
          effectiveOpacity,
          inner,
          textOf(node),
          ctx,
        ),
      ],
      nextFlowY: computed.nextFlowY,
    };
  }

  if (explicitType === 'shape' || tag === 'hr') {
    const namedShape = detectNamedShape(node, styles);
    if (namedShape) {
      return {
        layers: [
          buildCustomSvgShapeLayerHtml(
            node,
            namedShape,
            styles,
            box,
            effectiveRotation,
            effectiveOpacity,
            ctx,
          ),
        ],
        nextFlowY: computed.nextFlowY,
      };
    }
    return {
      layers: [buildShapeLayerHtml(node, styles, box, effectiveRotation, effectiveOpacity, ctx)],
      nextFlowY: computed.nextFlowY,
    };
  }

  // 5. General / Compound HTML Elements (div, section, header, footer, article, h1-h6, p, button, a, ul, ol, table, blockquote, span, etc.)
  const emitted: string[] = [];
  const namedShape = detectNamedShape(node, styles);
  const bgAsset = extractBackgroundImageAsset(styles, ctx.assets);
  const hasBox = hasVisualBox(styles) || namedShape !== null;

  // If element has a visual box or named shape, emit its background shape/svg first!
  if (namedShape) {
    emitted.push(
      buildCustomSvgShapeLayerHtml(
        node,
        namedShape,
        styles,
        box,
        effectiveRotation,
        effectiveOpacity,
        ctx,
      ),
    );
  } else if (hasBox) {
    emitted.push(buildShapeLayerHtml(node, styles, box, effectiveRotation, effectiveOpacity, ctx));
  }

  // If element has a CSS background-image, emit an image layer on top of the box
  if (bgAsset) {
    emitted.push(
      buildImageLayerHtml(node, styles, box, effectiveRotation, effectiveOpacity, bgAsset, ctx),
    );
  }

  // Check if element is leaf text (contains only text / inline tags)
  const isPureInlineText = hasOnlyInlineOrTextChildren(node, ctx.cssRules, ctx.cssVariables);
  if (isPureInlineText) {
    const fontSize =
      resolveLengthToPx(
        styles.get('font-size'),
        box.width,
        ctx.artboardWidth,
        ctx.artboardHeight,
      ) ??
      HEADING_DEFAULTS[tag]?.fontSize ??
      20;
    const pad = parseBoxSides(
      styles,
      'padding',
      box.width,
      box.height,
      ctx.artboardWidth,
      ctx.artboardHeight,
      fontSize,
    );

    // If this element also emitted a box (e.g. <button>, .badge, .card with text), inset the text box by padding
    const textBox: BoxBox = hasBox
      ? {
          left: quantize(box.left + pad.left),
          top: quantize(
            box.top + (pad.top > 0 ? pad.top : Math.max(0, (box.height - fontSize * 1.25) / 2)),
          ),
          width: quantize(Math.max(10, box.width - pad.left - pad.right)),
          height: quantize(Math.max(10, box.height - pad.top - pad.bottom)),
        }
      : box;

    const innerHtml = serializeInlineContent(node, ctx.cssRules, ctx.cssVariables);
    if (innerHtml.trim().length > 0) {
      emitted.push(
        buildTextLayerHtml(
          node,
          styles,
          textBox,
          effectiveRotation,
          effectiveOpacity,
          innerHtml,
          textOf(node),
          ctx,
        ),
      );
    }
    return { layers: emitted, nextFlowY: computed.nextFlowY };
  }

  // 6. Container with child elements (Flexbox, Grid, List, Table, or Block flow)
  const fontSize =
    resolveLengthToPx(styles.get('font-size'), box.width, ctx.artboardWidth, ctx.artboardHeight) ??
    16;
  const pad = parseBoxSides(
    styles,
    'padding',
    box.width,
    box.height,
    ctx.artboardWidth,
    ctx.artboardHeight,
    fontSize,
  );
  const contentBox: BoxBox = {
    left: quantize(box.left + pad.left),
    top: quantize(box.top + pad.top),
    width: quantize(Math.max(10, box.width - pad.left - pad.right)),
    height: quantize(Math.max(10, box.height - pad.top - pad.bottom)),
  };

  const childCtx: TraversalContext = {
    ...ctx,
    parentBox: contentBox,
    inheritedStyles: styles,
    dir:
      (getAttr(node, 'dir')?.toLowerCase() as 'ltr' | 'rtl' | undefined) ??
      (styles.get('direction')?.toLowerCase() as 'ltr' | 'rtl' | undefined) ??
      ctx.dir,
    opacity: effectiveOpacity,
    rotation: effectiveRotation,
  };

  // Handle <table> layout
  if (tag === 'table') {
    const rows: Array<HtmlNode & { tagName: string }> = [];
    const collectRows = (n: HtmlNode): void => {
      for (const c of n.childNodes ?? []) {
        if (!isElement(c)) continue;
        const ct = c.tagName.toLowerCase();
        if (ct === 'tr') rows.push(c);
        else if (ct === 'thead' || ct === 'tbody' || ct === 'tfoot') collectRows(c);
      }
    };
    collectRows(node);
    if (rows.length > 0) {
      const rowH = contentBox.height / rows.length;
      rows.forEach((tr, rIdx) => {
        const cells = (tr.childNodes ?? []).filter(
          (c): c is HtmlNode & { tagName: string } =>
            isElement(c) && (c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th'),
        );
        if (cells.length === 0) return;
        const colW = contentBox.width / cells.length;
        cells.forEach((cell, cIdx) => {
          const cellBox: BoxBox = {
            left: quantize(contentBox.left + cIdx * colW),
            top: quantize(contentBox.top + rIdx * rowH),
            width: quantize(colW),
            height: quantize(rowH),
          };
          const res = emitLayersFromElement(cell, childCtx, 0, cellBox);
          emitted.push(...res.layers);
        });
      });
    }
    return { layers: emitted, nextFlowY: computed.nextFlowY };
  }

  const display = styles.get('display')?.trim().toLowerCase() ?? 'block';
  const gapPx =
    resolveLengthToPx(
      styles.get('gap') ?? styles.get('row-gap') ?? styles.get('column-gap'),
      contentBox.width,
      ctx.artboardWidth,
      ctx.artboardHeight,
      fontSize,
    ) ?? 0;

  const childElements = (node.childNodes ?? []).filter((c): c is HtmlNode & { tagName: string } =>
    isElement(c),
  );

  // Also preserve any direct stray text nodes inside a mixed container
  for (const rawChild of node.childNodes ?? []) {
    if (rawChild.nodeName === '#text' && (rawChild.value ?? '').trim().length > 0) {
      const txtVal = (rawChild.value ?? '').trim();
      const synthNode: HtmlNode & { tagName: string } = {
        nodeName: 'span',
        tagName: 'span',
        attrs: [],
        childNodes: [{ nodeName: '#text', value: txtVal }],
      };
      const synthBox: BoxBox = {
        left: contentBox.left,
        top: contentBox.top,
        width: contentBox.width,
        height: estimateTextHeight(txtVal, contentBox.width, fontSize, 1.25),
      };
      emitted.push(
        buildTextLayerHtml(
          synthNode,
          styles,
          synthBox,
          effectiveRotation,
          effectiveOpacity,
          escapeText(txtVal),
          txtVal,
          childCtx,
        ),
      );
    }
  }

  // Handle CSS Grid layout
  if (display === 'grid' || display === 'inline-grid') {
    const colsRaw = styles.get('grid-template-columns') ?? '1fr';
    let numCols = 1;
    const repeatMatch = /repeat\(\s*(\d+)\s*,/i.exec(colsRaw);
    if (repeatMatch) {
      numCols = Math.max(1, Number.parseInt(repeatMatch[1]!, 10));
    } else {
      numCols = Math.max(1, splitTopLevel(colsRaw, ' ').filter(Boolean).length);
    }
    const flowChildren = childElements.filter((c) => {
      const cs = computeMergedStyles(c, ctx.cssRules, ctx.cssVariables, styles);
      const pos = cs.get('position')?.toLowerCase();
      return pos !== 'absolute' && pos !== 'fixed';
    });
    const absChildren = childElements.filter((c) => !flowChildren.includes(c));

    const numRows = Math.max(1, Math.ceil(flowChildren.length / numCols));
    const colW = (contentBox.width - gapPx * (numCols - 1)) / numCols;
    const rowH = (contentBox.height - gapPx * (numRows - 1)) / numRows;

    flowChildren.forEach((child, idx) => {
      const col = idx % numCols;
      const row = Math.floor(idx / numCols);
      const cellBox: BoxBox = {
        left: quantize(contentBox.left + col * (colW + gapPx)),
        top: quantize(contentBox.top + row * (rowH + gapPx)),
        width: quantize(Math.max(10, colW)),
        height: quantize(Math.max(10, rowH)),
      };
      const res = emitLayersFromElement(child, childCtx, 0, cellBox);
      emitted.push(...res.layers);
    });

    for (const absChild of absChildren) {
      const res = emitLayersFromElement(absChild, childCtx, 0);
      emitted.push(...res.layers);
    }

    return { layers: emitted, nextFlowY: computed.nextFlowY };
  }

  // Handle Flexbox layout
  if (display === 'flex' || display === 'inline-flex') {
    const flexDir = styles.get('flex-direction')?.trim().toLowerCase() ?? 'row';
    const isRow = flexDir === 'row' || flexDir === 'row-reverse';
    const justify = styles.get('justify-content')?.trim().toLowerCase() ?? 'flex-start';
    const alignItems = styles.get('align-items')?.trim().toLowerCase() ?? 'stretch';

    const flowChildren = childElements.filter((c) => {
      const cs = computeMergedStyles(c, ctx.cssRules, ctx.cssVariables, styles);
      const pos = cs.get('position')?.toLowerCase();
      return pos !== 'absolute' && pos !== 'fixed';
    });
    const absChildren = childElements.filter((c) => !flowChildren.includes(c));

    if (flowChildren.length > 0) {
      if (isRow) {
        const defaultChildW =
          (contentBox.width - gapPx * (flowChildren.length - 1)) / flowChildren.length;
        const measured = flowChildren.map((c) => {
          const cs = computeMergedStyles(c, ctx.cssRules, ctx.cssVariables, styles);
          const w =
            resolveLengthToPx(
              cs.get('width'),
              contentBox.width,
              ctx.artboardWidth,
              ctx.artboardHeight,
            ) ?? defaultChildW;
          const h =
            resolveLengthToPx(
              cs.get('height'),
              contentBox.height,
              ctx.artboardWidth,
              ctx.artboardHeight,
            ) ?? (alignItems === 'stretch' ? contentBox.height : Math.min(contentBox.height, 80));
          return { node: c, w, h };
        });

        const totalW = measured.reduce((acc, m) => acc + m.w, 0) + gapPx * (measured.length - 1);
        let curX = contentBox.left;
        let stepGap = gapPx;

        if (justify === 'center') {
          curX = contentBox.left + (contentBox.width - totalW) / 2;
        } else if (justify === 'flex-end' || justify === 'end') {
          curX = contentBox.left + contentBox.width - totalW;
        } else if (justify === 'space-between' && measured.length > 1) {
          const sumW = measured.reduce((acc, m) => acc + m.w, 0);
          stepGap = (contentBox.width - sumW) / (measured.length - 1);
        }

        for (const item of measured) {
          let curY = contentBox.top;
          if (alignItems === 'center') {
            curY = contentBox.top + (contentBox.height - item.h) / 2;
          } else if (alignItems === 'flex-end' || alignItems === 'end') {
            curY = contentBox.top + contentBox.height - item.h;
          }
          const itemBox: BoxBox = {
            left: quantize(curX),
            top: quantize(curY),
            width: quantize(Math.max(10, item.w)),
            height: quantize(Math.max(10, item.h)),
          };
          const res = emitLayersFromElement(item.node, childCtx, 0, itemBox);
          emitted.push(...res.layers);
          curX += item.w + stepGap;
        }
      } else {
        // Column flex
        const measured = flowChildren.map((c) => {
          const cs = computeMergedStyles(c, ctx.cssRules, ctx.cssVariables, styles);
          const comp = computeElementBox(c, cs, childCtx, 0);
          return { node: c, w: comp.box.width, h: comp.box.height };
        });
        const totalH = measured.reduce((acc, m) => acc + m.h, 0) + gapPx * (measured.length - 1);
        let curY = contentBox.top;
        let stepGap = gapPx;

        if (justify === 'center') {
          curY = contentBox.top + Math.max(0, (contentBox.height - totalH) / 2);
        } else if (justify === 'flex-end' || justify === 'end') {
          curY = contentBox.top + Math.max(0, contentBox.height - totalH);
        } else if (justify === 'space-between' && measured.length > 1) {
          const sumH = measured.reduce((acc, m) => acc + m.h, 0);
          stepGap = Math.max(gapPx, (contentBox.height - sumH) / (measured.length - 1));
        }

        for (const item of measured) {
          let curX = contentBox.left;
          const itemW = alignItems === 'stretch' ? contentBox.width : item.w;
          if (alignItems === 'center') {
            curX = contentBox.left + (contentBox.width - itemW) / 2;
          } else if (alignItems === 'flex-end' || alignItems === 'end') {
            curX = contentBox.left + contentBox.width - itemW;
          }
          const itemBox: BoxBox = {
            left: quantize(curX),
            top: quantize(curY),
            width: quantize(Math.max(10, itemW)),
            height: quantize(Math.max(10, item.h)),
          };
          const res = emitLayersFromElement(item.node, childCtx, 0, itemBox);
          emitted.push(...res.layers);
          curY += item.h + stepGap;
        }
      }
    }

    for (const absChild of absChildren) {
      const res = emitLayersFromElement(absChild, childCtx, 0);
      emitted.push(...res.layers);
    }

    return { layers: emitted, nextFlowY: computed.nextFlowY };
  }

  // Standard block flow for children (including <ul> / <ol> list items)
  let childCursorY = 0;
  let listItemIndex = 0;
  for (const child of childElements) {
    const childTag = child.tagName.toLowerCase();
    if ((tag === 'ul' || tag === 'ol') && childTag === 'li') {
      listItemIndex += 1;
      const prefix = tag === 'ol' ? `${listItemIndex}. ` : '• ';
      // Prepend bullet/number to the first text node if not already present
      const firstText = readableText(child);
      if (firstText && !firstText.startsWith('•') && !/^\d+\./.test(firstText)) {
        child.childNodes = [{ nodeName: '#text', value: prefix }, ...(child.childNodes ?? [])];
      }
    }
    const res = emitLayersFromElement(child, childCtx, childCursorY);
    emitted.push(...res.layers);
    childCursorY = res.nextFlowY + gapPx;
  }

  return { layers: emitted, nextFlowY: computed.nextFlowY };
}

export function importDesignDocument(
  input: string,
  options: ImportDesignOptions = {},
): ImportDesignOutput {
  const bytes = new TextEncoder().encode(input).byteLength;
  if (bytes > MAX_IMPORT_BYTES) {
    throw new LimitExceededError(`Imported HTML exceeds ${MAX_IMPORT_BYTES} bytes`, 'import', {
      bytes,
      maxBytes: MAX_IMPORT_BYTES,
    });
  }

  const root = parse5.parse(input) as unknown as HtmlNode;
  attachParents(root);

  const { rules: cssRules, vars: cssVariables } = extractStylesheetRules(root);

  const explicitArtboard = findExplicitArtboard(root);
  const artboard = options.strict
    ? explicitArtboard
    : findFlexibleArtboard(root, cssRules, cssVariables);

  if (!artboard) {
    throw new DesignError('INVALID_DOC', 'Design HTML must contain a .artboard root', 'artboard');
  }

  // Check if there is no explicit .artboard and the only container is <body> with a bare <p> when strict
  const isExplicitArtboard = explicitArtboard !== null;

  const artboardStyles = computeMergedStyles(artboard, cssRules, cssVariables);

  const rawWidth =
    getAttr(artboard, 'data-width') ?? getAttr(artboard, 'width') ?? artboardStyles.get('width');
  const rawHeight =
    getAttr(artboard, 'data-height') ?? getAttr(artboard, 'height') ?? artboardStyles.get('height');

  const defaultW = options.defaultWidth ?? 1080;
  const defaultH = options.defaultHeight ?? 1080;

  let width: number | null = rawWidth ? parsePx(rawWidth) : null;
  let height: number | null = rawHeight ? parsePx(rawHeight) : null;

  if (options.strict && (width === null || height === null)) {
    throw new DesignError('INVALID_DOC', 'Artboard width and height must be in px', 'artboard');
  }

  // If rawWidth or rawHeight is in non-px units (like %, vw, vh, rem) or omitted:
  if (width === null) {
    if (rawWidth) {
      width = resolveLengthToPx(rawWidth, defaultW, defaultW, defaultH) ?? defaultW;
    } else {
      width = defaultW;
    }
  }
  if (height === null) {
    if (rawHeight) {
      height = resolveLengthToPx(rawHeight, defaultH, width, defaultH) ?? defaultH;
    } else {
      // Check aspect-ratio property (e.g. "4 / 5" or "16 / 9" or "1")
      const arRaw = artboardStyles.get('aspect-ratio');
      if (arRaw) {
        const arParts = arRaw.split('/').map((s) => Number.parseFloat(s.trim()));
        if (
          arParts.length === 2 &&
          Number.isFinite(arParts[0]) &&
          Number.isFinite(arParts[1]) &&
          arParts[0]! > 0 &&
          arParts[1]! > 0
        ) {
          height = quantize((width * arParts[1]!) / arParts[0]!);
        } else if (arParts.length === 1 && Number.isFinite(arParts[0]) && arParts[0]! > 0) {
          height = quantize(width / arParts[0]!);
        }
      }
      if (height === null) {
        height = defaultH;
      }
    }
  }

  width = clampQuantized(width, LIMITS.document.minArtboardSide, LIMITS.document.maxArtboardSide);
  height = clampQuantized(height, LIMITS.document.minArtboardSide, LIMITS.document.maxArtboardSide);

  // Also check body background if artboard itself has no background
  const findBody = (n: HtmlNode): (HtmlNode & { tagName: string }) | null => {
    if (isElement(n) && n.tagName.toLowerCase() === 'body') return n;
    for (const c of n.childNodes ?? []) {
      const f = findBody(c);
      if (f) return f;
    }
    return null;
  };
  const bodyNode = findBody(root);
  const bodyStyles = bodyNode
    ? computeMergedStyles(bodyNode, cssRules, cssVariables)
    : new Map<string, string>();

  const rawArtboardBg =
    artboardStyles.get('background') ??
    artboardStyles.get('background-color') ??
    bodyStyles.get('background') ??
    bodyStyles.get('background-color') ??
    '#ffffff';
  const cleanedArtboardBg = stripCssUrlsFromBackground(rawArtboardBg) || '#ffffff';

  const htmlNode = (root.childNodes ?? []).find(
    (c): c is HtmlNode & { tagName: string } => isElement(c) && c.tagName.toLowerCase() === 'html',
  );
  const rootDirRaw = (
    getAttr(artboard, 'dir') ??
    artboardStyles.get('direction') ??
    (bodyNode ? getAttr(bodyNode, 'dir') : undefined) ??
    (htmlNode ? getAttr(htmlNode, 'dir') : undefined) ??
    'ltr'
  ).toLowerCase();
  const rootDir: 'ltr' | 'rtl' = rootDirRaw === 'rtl' ? 'rtl' : 'ltr';

  const warnings: Warning[] = [];
  const assets: ImportedAsset[] = [];
  const usedIds = new Set<string>();
  const layerCounter = { value: 0 };

  const artboardPad = parseBoxSides(artboardStyles, 'padding', width, height, width, height, 16);

  const traversalCtx: TraversalContext = {
    artboardWidth: width,
    artboardHeight: height,
    parentBox: {
      left: artboardPad.left,
      top: artboardPad.top,
      width: Math.max(10, width - artboardPad.left - artboardPad.right),
      height: Math.max(10, height - artboardPad.top - artboardPad.bottom),
    },
    inheritedStyles: artboardStyles,
    dir: rootDir,
    opacity: 1,
    rotation: 0,
    cssRules,
    cssVariables,
    warnings,
    assets,
    usedIds,
    layerCounter,
  };

  const layerFragments: string[] = [];

  // If the artboard itself has a background-image, emit it as a full-bleed background image layer
  const artboardBgAsset = extractBackgroundImageAsset(artboardStyles, assets);
  if (artboardBgAsset) {
    layerFragments.push(
      buildImageLayerHtml(
        artboard,
        artboardStyles,
        { left: 0, top: 0, width, height },
        0,
        1,
        artboardBgAsset,
        traversalCtx,
      ),
    );
  }

  // Check if artboard itself is a flex/grid container or normal flow container
  const artboardDisplay = artboardStyles.get('display')?.trim().toLowerCase() ?? 'block';
  if (
    !isExplicitArtboard ||
    artboardDisplay === 'flex' ||
    artboardDisplay === 'inline-flex' ||
    artboardDisplay === 'grid' ||
    artboardDisplay === 'inline-grid'
  ) {
    // Use the container layout engine for artboard's children without emitting artboard itself as a shape
    const savedBg = artboardStyles.get('background');
    const savedBgColor = artboardStyles.get('background-color');
    const savedBorder = artboardStyles.get('border');
    const savedShadow = artboardStyles.get('box-shadow');

    let flowY = 0;
    const gapPx = resolveLengthToPx(artboardStyles.get('gap'), width, width, height, 16) ?? 0;

    if (
      artboardDisplay === 'flex' ||
      artboardDisplay === 'inline-flex' ||
      artboardDisplay === 'grid' ||
      artboardDisplay === 'inline-grid'
    ) {
      // Temporarily strip artboard box visual properties so emitLayersFromElement only lays out its children
      const containerProxy: HtmlNode & { tagName: string } = {
        ...artboard,
        tagName: 'div',
        attrs: (artboard.attrs ?? []).filter(
          (a) => !['style', 'class', 'id', 'data-type'].includes(a.name.toLowerCase()),
        ),
      };
      const layoutOnlyStyles = new Map<string, string>();
      for (const [k, v] of artboardStyles) {
        if (
          k.startsWith('flex') ||
          k.startsWith('grid') ||
          k.startsWith('justify') ||
          k.startsWith('align') ||
          k.startsWith('gap') ||
          k.startsWith('row-gap') ||
          k.startsWith('column-gap') ||
          k.startsWith('padding') ||
          k === 'display' ||
          k === 'direction' ||
          INHERITED_TEXT_PROPS.includes(k as (typeof INHERITED_TEXT_PROPS)[number])
        ) {
          layoutOnlyStyles.set(k, v);
        }
      }
      const inlineStr = Array.from(layoutOnlyStyles.entries())
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      containerProxy.attrs = [{ name: 'style', value: inlineStr }];
      const res = emitLayersFromElement(
        containerProxy,
        {
          ...traversalCtx,
          parentBox: { left: 0, top: 0, width, height },
          cssRules: [],
        },
        0,
        { left: 0, top: 0, width, height },
      );
      layerFragments.push(...res.layers);
      void savedBg;
      void savedBgColor;
      void savedBorder;
      void savedShadow;
    } else {
      for (const child of artboard.childNodes ?? []) {
        if (!isElement(child)) continue;
        const res = emitLayersFromElement(child, traversalCtx, flowY);
        layerFragments.push(...res.layers);
        flowY = res.nextFlowY + gapPx;
      }
    }
  } else {
    let flowY = 0;
    const gapPx = resolveLengthToPx(artboardStyles.get('gap'), width, width, height, 16) ?? 0;
    for (const child of artboard.childNodes ?? []) {
      if (!isElement(child)) continue;
      const res = emitLayersFromElement(child, traversalCtx, flowY);
      layerFragments.push(...res.layers);
      flowY = res.nextFlowY + gapPx;
    }
  }

  const canonicalFragment = `<div class="artboard" data-width="${width}px" data-height="${height}px" style="background:${escapeAttr(cleanedArtboardBg)}">${layerFragments.join('')}</div>`;
  const parsed = parseDesignHtml(canonicalFragment);

  return {
    doc: parsed.doc,
    warnings: [...warnings, ...parsed.warnings],
    assets,
  };
}

export const importDesignHtml = importDesignDocument;
