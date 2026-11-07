import { canonicalizeDoc } from './canonicalize.js';
import type {
  Border,
  DesignDoc,
  Fill,
  ImageLayer,
  InlineNode,
  Layer,
  Shadow,
  ShapeLayer,
  SvgLayer,
  SvgNode,
  TextLayer,
} from './model.js';
import { quantize } from './numbers.js';

function formatNumber(value: number): string {
  const rounded = quantize(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function serializeFill(fill: Fill): string {
  if (fill.kind === 'solid') return fill.color;
  const stops = fill.stops
    .map((stop) => `${stop.color} ${formatNumber(stop.pos)}%`)
    .join(', ');
  return `linear-gradient(${formatNumber(fill.angle)}deg, ${stops})`;
}

function serializeBorder(border: Border): string {
  return `${formatNumber(border.width)}px ${border.style} ${border.color}`;
}

function serializeShadow(shadow: Shadow): string {
  const parts = [
    `${formatNumber(shadow.x)}px`,
    `${formatNumber(shadow.y)}px`,
    `${formatNumber(shadow.blur)}px`,
  ];
  if (shadow.spread !== undefined) parts.push(`${formatNumber(shadow.spread)}px`);
  parts.push(shadow.color);
  return parts.join(' ');
}

function commonStyle(layer: Layer, includeHeight: boolean): string[] {
  const parts = [
    'position:absolute',
    `left:${formatNumber(layer.left)}px`,
    `top:${formatNumber(layer.top)}px`,
    `width:${formatNumber(layer.width)}px`,
  ];
  if (includeHeight && 'height' in layer) parts.push(`height:${formatNumber(layer.height)}px`);
  if (layer.rotation !== 0) parts.push(`transform:rotate(${formatNumber(layer.rotation)}deg)`);
  if (layer.opacity !== 1) parts.push(`opacity:${formatNumber(layer.opacity)}`);
  return parts;
}

function textStyle(layer: TextLayer): string[] {
  const style = layer.style;
  const parts = [
    `font-family:'${style.fontFamily}'`,
    `font-size:${formatNumber(style.fontSize)}px`,
    `font-weight:${style.fontWeight}`,
    `color:${style.color}`,
    `text-align:${style.align}`,
    `line-height:${formatNumber(style.lineHeight)}`,
    `letter-spacing:${formatNumber(style.letterSpacing)}px`,
  ];
  if (style.italic) parts.push('font-style:italic');
  if (style.underline) parts.push('text-decoration:underline');
  if (style.textTransform !== 'none') parts.push(`text-transform:${style.textTransform}`);
  if (style.shadow) parts.push(`text-shadow:${serializeShadow(style.shadow)}`);
  return parts;
}

function shapeStyle(layer: ShapeLayer): string[] {
  const style = layer.style;
  const parts = [`background:${serializeFill(style.fill)}`];
  if (style.border) parts.push(`border:${serializeBorder(style.border)}`);
  if (style.radius !== 0) parts.push(`border-radius:${formatNumber(style.radius)}px`);
  if (style.shadow) parts.push(`box-shadow:${serializeShadow(style.shadow)}`);
  return parts;
}

function imageStyle(layer: ImageLayer): string[] {
  const style = layer.style;
  const parts = [
    `object-fit:${style.fit}`,
    `object-position:${formatNumber(style.position.x)}% ${formatNumber(style.position.y)}%`,
  ];
  if (style.border) parts.push(`border:${serializeBorder(style.border)}`);
  if (style.radius !== 0) parts.push(`border-radius:${formatNumber(style.radius)}px`);
  if (style.shadow) parts.push(`box-shadow:${serializeShadow(style.shadow)}`);
  return parts;
}

function serializeInlineNodes(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text') return escapeText(node.text);
      if (node.kind === 'br') return '<br>';
      const style: string[] = [];
      if (node.bold) style.push('font-weight:700');
      if (node.italic) style.push('font-style:italic');
      if (node.underline) style.push('text-decoration:underline');
      if (node.color) style.push(`color:${node.color}`);
      if (style.length === 0) return escapeText(node.text);
      return `<span style="${style.join(';')}">${escapeText(node.text)}</span>`;
    })
    .join('');
}

function serializeSvgNode(node: SvgNode): string {
  if (node.kind === 'text') return escapeText(node.text);
  const attrs = Object.entries(node.attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join('');
  const children = node.children.map(serializeSvgNode).join('');
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}

function serializeLayer(layer: Layer): string {
  const attrs: string[] = [
    `data-id="${escapeAttr(layer.id)}"`,
    `data-layer="${escapeAttr(layer.name)}"`,
    `data-type="${layer.type}"`,
  ];
  if (layer.hidden) attrs.push('data-hidden="true"');
  if (layer.locked) attrs.push('data-locked="true"');

  if (layer.type === 'text') {
    attrs.push(`dir="${layer.dir}"`);
    attrs.push(`style="${[...commonStyle(layer, false), ...textStyle(layer)].join(';')}"`);
    return `<div ${attrs.join(' ')}>${serializeInlineNodes(layer.content)}</div>`;
  }

  if (layer.type === 'shape') {
    attrs.push(`style="${[...commonStyle(layer, true), ...shapeStyle(layer)].join(';')}"`);
    return `<div ${attrs.join(' ')}></div>`;
  }

  if (layer.type === 'image') {
    attrs.push(`src="${escapeAttr(layer.src)}"`);
    if (layer.prompt) attrs.push(`data-prompt="${escapeAttr(layer.prompt)}"`);
    if (layer.alt) attrs.push(`alt="${escapeAttr(layer.alt)}"`);
    attrs.push(`style="${[...commonStyle(layer, true), ...imageStyle(layer)].join(';')}"`);
    return `<img ${attrs.join(' ')}>`;
  }

  if (layer.viewBox) attrs.push(`viewBox="${escapeAttr(layer.viewBox)}"`);
  attrs.push(`style="${commonStyle(layer, true).join(';')}"`);
  return `<svg ${attrs.join(' ')}>${layer.nodes.map(serializeSvgNode).join('')}</svg>`;
}

/**
 * Serializes a DesignDoc to canonical Design HTML. The input is canonicalized
 * first, so equal documents always produce byte-identical output.
 */
export function serializeDesignDoc(doc: DesignDoc): string {
  const canonical = canonicalizeDoc(doc);
  const artboardAttrs = [
    'class="artboard"',
    `data-width="${formatNumber(canonical.width)}px"`,
    `data-height="${formatNumber(canonical.height)}px"`,
    `style="background:${serializeFill(canonical.background)}"`,
  ];
  return `<div ${artboardAttrs.join(' ')}>${canonical.layers.map(serializeLayer).join('')}</div>`;
}
