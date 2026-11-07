import { normalizeColor } from './color.js';
import { LimitExceededError, SecurityViolationError } from './errors.js';
import { LIMITS } from './limits.js';
import type { SvgNode, SvgTag, Warning } from './model.js';
import { pushWarning } from './warnings.js';

export const ALLOWED_SVG_TAGS = [
  'svg',
  'g',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'title',
  'desc',
] as const satisfies readonly SvgTag[];

const BANNED_SVG_TAGS = new Set([
  'script',
  'style',
  'foreignobject',
  'use',
  'image',
  'a',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'filter',
  'mask',
  'pattern',
  'marker',
  'clippath',
  'text',
  'tspan',
]);

const CANONICAL_TAGS: Readonly<Record<string, SvgTag>> = {
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

const CANONICAL_ATTRS: Readonly<Record<string, string>> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  'stop-color': 'stop-color',
  'stop-opacity': 'stop-opacity',
  'fill-opacity': 'fill-opacity',
  'stroke-opacity': 'stroke-opacity',
  'stroke-width': 'stroke-width',
  'stroke-linecap': 'stroke-linecap',
  'stroke-linejoin': 'stroke-linejoin',
  'stroke-dasharray': 'stroke-dasharray',
  'stroke-dashoffset': 'stroke-dashoffset',
  'font-family': 'font-family',
  'font-size': 'font-size',
  'text-anchor': 'text-anchor',
  d: 'd',
  x: 'x',
  y: 'y',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  width: 'width',
  height: 'height',
  points: 'points',
  offset: 'offset',
  fill: 'fill',
  stroke: 'stroke',
  opacity: 'opacity',
  transform: 'transform',
  id: 'id',
  fx: 'fx',
  fy: 'fy',
  fr: 'fr',
};

const ALLOWED_ATTRS = new Set(Object.values(CANONICAL_ATTRS));
const PATH_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]*$/;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const LOCAL_URL_RE = /^url\(\s*#([A-Za-z][A-Za-z0-9_-]{0,63})\s*\)$/;

export type SvgContext = {
  warnings: Warning[];
  path: string;
  layerId?: string;
};

function warn(ctx: SvgContext, message: string, path: string): void {
  pushWarning(ctx.warnings, 'SVG_LIMIT', message, `${ctx.path}.${path}`, ctx.layerId);
}

function collectRawIds(nodes: readonly unknown[], ids: Set<string>): void {
  for (const child of nodes) {
    const node = child as {
      tagName?: string;
      attrs?: Array<{ name: string; value: string }>;
      childNodes?: Array<unknown>;
    };
    if (!node.tagName) continue;
    for (const attr of node.attrs ?? []) {
      if (attr.name.toLowerCase() === 'id') ids.add(attr.value);
    }
    if (node.childNodes) collectRawIds(node.childNodes, ids);
  }
}

function validateReference(
  value: string,
  ids: ReadonlySet<string>,
  ctx: SvgContext,
  path: string,
): string | null {
  const match = value.trim().match(LOCAL_URL_RE);
  if (match?.[1]) {
    if (!ids.has(match[1])) {
      warn(ctx, `SVG reference does not resolve: #${match[1]}`, path);
      return null;
    }
    return value.trim();
  }
  if (/url\s*\(/i.test(value)) {
    throw new SecurityViolationError('Only local SVG url(#id) references are allowed', path);
  }
  if (value.trim() === 'none') return 'none';
  return normalizeColor(value);
}

function validatePathData(value: string, ctx: SvgContext, path: string): string | null {
  if (value.length > LIMITS.svg.maxPathLength) {
    throw new LimitExceededError(
      `SVG path exceeds ${LIMITS.svg.maxPathLength} characters`,
      `${ctx.path}.${path}`,
    );
  }
  if (!PATH_RE.test(value)) {
    warn(ctx, 'SVG path contains unsupported characters', path);
    return null;
  }
  return value;
}

function parseSvgElement(
  element: {
    tagName: string;
    attrs: Array<{ name: string; value: string }>;
    childNodes: Array<unknown>;
  },
  ctx: SvgContext,
  depth: number,
  ids: ReadonlySet<string>,
  counter: { value: number },
): SvgNode | null {
  if (depth > LIMITS.svg.maxDepth) {
    throw new LimitExceededError(`SVG nesting exceeds ${LIMITS.svg.maxDepth}`, ctx.path);
  }

  const lowerTag = element.tagName.toLowerCase();
  if (BANNED_SVG_TAGS.has(lowerTag)) {
    throw new SecurityViolationError(`Forbidden SVG tag: ${element.tagName}`, ctx.path);
  }
  const tag = CANONICAL_TAGS[lowerTag];
  if (!tag) {
    warn(ctx, `Unknown SVG tag dropped: ${element.tagName}`, lowerTag);
    return null;
  }

  counter.value += 1;
  if (counter.value > LIMITS.svg.maxNodes) {
    throw new LimitExceededError(`SVG exceeds ${LIMITS.svg.maxNodes} nodes`, ctx.path);
  }

  if (element.attrs.length > LIMITS.svg.maxAttrsPerNode) {
    throw new LimitExceededError(
      `SVG node exceeds ${LIMITS.svg.maxAttrsPerNode} attributes`,
      ctx.path,
    );
  }

  const attrs: Record<string, string> = {};
  for (const attr of element.attrs) {
    const lowerName = attr.name.toLowerCase();
    if (lowerName.startsWith('on')) {
      throw new SecurityViolationError(`Forbidden SVG event attribute: ${attr.name}`, ctx.path);
    }
    if (lowerName === 'href' || lowerName === 'xlink:href' || lowerName === 'style') {
      throw new SecurityViolationError(`Forbidden SVG attribute: ${attr.name}`, ctx.path);
    }
    const canonicalName = CANONICAL_ATTRS[lowerName];
    if (!canonicalName || !ALLOWED_ATTRS.has(canonicalName)) {
      warn(ctx, `Unknown SVG attribute dropped: ${attr.name}`, lowerName);
      continue;
    }
    if (canonicalName === 'id') {
      if (!ID_RE.test(attr.value)) {
        throw new SecurityViolationError(`Invalid SVG id: ${attr.value}`, ctx.path);
      }
      attrs.id = attr.value;
      continue;
    }
    if (canonicalName === 'fill' || canonicalName === 'stroke') {
      const value = validateReference(attr.value, ids, ctx, canonicalName);
      if (value === null) continue;
      attrs[canonicalName] = value;
      continue;
    }
    if (canonicalName === 'd') {
      const value = validatePathData(attr.value, ctx, 'd');
      if (value === null) continue;
      attrs.d = value;
      continue;
    }
    if (canonicalName === 'points') {
      if (!PATH_RE.test(attr.value)) {
        warn(ctx, 'SVG points contain unsupported characters', 'points');
        continue;
      }
      attrs.points = attr.value;
      continue;
    }
    attrs[canonicalName] = attr.value;
  }

  const children: SvgNode[] = [];
  for (const child of element.childNodes) {
    const node = child as {
      nodeName?: string;
      tagName?: string;
      value?: string;
      attrs?: Array<{ name: string; value: string }>;
      childNodes?: Array<unknown>;
    };
    if (node.tagName && node.attrs && node.childNodes) {
      const parsed = parseSvgElement(
        {
          tagName: node.tagName,
          attrs: node.attrs,
          childNodes: node.childNodes,
        },
        ctx,
        depth + 1,
        ids,
        counter,
      );
      if (parsed) children.push(parsed);
    } else if (node.nodeName === '#text') {
      const text = node.value ?? '';
      if (tag !== 'title' && tag !== 'desc') {
        if (text.trim()) warn(ctx, 'SVG text content is only allowed in title/desc', 'text');
        continue;
      }
      if (text) children.push({ kind: 'text', text });
    }
  }

  return { kind: 'element', tag, attrs, children };
}

export function parseSvgNodes(
  element: {
    tagName: string;
    attrs: Array<{ name: string; value: string }>;
    childNodes: Array<unknown>;
  },
  ctx: SvgContext,
): SvgNode[] {
  const ids = new Set<string>();
  collectRawIds(element.childNodes, ids);

  const counter = { value: 0 };
  const result: SvgNode[] = [];
  for (const child of element.childNodes) {
    const node = child as {
      tagName?: string;
      attrs?: Array<{ name: string; value: string }>;
      childNodes?: Array<unknown>;
    };
    if (node.tagName && node.attrs && node.childNodes) {
      const parsed = parseSvgElement(
        {
          tagName: node.tagName,
          attrs: node.attrs,
          childNodes: node.childNodes,
        },
        ctx,
        1,
        ids,
        counter,
      );
      if (parsed) result.push(parsed);
    }
  }
  return result;
}

export function parseViewBox(raw: string | undefined, ctx: SvgContext): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.length > LIMITS.svg.maxViewBoxLength) {
    throw new LimitExceededError('SVG viewBox is too long', ctx.path);
  }
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    warn(ctx, `Invalid SVG viewBox: ${raw}`, 'viewBox');
    return undefined;
  }
  return parts.join(' ');
}
