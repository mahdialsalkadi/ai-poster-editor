import { describe, expect, it } from 'vitest';
import {
  canonicalInlineText,
  parseDesignHtml,
  serializeDesignDoc,
  type TextLayer,
} from '../src/index.js';

describe('blank text lines', () => {
  it.each([1, 2, 3, 8])('preserves at most two internal breaks from %s', (count) => {
    const html = `<div class="artboard" data-width="400px" data-height="400px"><div data-id="t" data-type="text" style="position:absolute;left:0px;top:0px;width:300px">First${'<br>'.repeat(count)}Last</div></div>`;
    const { doc } = parseDesignHtml(html);
    expect((doc.layers[0] as TextLayer).content.filter((node) => node.kind === 'br')).toHaveLength(
      Math.min(count, 2),
    );
    expect(parseDesignHtml(serializeDesignDoc(doc)).doc).toEqual(doc);
  });
  it('trims leading/trailing breaks and remains idempotent with styled text', () => {
    const nodes = canonicalInlineText([
      { kind: 'br' },
      { kind: 'span', text: 'أول', bold: true },
      { kind: 'br' },
      { kind: 'br' },
      { kind: 'span', text: 'آخر', italic: true },
      { kind: 'br' },
    ]);
    expect(nodes.filter((node) => node.kind === 'br')).toHaveLength(2);
    expect(canonicalInlineText(nodes)).toEqual(nodes);
    expect(nodes[0]?.kind).toBe('span');
    expect(nodes.at(-1)?.kind).toBe('span');
  });
});
