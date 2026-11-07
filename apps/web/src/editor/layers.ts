import {
  LIMITS,
  type AllowedFont,
  type DesignDoc,
  type ImageLayer,
  type InlineNode,
  type Layer,
  type LayerBase,
  type ShapeLayer,
  type SvgLayer,
  type SvgNode,
  type TextAlign,
  type TextLayer,
  type TextTransform,
} from '@poster/core';
import { inlineLineCount } from './text.js';

export type AlignTarget = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type ReorderMove = 'front' | 'back' | 'forward' | 'backward';
export type ElementKind =
  | 'rectangle'
  | 'rounded'
  | 'circle'
  | 'line'
  | 'ring'
  | 'star'
  | 'check'
  | 'arrow';

export const ELEMENT_LABELS: Record<ElementKind, string> = {
  rectangle: 'مستطيل',
  rounded: 'بطاقة',
  circle: 'دائرة',
  line: 'خط',
  ring: 'إطار دائري',
  star: 'نجمة',
  check: 'علامة صح',
  arrow: 'سهم',
};

export const ELEMENT_KINDS: ElementKind[] = [
  'rectangle',
  'rounded',
  'circle',
  'line',
  'ring',
  'star',
  'check',
  'arrow',
];

function truncate(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

function clampName(name: string): string {
  return truncate(name.trim() || 'Layer', LIMITS.document.maxLayerNameLength);
}

export function uniqueLayerId(doc: DesignDoc, base: string): string {
  const used = new Set(doc.layers.map((layer) => layer.id));
  const cleaned = base
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  let stem = cleaned.length > 0 ? cleaned : 'layer';
  if (!/^[A-Za-z]/.test(stem)) stem = `l-${stem}`;
  stem = stem.slice(0, 60);

  if (!used.has(stem)) return stem;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}-${index}`.slice(0, LIMITS.document.maxLayerIdLength);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique layer id');
}

function baseLayer(
  id: string,
  name: string,
  left: number,
  top: number,
  width: number,
): LayerBase {
  return {
    id,
    name: clampName(name),
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(1, Math.round(width)),
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
  };
}

function centerOffset(doc: DesignDoc, width: number, height: number): { left: number; top: number } {
  const step = (doc.layers.length % 7) * 24;
  return {
    left: (doc.width - width) / 2 + step,
    top: (doc.height - height) / 2 + step,
  };
}

export function canAddLayer(doc: DesignDoc): boolean {
  return doc.layers.length < LIMITS.document.maxLayers;
}

export function addLayer(doc: DesignDoc, layer: Layer): DesignDoc {
  if (!canAddLayer(doc)) return doc;
  return { ...doc, layers: [...doc.layers, layer] };
}

export function updateLayer(
  doc: DesignDoc,
  id: string,
  updater: (layer: Layer) => Layer,
): DesignDoc {
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (layer.id !== id) return layer;
    const next = updater(layer);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

export function updateLayers(
  doc: DesignDoc,
  ids: readonly string[],
  updater: (layer: Layer) => Layer,
): DesignDoc {
  const selected = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (!selected.has(layer.id)) return layer;
    const next = updater(layer);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

export function deleteLayers(doc: DesignDoc, ids: readonly string[]): DesignDoc {
  const selected = new Set(ids);
  if (selected.size === 0) return doc;
  const layers = doc.layers.filter((layer) => !selected.has(layer.id));
  return layers.length === doc.layers.length ? doc : { ...doc, layers };
}

export function duplicateLayers(
  doc: DesignDoc,
  ids: readonly string[],
): { doc: DesignDoc; ids: string[] } {
  const selected = new Set(ids);
  const copies: Layer[] = [];
  const newIds: string[] = [];
  let working = doc;

  for (const layer of doc.layers) {
    if (!selected.has(layer.id)) continue;
    if (!canAddLayer(working)) break;
    const id = uniqueLayerId(working, `${layer.id}-copy`);
    const copy: Layer = {
      ...layer,
      id,
      name: clampName(`${layer.name} copy`),
      left: layer.left + 24,
      top: layer.top + 24,
    };
    working = { ...working, layers: [...working.layers, copy] };
    copies.push(copy);
    newIds.push(id);
  }

  void copies;
  return { doc: working, ids: newIds };
}

export function reorderLayer(doc: DesignDoc, id: string, move: ReorderMove): DesignDoc {
  const index = doc.layers.findIndex((layer) => layer.id === id);
  if (index < 0) return doc;
  const target =
    move === 'front'
      ? doc.layers.length - 1
      : move === 'back'
        ? 0
        : move === 'forward'
          ? Math.min(doc.layers.length - 1, index + 1)
          : Math.max(0, index - 1);
  if (target === index) return doc;
  const layers = doc.layers.slice();
  const [layer] = layers.splice(index, 1);
  if (!layer) return doc;
  layers.splice(target, 0, layer);
  return { ...doc, layers };
}

export function estimatedLayerHeight(layer: Layer): number {
  if ('height' in layer) return layer.height;
  const lines = inlineLineCount(layer.content);
  return Math.max(layer.style.fontSize, layer.style.fontSize * layer.style.lineHeight * lines);
}

export function alignLayers(doc: DesignDoc, ids: readonly string[], target: AlignTarget): DesignDoc {
  const selected = new Set(ids);
  return updateLayers(doc, ids, (layer) => {
    if (!selected.has(layer.id)) return layer;
    const height = estimatedLayerHeight(layer);
    switch (target) {
      case 'left':
        return { ...layer, left: 0 };
      case 'centerX':
        return { ...layer, left: Math.round((doc.width - layer.width) / 2) };
      case 'right':
        return { ...layer, left: Math.round(doc.width - layer.width) };
      case 'top':
        return { ...layer, top: 0 };
      case 'centerY':
        return { ...layer, top: Math.round((doc.height - height) / 2) };
      case 'bottom':
        return { ...layer, top: Math.round(doc.height - height) };
    }
  });
}

export function distributeLayers(
  doc: DesignDoc,
  ids: readonly string[],
  axis: 'horizontal' | 'vertical',
): DesignDoc {
  const selected = new Set(ids);
  const layers = doc.layers.filter((layer) => selected.has(layer.id));
  if (layers.length < 3) return doc;

  const sizeOf = (layer: Layer): number =>
    axis === 'horizontal' ? layer.width : estimatedLayerHeight(layer);
  const startOf = (layer: Layer): number => (axis === 'horizontal' ? layer.left : layer.top);

  const sorted = layers.slice().sort((a, b) => startOf(a) - startOf(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return doc;

  const spanStart = startOf(first);
  const spanEnd = startOf(last) + sizeOf(last);
  const total = sorted.reduce((sum, layer) => sum + sizeOf(layer), 0);
  const gap = (spanEnd - spanStart - total) / (sorted.length - 1);
  if (!Number.isFinite(gap) || gap < 0) return doc;

  const positions = new Map<string, number>();
  let cursor = spanStart;
  for (const layer of sorted) {
    positions.set(layer.id, Math.round(cursor));
    cursor += sizeOf(layer) + gap;
  }

  return updateLayers(doc, ids, (layer) => {
    const position = positions.get(layer.id);
    if (position === undefined) return layer;
    return axis === 'horizontal' ? { ...layer, left: position } : { ...layer, top: position };
  });
}

export function setLayerFlag(
  doc: DesignDoc,
  id: string,
  flag: 'hidden' | 'locked',
  value: boolean,
): DesignDoc {
  return updateLayer(doc, id, (layer) => ({ ...layer, [flag]: value }));
}

export type TextPreset = {
  id: string;
  label: string;
  content: string;
  fontFamily: AllowedFont;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: TextAlign;
  lineHeight: number;
  letterSpacing: number;
  textTransform: TextTransform;
  dir: 'ltr' | 'rtl';
};

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'heading',
    label: 'عنوان رئيسي',
    content: 'عنوان رئيسي',
    fontFamily: 'Cairo',
    fontSize: 96,
    fontWeight: 800,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.15,
    letterSpacing: 0,
    textTransform: 'none',
    dir: 'rtl',
  },
  {
    id: 'subheading',
    label: 'عنوان فرعي',
    content: 'عنوان فرعي',
    fontFamily: 'Cairo',
    fontSize: 52,
    fontWeight: 600,
    color: '#f5a524',
    align: 'center',
    lineHeight: 1.3,
    letterSpacing: 0,
    textTransform: 'none',
    dir: 'rtl',
  },
  {
    id: 'body',
    label: 'نص أساسي',
    content: 'اكتب نصك هنا. اجعل الجملة قصيرة وواضحة.',
    fontFamily: 'IBM Plex Sans Arabic',
    fontSize: 30,
    fontWeight: 400,
    color: '#d6dde5',
    align: 'right',
    lineHeight: 1.65,
    letterSpacing: 0,
    textTransform: 'none',
    dir: 'rtl',
  },
  {
    id: 'quote',
    label: 'اقتباس',
    content: '«الجمال في التفاصيل.»',
    fontFamily: 'Amiri',
    fontSize: 48,
    fontWeight: 400,
    color: '#f4efe6',
    align: 'center',
    lineHeight: 1.5,
    letterSpacing: 0,
    textTransform: 'none',
    dir: 'rtl',
  },
  {
    id: 'label',
    label: 'سطر لاتيني',
    content: 'POSTER STUDIO · 2026',
    fontFamily: 'Inter',
    fontSize: 22,
    fontWeight: 600,
    color: '#93a1af',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 4,
    textTransform: 'uppercase',
    dir: 'ltr',
  },
];

export function createTextPreset(doc: DesignDoc, preset: TextPreset): TextLayer {
  const margin = Math.round(doc.width * 0.08);
  const width = Math.max(120, doc.width - margin * 2);
  const step = (doc.layers.length % 6) * 32;
  const top = Math.round(doc.height * 0.16 + step);
  return {
    ...baseLayer(uniqueLayerId(doc, `text-${preset.id}`), preset.label, margin, top, width),
    type: 'text',
    dir: preset.dir,
    content: [{ kind: 'text', text: preset.content }],
    style: {
      fontFamily: preset.fontFamily,
      fontSize: preset.fontSize,
      fontWeight: preset.fontWeight,
      italic: false,
      underline: false,
      color: preset.color,
      align: preset.align,
      lineHeight: preset.lineHeight,
      letterSpacing: preset.letterSpacing,
      textTransform: preset.textTransform,
    },
  };
}

export function createElementLayer(doc: DesignDoc, kind: ElementKind): Layer {
  const short = Math.min(doc.width, doc.height);
  const id = uniqueLayerId(doc, `el-${kind}`);
  const label = ELEMENT_LABELS[kind];

  if (kind === 'rectangle' || kind === 'rounded') {
    const width = Math.round(doc.width * 0.58);
    const height = Math.round(doc.height * 0.3);
    const position = centerOffset(doc, width, height);
    const style: ShapeLayer['style'] =
      kind === 'rounded'
        ? {
            fill: {
              kind: 'linear',
              angle: 135,
              stops: [
                { color: '#f5a524', pos: 0 },
                { color: '#f26b4a', pos: 100 },
              ],
            },
            radius: 32,
          }
        : { fill: { kind: 'solid', color: '#f5a524' }, radius: 0 };
    return {
      ...baseLayer(id, label, position.left, position.top, width),
      type: 'shape',
      height,
      style,
    };
  }

  if (kind === 'circle' || kind === 'ring') {
    const size = Math.round(short * 0.34);
    const position = centerOffset(doc, size, size);
    const style: ShapeLayer['style'] =
      kind === 'ring'
        ? {
            fill: { kind: 'solid', color: '#00000000' },
            radius: Math.round(size / 2),
            border: { width: Math.round(size * 0.07), style: 'solid', color: '#5aa9ff' },
          }
        : { fill: { kind: 'solid', color: '#5aa9ff' }, radius: Math.round(size / 2) };
    return {
      ...baseLayer(id, label, position.left, position.top, size),
      type: 'shape',
      height: size,
      style,
    };
  }

  if (kind === 'line') {
    const width = Math.round(doc.width * 0.58);
    const position = centerOffset(doc, width, 6);
    return {
      ...baseLayer(id, label, position.left, position.top, width),
      type: 'shape',
      height: 6,
      style: { fill: { kind: 'solid', color: '#f4efe6' }, radius: 3 },
    };
  }

  const size = Math.round(short * 0.28);
  const position = centerOffset(doc, size, size);
  const nodes: SvgNode[] =
    kind === 'star'
      ? [
          {
            kind: 'element',
            tag: 'path',
            attrs: {
              d: 'M50 5 L61 37 L95 37 L67 57 L78 90 L50 70 L22 90 L33 57 L5 37 L39 37 Z',
              fill: '#f5a524',
            },
            children: [],
          },
        ]
      : kind === 'check'
        ? [
            {
              kind: 'element',
              tag: 'circle',
              attrs: { cx: '50', cy: '50', r: '46', fill: '#4ade80' },
              children: [],
            },
            {
              kind: 'element',
              tag: 'path',
              attrs: {
                d: 'M28 52 L45 68 L74 33',
                fill: 'none',
                stroke: '#0b0e12',
                'stroke-width': '9',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
              },
              children: [],
            },
          ]
        : [
            {
              kind: 'element',
              tag: 'path',
              attrs: {
                d: 'M8 50 H78 M58 28 L80 50 L58 72',
                fill: 'none',
                stroke: '#f26b4a',
                'stroke-width': '10',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
              },
              children: [],
            },
          ];

  return {
    ...baseLayer(id, label, position.left, position.top, size),
    type: 'svg',
    height: size,
    viewBox: '0 0 100 100',
    nodes,
  };
}

export function createImageLayer(
  doc: DesignDoc,
  assetId: string,
  width: number,
  height: number,
  name: string,
  alt?: string,
): ImageLayer {
  const position = centerOffset(doc, width, height);
  return {
    ...baseLayer(uniqueLayerId(doc, 'image'), name, position.left, position.top, width),
    type: 'image',
    height,
    src: `asset:${assetId}`,
    ...(alt === undefined ? {} : { alt }),
    style: {
      fit: 'cover',
      position: { x: 50, y: 50 },
      radius: 24,
    },
  };
}

export function createSvgLayer(
  doc: DesignDoc,
  name: string,
  nodes: SvgNode[],
  width: number,
  height: number,
): SvgLayer {
  const position = centerOffset(doc, width, height);
  return {
    ...baseLayer(uniqueLayerId(doc, 'svg'), name, position.left, position.top, width),
    type: 'svg',
    height,
    viewBox: '0 0 100 100',
    nodes,
  };
}

export function applyFontToTextLayers(
  doc: DesignDoc,
  ids: readonly string[],
  fontFamily: AllowedFont,
): DesignDoc {
  return updateLayers(doc, ids, (layer) =>
    layer.type === 'text' ? { ...layer, style: { ...layer.style, fontFamily } } : layer,
  );
}

export function replaceTextContent(doc: DesignDoc, id: string, content: InlineNode[]): DesignDoc {
  return updateLayer(doc, id, (layer) => (layer.type === 'text' ? { ...layer, content } : layer));
}

/** Used by tests and by the AI panel to build a stable layer summary. */
export function layerSummary(layer: Layer): string {
  if (layer.type === 'text') {
    const text = layer.content.map((node) => (node.kind === 'br' ? ' ' : node.text)).join('');
    return text.slice(0, 80);
  }
  if (layer.type === 'image') return layer.src;
  if (layer.type === 'shape') return layer.style.fill.kind;
  return `${layer.nodes.length} nodes`;
}
