import { describe, expect, it } from 'vitest';
import { designDocSchema, LIMITS, parseDesignHtml } from '../src/index.js';

const base = parseDesignHtml(
  '<div class="artboard" data-width="600px" data-height="800px"></div>',
).doc;

describe('schema collection and SVG regressions', () => {
  it('rejects an oversized layer collection without visiting its elements', () => {
    let visited = false;
    const layers = new Array(LIMITS.document.maxLayers + 1);
    Object.defineProperty(layers, 0, {
      get() {
        visited = true;
        throw new Error('Oversized collection elements must not be parsed');
      },
    });

    const result = designDocSchema.safeParse({ ...base, layers });
    expect(result.success).toBe(false);
    expect(visited).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]).toMatchObject({ code: 'too_big', path: ['layers'] });
    }
  });

  const svgDoc = (attrs: Record<string, unknown>) => ({
    ...base,
    layers: [
      {
        id: 'mark',
        name: 'Mark',
        type: 'svg',
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        nodes: [{ kind: 'element', tag: 'path', attrs, children: [] }],
      },
    ],
  });

  it('preserves recursive SVG string-valued attribute records', () => {
    const input = svgDoc({ d: 'M0 0 L10 10', fill: '#ffffff' });
    expect(designDocSchema.parse(input)).toEqual(input);
  });

  it('rejects non-string SVG attribute values after the Zod migration', () => {
    expect(designDocSchema.safeParse(svgDoc({ d: 42 })).success).toBe(false);
  });
});
