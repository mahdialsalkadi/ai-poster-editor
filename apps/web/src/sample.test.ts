import { canonicalizeDoc, containsArabic, parseDesignHtml, serializeDesignDoc } from '@poster/core';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './sample.js';

describe('template gallery', () => {
  it('offers a blank starting point and designed layouts', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(TEMPLATES.some((template) => template.doc.layers.length === 0)).toBe(true);
    expect(new Set(TEMPLATES.map((template) => template.id)).size).toBe(TEMPLATES.length);
  });

  it('offers three English and two Arabic designs, retaining the bilingual design', () => {
    expect(TEMPLATES.filter((item) => item.language === 'en')).toHaveLength(3);
    expect(TEMPLATES.filter((item) => item.language === 'ar')).toHaveLength(2);
    expect(TEMPLATES.filter((item) => item.language === 'mixed')).toHaveLength(1);
    for (const template of TEMPLATES.filter((item) => item.language === 'en')) {
      expect(
        template.doc.layers.some(
          (layer) =>
            layer.type === 'text' &&
            containsArabic(
              layer.content.map((node) => (node.kind === 'br' ? '' : node.text)).join(''),
            ),
        ),
      ).toBe(false);
    }
  });

  it.each(TEMPLATES.map((template) => [template.id, template] as const))(
    'keeps %s canonical',
    (_id, template) => {
      expect(canonicalizeDoc(template.doc)).toEqual(template.doc);
      expect(parseDesignHtml(serializeDesignDoc(template.doc)).doc).toEqual(template.doc);
    },
  );
});
