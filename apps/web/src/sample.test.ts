import { canonicalizeDoc } from '@poster/core';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './sample.js';

describe('template gallery', () => {
  it('offers a blank starting point and designed layouts', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(TEMPLATES.some((template) => template.doc.layers.length === 0)).toBe(true);
    expect(new Set(TEMPLATES.map((template) => template.id)).size).toBe(TEMPLATES.length);
  });

  it.each(TEMPLATES.map((template) => [template.id, template] as const))(
    'keeps %s canonical',
    (_id, template) => {
      expect(canonicalizeDoc(template.doc)).toEqual(template.doc);
    },
  );
});
