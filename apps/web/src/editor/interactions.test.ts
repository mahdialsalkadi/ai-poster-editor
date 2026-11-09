import { describe, expect, it } from 'vitest';
import { LIMITS, type DesignDoc, type TextLayer } from '@poster/core';
import { createPaperDoc } from '../sample.js';
import { copyLayers, pasteLayers } from './clipboard.js';
import { layersInMarquee, selectionRect } from './selection.js';
import { replaceTextContent } from './layers.js';

describe('editor interactions', () => {
  it('copies a deep snapshot, preserves stacking order, offsets and allocates unique IDs', () => {
    const doc = createPaperDoc();
    const originals = doc.layers.slice(0, 2);
    const clipboard = copyLayers(doc, originals.map((layer) => layer.id).reverse());
    expect(clipboard).toEqual(originals);
    expect(clipboard[0]).not.toBe(originals[0]);
    const first = pasteLayers(doc, clipboard);
    const second = pasteLayers(first.doc, clipboard, 40);
    expect(new Set(second.doc.layers.map((layer) => layer.id)).size).toBe(second.doc.layers.length);
    expect(first.doc.layers.at(-2)?.left).toBe(originals[0]!.left + 20);
    expect(second.doc.layers.at(-2)?.top).toBe(originals[0]!.top + 40);
    expect(clipboard).toEqual(originals);
  });
  it('refuses an entire paste that would exceed the layer cap', () => {
    const doc = createPaperDoc();
    const full: DesignDoc = {
      ...doc,
      layers: Array.from({ length: LIMITS.document.maxLayers }, (_, i) => ({
        ...doc.layers[0]!,
        id: `l${i}`,
      })),
    };
    expect(pasteLayers(full, copyLayers(doc, [doc.layers[0]!.id])).doc).toBe(full);
  });
  it('selects intersecting rotated bounds, ignoring hidden/locked layers', () => {
    const doc = createPaperDoc();
    const base = doc.layers.find((layer) => layer.type === 'shape')!;
    const shape = {
      ...base,
      id: 'visible',
      left: 100,
      top: 100,
      width: 100,
      height: 20,
      rotation: 90,
      hidden: false,
      locked: false,
    };
    const test: DesignDoc = {
      ...doc,
      layers: [
        shape,
        { ...shape, id: 'locked', locked: true },
        { ...shape, id: 'hidden', hidden: true },
      ],
    };
    expect(layersInMarquee(test, selectionRect(160, 70, 145, 60))).toEqual(['visible']);
    expect(layersInMarquee(test, selectionRect(0, 0, 0, 0))).toEqual([]);
  });
  it('zeroes spacing immediately when Latin editor text becomes Arabic', () => {
    const doc = createPaperDoc();
    const layer = doc.layers.find((item) => item.type === 'text') as TextLayer;
    layer.style.letterSpacing = 4;
    const next = replaceTextContent(doc, layer.id, [{ kind: 'text', text: 'مرحبا' }]);
    expect(
      (next.layers.find((item) => item.id === layer.id) as TextLayer).style.letterSpacing,
    ).toBe(0);
  });
});
