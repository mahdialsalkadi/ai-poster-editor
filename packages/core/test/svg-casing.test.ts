import { describe, expect, it } from 'vitest';
import { parseDesignHtml, serializeDesignDoc, type SvgLayer } from '../src/index';

const artboard = (inner: string): string =>
  `<div class="artboard" data-width="400px" data-height="400px" style="background:#ffffff">${inner}</div>`;

const svgLayer = (inner: string, attrs = ''): string =>
  `<svg data-id="mark" data-layer="Mark" data-type="svg" ${attrs} style="position:absolute;left:0px;top:0px;width:100px;height:100px">${inner}</svg>`;

const GRADIENT =
  '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" gradientTransform="rotate(45)" x1="0" y1="0" x2="10" y2="10"><stop offset="0" stop-color="#ffffff"></stop></linearGradient></defs>';

function firstLayer(html: string): SvgLayer {
  const layer = parseDesignHtml(html).doc.layers[0];
  if (layer?.type !== 'svg') throw new Error('expected an svg layer');
  return layer;
}

describe('SVG name casing', () => {
  it('keeps the case-sensitive viewBox attribute that parse5 returns', () => {
    const layer = firstLayer(artboard(svgLayer(GRADIENT, 'viewBox="0 0 10 10"')));
    expect(layer.viewBox).toBe('0 0 10 10');
  });

  it('keeps camelCase SVG tag and attribute names', () => {
    const layer = firstLayer(artboard(svgLayer(GRADIENT, 'viewBox="0 0 10 10"')));
    const defs = layer.nodes[0];
    if (defs?.kind !== 'element') throw new Error('expected defs');
    const gradient = defs.children[0];
    if (gradient?.kind !== 'element') throw new Error('expected gradient');

    expect(gradient.tag).toBe('linearGradient');
    expect(gradient.attrs.gradientUnits).toBe('userSpaceOnUse');
    expect(gradient.attrs.gradientTransform).toBe('rotate(45)');
    expect(Object.keys(gradient.attrs)).toContain('gradientUnits');
    expect(Object.keys(gradient.attrs)).not.toContain('gradientunits');
  });

  it('normalizes lower-cased source names into the canonical spelling', () => {
    const lowercased = artboard(
      svgLayer(
        '<defs><lineargradient id="g" gradientunits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff"></stop></lineargradient></defs>',
        'viewbox="0 0 10 10"',
      ),
    );
    const layer = firstLayer(lowercased);
    expect(layer.viewBox).toBe('0 0 10 10');

    const defs = layer.nodes[0];
    if (defs?.kind !== 'element') throw new Error('expected defs');
    const gradient = defs.children[0];
    if (gradient?.kind !== 'element') throw new Error('expected gradient');
    expect(gradient.tag).toBe('linearGradient');
    expect(gradient.attrs.gradientUnits).toBe('userSpaceOnUse');

    const html = serializeDesignDoc(parseDesignHtml(lowercased).doc);
    expect(html).toContain('<linearGradient');
    expect(html).toContain('gradientUnits="userSpaceOnUse"');
    expect(html).toContain('viewBox="0 0 10 10"');
    expect(html).not.toContain('lineargradient');
    expect(html).not.toContain('viewbox=');
  });

  it('round-trips a gradient reference without warnings', () => {
    const html = serializeDesignDoc(
      parseDesignHtml(artboard(svgLayer(GRADIENT, 'viewBox="0 0 10 10"'))).doc,
    );
    const reparsed = parseDesignHtml(html);
    expect(reparsed.warnings).toEqual([]);
    expect(reparsed.doc).toEqual(parseDesignHtml(artboard(svgLayer(GRADIENT, 'viewBox="0 0 10 10"'))).doc);
  });
});
