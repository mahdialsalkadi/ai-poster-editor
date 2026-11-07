import type { SvgNode } from '@poster/core';

const URL_REF_RE = /^url\(\s*#([^)\s]+)\s*\)$/;

function scopeRef(value: string, prefix: string): string {
  const id = value.match(URL_REF_RE)?.[1];
  return id ? `url(#${prefix}${id})` : value;
}

/**
 * Scopes ids and local paint references to a single layer so two SVG layers
 * cannot accidentally reference each other's gradients.
 */
export function scopeSvgNodes(nodes: readonly SvgNode[], prefix: string): SvgNode[] {
  return nodes.map((node) => {
    if (node.kind === 'text') return { kind: 'text', text: node.text };
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(node.attrs)) {
      if (key === 'id') attrs[key] = `${prefix}${value}`;
      else if (key === 'fill' || key === 'stroke') attrs[key] = scopeRef(value, prefix);
      else attrs[key] = value;
    }
    return {
      kind: 'element',
      tag: node.tag,
      attrs,
      children: scopeSvgNodes(node.children, prefix),
    };
  });
}

/** Converts allow-listed SVG attribute names to React prop names. */
export function svgAttrToProps(attrs: Record<string, string>): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    props[key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return props;
}
