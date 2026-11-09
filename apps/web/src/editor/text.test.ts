import { describe, expect, it } from 'vitest';
import { inlineToPlain, plainToInline } from './text.js';

describe('plain-text editing', () => {
  it('keeps one blank line for Arabic and English Enter/paste input', () => {
    expect(inlineToPlain(plainToInline('First\n\nLast'))).toBe('First\n\nLast');
    expect(inlineToPlain(plainToInline('أول\r\n\r\n\r\nآخر'))).toBe('أول\n\nآخر');
  });
  it('keeps pasted HTML as literal plain text', () => {
    expect(plainToInline('<b>Hello</b>')).toEqual([{ kind: 'text', text: '<b>Hello</b>' }]);
  });
});
