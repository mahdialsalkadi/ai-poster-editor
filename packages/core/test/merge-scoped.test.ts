import { describe, expect, it } from 'vitest';
import { mergeScopedEdit, parseDesignHtml, serializeDesignDoc, type TextLayer } from '../src/index';

const BASE = `<div class="artboard" data-width="400px" data-height="400px" style="background:#ffffff">
  <div data-id="a" data-layer="A" data-type="shape" style="position:absolute;left:10px;top:10px;width:50px;height:50px;background:#111111"></div>
  <div data-id="b" data-layer="B" data-type="text" dir="ltr" style="position:absolute;left:10px;top:100px;width:200px;font-family:'Inter';font-size:24px;font-weight:400;color:#000000;text-align:left;line-height:1.2;letter-spacing:0px">Original</div>
  <div data-id="c" data-layer="C" data-type="shape" style="position:absolute;left:10px;top:200px;width:50px;height:50px;background:#222222"></div>
</div>`;

const base = (): ReturnType<typeof parseDesignHtml>['doc'] => parseDesignHtml(BASE).doc;

const patchHtml = (inner: string, width = 400, height = 400): string =>
  `<div class="artboard" data-width="${width}px" data-height="${height}px" style="background:#ffffff">${inner}</div>`;

const textLayer = (id: string, text: string, extra = ''): string =>
  `<div data-id="${id}" data-layer="${id}" data-type="text" dir="ltr" ${extra} style="position:absolute;left:10px;top:100px;width:200px;font-family:'Inter';font-size:24px;font-weight:400;color:#000000;text-align:left;line-height:1.2;letter-spacing:0px">${text}</div>`;

const shapeLayer = (id: string, top = 300): string =>
  `<div data-id="${id}" data-layer="${id}" data-type="shape" style="position:absolute;left:10px;top:${top}px;width:20px;height:20px;background:#333333"></div>`;

describe('mergeScopedEdit', () => {
  it('replaces a selected layer in place and keeps z-order', () => {
    const doc = mergeScopedEdit(base(), patchHtml(textLayer('b', 'Edited')), ['b']).doc;
    expect(doc.layers.map((layer) => layer.id)).toEqual(['a', 'b', 'c']);
    expect((doc.layers[1] as TextLayer).content).toEqual([{ kind: 'text', text: 'Edited' }]);
  });

  it('never changes unselected layers', () => {
    const before = base();
    const { doc, warnings } = mergeScopedEdit(
      before,
      patchHtml(`${shapeLayer('a', 999)}${textLayer('b', 'Edited')}`),
      ['b'],
    );
    expect(doc.layers[0]).toEqual(before.layers[0]);
    expect(doc.layers[2]).toEqual(before.layers[2]);
    expect(warnings.some((warning) => warning.code === 'MERGE_IGNORED_UNSELECTED')).toBe(true);
  });

  it('keeps a selected layer that the model did not return', () => {
    const before = base();
    const { doc } = mergeScopedEdit(before, patchHtml(textLayer('b', 'Edited')), ['a', 'b']);
    expect(doc.layers).toHaveLength(3);
    expect(doc.layers[0]).toEqual(before.layers[0]);
  });

  it('inserts a new layer directly above the highest selected layer', () => {
    const { doc, warnings } = mergeScopedEdit(
      base(),
      patchHtml(`${textLayer('b', 'Edited')}${shapeLayer('fresh')}`),
      ['b'],
    );
    expect(doc.layers.map((layer) => layer.id)).toEqual(['a', 'b', 'fresh', 'c']);
    expect(warnings.some((warning) => warning.code === 'MERGE_NEW_LAYER')).toBe(true);
  });

  it('ignores a type change on a selected layer', () => {
    const before = base();
    const { doc, warnings } = mergeScopedEdit(before, patchHtml(shapeLayer('b')), ['b']);
    expect(doc.layers[1]).toEqual(before.layers[1]);
    expect(warnings.some((warning) => warning.code === 'MERGE_TYPE_CHANGE_IGNORED')).toBe(true);
  });

  it('ignores artboard changes from a scoped edit', () => {
    const before = base();
    const { doc, warnings } = mergeScopedEdit(before, patchHtml(textLayer('b', 'X'), 500, 500), [
      'b',
    ]);
    expect(doc.width).toBe(400);
    expect(doc.height).toBe(400);
    expect(warnings.some((warning) => warning.code === 'MERGE_ARTBOARD_CHANGE_IGNORED')).toBe(
      true,
    );
  });

  it('appends new layers at the end when the selection is empty', () => {
    const { doc } = mergeScopedEdit(base(), patchHtml(shapeLayer('extra')), []);
    expect(doc.layers.map((layer) => layer.id)).toEqual(['a', 'b', 'c', 'extra']);
  });

  it('round-trips the merged document deterministically', () => {
    const { doc } = mergeScopedEdit(base(), patchHtml(textLayer('b', 'Edited')), ['b']);
    const html = serializeDesignDoc(doc);
    expect(parseDesignHtml(html).doc).toEqual(doc);
  });
});
