import type { Border, Fill, Shadow } from '@poster/core';

export function fillToCss(fill: Fill): string {
  if (fill.kind === 'solid') return fill.color;
  const stops = fill.stops.map((stop) => `${stop.color} ${stop.pos}%`).join(', ');
  return `linear-gradient(${fill.angle}deg, ${stops})`;
}

export function borderToCss(border: Border): string {
  return `${border.width}px ${border.style} ${border.color}`;
}

export function shadowToCss(shadow: Shadow, includeSpread = true): string {
  const spread = includeSpread && shadow.spread !== undefined ? ` ${shadow.spread}px` : '';
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px${spread} ${shadow.color}`;
}

export function fontFamilyCss(font: string): string {
  return `'${font}', 'IBM Plex Sans Arabic', 'Inter', sans-serif`;
}
