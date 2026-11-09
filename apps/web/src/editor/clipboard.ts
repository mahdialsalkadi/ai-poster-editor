import { LIMITS, type DesignDoc, type Layer } from '@poster/core';
import { uniqueLayerId } from './layers.js';

export function copyLayers(doc: DesignDoc, ids: readonly string[]): Layer[] {
  return structuredClone(doc.layers.filter((layer) => ids.includes(layer.id)));
}

export function pasteLayers(
  doc: DesignDoc,
  clipboard: readonly Layer[],
  offset = 20,
): { doc: DesignDoc; ids: string[] } {
  if (clipboard.length === 0 || doc.layers.length + clipboard.length > LIMITS.document.maxLayers)
    return { doc, ids: [] };
  const ids: string[] = [];
  let next = doc;
  for (const original of clipboard) {
    const layer = structuredClone(original);
    layer.id = uniqueLayerId(next, `${layer.id}-copy`);
    layer.left = Math.min(100_000, Math.max(-100_000, layer.left + offset));
    layer.top = Math.min(100_000, Math.max(-100_000, layer.top + offset));
    ids.push(layer.id);
    next = { ...next, layers: [...next.layers, layer] };
  }
  return { doc: next, ids };
}
