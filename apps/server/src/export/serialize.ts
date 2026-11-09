import {
  DesignError,
  type Border,
  type DesignDoc,
  type Fill,
  type ImageLayer,
  type InlineNode,
  type Layer,
  type Shadow,
  type ShapeLayer,
  type SvgNode,
  type TextLayer,
  type SvgLayer,
} from '@poster/core';
import type { PreparedAsset } from './assets.js';
import { buildFontCss } from './fonts.js';

export type ExportAssets = Map<string, PreparedAsset>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fillCss(fill: Fill): string {
  if (fill.kind === 'solid') return fill.color;
  const stops = fill.stops.map((stop) => `${stop.color} ${stop.pos}%`).join(', ');
  return `linear-gradient(${fill.angle}deg, ${stops})`;
}

function shadowCss(shadow: Shadow, spread = true): string {
  const extra = spread && shadow.spread !== undefined ? ` ${shadow.spread}px` : '';
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px${extra} ${shadow.color}`;
}

function borderCss(border: Border): string {
  return `border:${border.width}px ${border.style} ${border.color};`;
}

function boxCss(layer: Layer): string {
  const height = 'height' in layer ? `height:${layer.height}px;` : '';
  const rotation = layer.rotation !== 0 ? `transform:rotate(${layer.rotation}deg);` : '';
  return `position:absolute;left:${layer.left}px;top:${layer.top}px;width:${layer.width}px;${height}opacity:${layer.opacity};${rotation}`;
}

function textCss(layer: TextLayer): string {
  const style = layer.style;
  return [
    `font-family:'${style.fontFamily}', sans-serif`,
    `font-size:${style.fontSize}px`,
    `font-weight:${style.fontWeight}`,
    style.italic ? 'font-style:italic' : '',
    style.underline ? 'text-decoration:underline' : '',
    `color:${style.color}`,
    `text-align:${style.align}`,
    `line-height:${style.lineHeight}`,
    `letter-spacing:${style.letterSpacing}px`,
    `text-transform:${style.textTransform}`,
    `direction:${layer.dir}`,
    'white-space:pre-wrap',
    'overflow-wrap:break-word',
    style.shadow ? `text-shadow:${shadowCss(style.shadow, false)}` : '',
  ]
    .filter(Boolean)
    .join(';');
}

function inlineHtml(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'br') return '<br>';
      if (node.kind === 'text') return escapeHtml(node.text);
      const style = [
        node.bold ? 'font-weight:700' : '',
        node.italic ? 'font-style:italic' : '',
        node.underline ? 'text-decoration:underline' : '',
        node.color ? `color:${node.color}` : '',
      ]
        .filter(Boolean)
        .join(';');
      return style
        ? `<span style="${style}">${escapeHtml(node.text)}</span>`
        : escapeHtml(node.text);
    })
    .join('');
}

function shapeHtml(layer: ShapeLayer): string {
  const style = [
    boxCss(layer).replace(/;$/, ''),
    `background:${fillCss(layer.style.fill)}`,
    `border-radius:${layer.style.radius}px`,
    layer.style.border ? borderCss(layer.style.border).replace(/;$/, '') : '',
    layer.style.shadow ? `box-shadow:${shadowCss(layer.style.shadow)}` : '',
  ]
    .filter(Boolean)
    .join(';');
  return `<div${layerAttrs(layer)} style="${style}"></div>`;
}

function imageHtml(layer: ImageLayer, assets: ExportAssets): string {
  const id = layer.src.startsWith('asset:') ? layer.src.slice('asset:'.length) : '';
  const asset = assets.get(id);
  if (!asset) {
    throw new DesignError('ASSET_UNRESOLVED', `Asset ${id} was not supplied`, `assets.${id}`);
  }
  const style = [
    boxCss(layer).replace(/;$/, ''),
    `object-fit:${layer.style.fit}`,
    `object-position:${layer.style.position.x}% ${layer.style.position.y}%`,
    `border-radius:${layer.style.radius}px`,
    layer.style.border ? borderCss(layer.style.border).replace(/;$/, '') : '',
    layer.style.shadow ? `box-shadow:${shadowCss(layer.style.shadow)}` : '',
  ]
    .filter(Boolean)
    .join(';');
  return `<img${layerAttrs(layer)} src="${asset.dataUri}" alt="${escapeHtml(
    layer.alt ?? layer.name,
  )}" style="${style}">`;
}

function svgNodeHtml(node: SvgNode): string {
  if (node.kind === 'text') return escapeHtml(node.text);
  const attributes = Object.entries(node.attrs)
    .filter(([name]) => /^[A-Za-z][A-Za-z0-9:_-]*$/.test(name))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
  const children = node.children.map(svgNodeHtml).join('');
  return `<${node.tag}${attributes}>${children}</${node.tag}>`;
}

function svgHtml(layer: SvgLayer): string {
  const style = [boxCss(layer).replace(/;$/, ''), 'display:block;overflow:visible']
    .filter(Boolean)
    .join(';');
  const viewBox = layer.viewBox ? ` viewBox="${escapeHtml(layer.viewBox)}"` : '';
  return `<svg${layerAttrs(layer)}${viewBox} preserveAspectRatio="xMidYMid meet" style="${style}">${layer.nodes
    .map(svgNodeHtml)
    .join('')}</svg>`;
}

/**
 * The design envelope travels with the export so a re-import keeps layer ids,
 * names and the image prompt instead of re-inventing them.
 */
function layerAttrs(layer: Layer): string {
  const prompt =
    layer.type === 'image' && layer.prompt ? ` data-prompt="${escapeHtml(layer.prompt)}"` : '';
  return ` data-id="${escapeHtml(layer.id)}" data-layer="${escapeHtml(
    layer.name,
  )}" data-type="${layer.type}"${prompt}`;
}

function layerHtml(layer: Layer, assets: ExportAssets): string {
  if (layer.type === 'text') {
    return `<div${layerAttrs(layer)} dir="${layer.dir}" style="${boxCss(layer)}${textCss(
      layer,
    )}">${inlineHtml(layer.content)}</div>`;
  }
  if (layer.type === 'shape') return shapeHtml(layer);
  if (layer.type === 'image') return imageHtml(layer, assets);
  return svgHtml(layer);
}

/**
 * One self-contained HTML document: hidden layers omitted, fonts and images
 * inlined as data URIs, no external reference of any kind (contract §12.1).
 */
export function serializeForExport(doc: DesignDoc, assets: ExportAssets): string {
  const fonts = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.type === 'text' && !layer.hidden) fonts.add(layer.style.fontFamily);
  }

  const layers = doc.layers
    .filter((layer) => !layer.hidden)
    .map((layer) => layerHtml(layer, assets))
    .join('\n');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">
<style>
${buildFontCss(fonts)}
html,body{margin:0;padding:0;background:transparent}
*{box-sizing:border-box}
.artboard{position:relative;overflow:hidden;width:${doc.width}px;height:${doc.height}px;background:${fillCss(doc.background)}}
</style>
</head>
<body>
<div class="artboard">
${layers}
</div>
</body>
</html>`;
}
