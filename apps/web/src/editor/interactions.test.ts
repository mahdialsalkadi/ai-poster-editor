import { describe, expect, it } from 'vitest';
import { LIMITS, type DesignDoc, type TextLayer } from '@poster/core';
import { createPaperDoc } from '../sample.js';
import { copyLayers, pasteLayers } from './clipboard.js';
import { layersInMarquee, selectionRect } from './selection.js';
import { replaceTextContent } from './layers.js';
import { handlesFor, resizeFromHandle, scaleTextFontSize } from './resize.js';

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

describe('resize geometry', () => {
  const textStart = { left: 100, top: 100, width: 400, height: 200, rotation: 0 };

  it('exposes six handles for text and eight for other layer types', () => {
    expect([...handlesFor('text')]).toEqual(['nw', 'ne', 'se', 'sw', 'w', 'e']);
    expect([...handlesFor('shape')]).toHaveLength(8);
    expect([...handlesFor('image')]).toHaveLength(8);
  });

  it('reflows a text layer from an edge handle without touching its font size', () => {
    const result = resizeFromHandle({
      handle: 'e',
      start: textStart,
      dx: 200,
      dy: 0,
      type: 'text',
      startFontSize: 48,
    });
    expect(result.width).toBe(600);
    expect(result.left).toBe(100);
    expect(result.fontSize).toBeUndefined();
  });

  it('scales the font proportionally when a text corner handle is dragged', () => {
    const result = resizeFromHandle({
      handle: 'se',
      start: textStart,
      dx: 200,
      dy: 0,
      type: 'text',
      startFontSize: 48,
    });
    expect(result.width).toBe(600);
    expect(result.fontSize).toBe(72);
  });

  it('clamps the scaled font to the schema limits', () => {
    expect(scaleTextFontSize(900, 800, 400)).toBe(1000);
    expect(scaleTextFontSize(2, 100, 400)).toBe(1);
  });

  it('locks the aspect ratio on image and svg corners only', () => {
    const image = resizeFromHandle({
      handle: 'se',
      start: { left: 0, top: 0, width: 400, height: 200, rotation: 0 },
      dx: 100,
      dy: 0,
      type: 'image',
    });
    expect(image).toMatchObject({ width: 500, height: 250 });

    const shape = resizeFromHandle({
      handle: 'se',
      start: { left: 0, top: 0, width: 400, height: 200, rotation: 0 },
      dx: 100,
      dy: 0,
      type: 'shape',
    });
    expect(shape).toMatchObject({ width: 500, height: 200 });

    const shifted = resizeFromHandle({
      handle: 'se',
      start: { left: 0, top: 0, width: 400, height: 200, rotation: 0 },
      dx: 100,
      dy: 0,
      type: 'shape',
      shiftKey: true,
    });
    expect(shifted).toMatchObject({ width: 500, height: 250 });
  });

  it('resizes symmetrically around the centre while Alt is held', () => {
    const result = resizeFromHandle({
      handle: 'se',
      start: { left: 100, top: 150, width: 400, height: 200, rotation: 0 },
      dx: 100,
      dy: 100,
      type: 'shape',
      altKey: true,
    });
    expect(result).toMatchObject({ width: 500, height: 300, left: 50, top: 100 });
  });
});
