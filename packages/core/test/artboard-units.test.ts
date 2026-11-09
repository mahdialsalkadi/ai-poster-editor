import { describe, expect, it } from 'vitest';
import { parseDesignHtml, serializeDesignDoc } from '../src/index.js';

describe('artboard dimension attributes', () => {
  it.each(['794', '794px', ' 794PX ', '794.0'])(
    'accepts %s and serializes canonical px',
    (width) => {
      const { doc } = parseDesignHtml(
        `<div class="artboard" data-width="${width}" data-height="1123"></div>`,
      );
      expect(doc.width).toBe(794);
      expect(serializeDesignDoc(doc)).toContain('data-width="794px" data-height="1123px"');
    },
  );
  it.each(['794em', '794pxjunk', '1e3', 'Infinity', 'NaN', '-794', '0', '99', '5001', '794%'])(
    'rejects invalid/out-of-bounds dimensions: %s',
    (width) => {
      expect(() =>
        parseDesignHtml(`<div class="artboard" data-width="${width}" data-height="1123px"></div>`),
      ).toThrow();
    },
  );
  it('does not enable unitless CSS width and height', () => {
    expect(() =>
      parseDesignHtml('<div class="artboard" style="width:794;height:1123"></div>'),
    ).toThrow();
  });
});
