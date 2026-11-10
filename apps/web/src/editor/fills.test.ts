import { describe, expect, it } from 'vitest';
import type { DesignDoc } from '@poster/core';
import {
  colorAlpha,
  extractDocumentColors,
  normalizeColor,
  replaceColorAcrossDoc,
  withAlpha,
} from './fills.js';

function makeDoc(): DesignDoc {
  return {
    width: 1000,
    height: 1000,
    background: {
      kind: 'linear',
      angle: 90,
      stops: [
        { color: '#ffffff', pos: 0 },
        { color: '#000000', pos: 100 },
      ],
    },
    layers: [
      {
        id: 'title',
        name: 'Title',
        type: 'text',
        left: 10,
        top: 10,
        width: 400,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        dir: 'rtl',
        content: [{ kind: 'text', text: 'مرحبا' }],
        style: { color: '#f5a524', shadow: { x: 0, y: 2, blur: 4, color: '#F5A524' } },
      },
      {
        id: 'card',
        name: 'Card',
        type: 'shape',
        left: 20,
        top: 20,
        width: 200,
        height: 120,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        style: {
          fill: { kind: 'solid', color: ' #f5a524 ' },
          border: { width: 2, style: 'solid', color: '#112233' },
        },
      },
    ],
  } as unknown as DesignDoc;
}

describe('document colour helpers', () => {
  it('normalises and counts colours across fills, text, borders and shadows', () => {
    const colors = extractDocumentColors(makeDoc());
    const byColor = new Map(colors.map((entry) => [entry.color, entry.count]));
    expect(byColor.get('#F5A524')).toBe(3);
    expect(byColor.get('#FFFFFF')).toBe(1);
    expect(byColor.get('#000000')).toBe(1);
    expect(byColor.get('#112233')).toBe(1);
    expect(colors[0]?.color).toBe('#F5A524');
    expect(normalizeColor(' #abcdef ')).toBe('#ABCDEF');
  });

  it('replaces a colour in backgrounds, gradient stops, fills, borders and text', () => {
    const doc = makeDoc();
    const next = replaceColorAcrossDoc(doc, '#f5a524', '#22d3ee');
    const card = next.layers.find((layer) => layer.id === 'card');
    const title = next.layers.find((layer) => layer.id === 'title');
    expect(card && card.type === 'shape' && card.style.fill).toEqual({
      kind: 'solid',
      color: '#22D3EE',
    });
    expect(title && title.type === 'text' && title.style.color).toBe('#22D3EE');
    expect(title && title.type === 'text' && title.style.shadow?.color).toBe('#22D3EE');

    const gradient = replaceColorAcrossDoc(doc, '#000000', '#334155');
    expect(gradient.background.kind === 'linear' && gradient.background.stops[1]?.color).toBe(
      '#334155',
    );
    expect(gradient.layers).toEqual(doc.layers);
  });

  it('returns the same document when the colour is unused', () => {
    const doc = makeDoc();
    expect(replaceColorAcrossDoc(doc, '#123456', '#654321')).toBe(doc);
  });

  it('round-trips alpha through hex colours', () => {
    const tinted = withAlpha('#F5A524', 0.5);
    expect(tinted).toBe('#F5A52480');
    expect(colorAlpha(tinted)).toBeCloseTo(128 / 255, 5);
    expect(colorAlpha('#F5A524')).toBe(1);
    expect(withAlpha('#F5A524', 0)).toBe('#F5A52400');
    expect(withAlpha('#F5A524', 1)).toBe('#F5A524FF');
  });
});
