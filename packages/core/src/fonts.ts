import { ALLOWED_FONTS, ARABIC_FONTS, type AllowedFont } from './model.js';

const ARABIC_RE = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;

export function containsArabic(text: string): boolean {
  return ARABIC_RE.test(text);
}

/**
 * Resolves a font stack against the allow-list.
 *
 * Only the first family in the stack is considered: Design HTML names one font
 * and never cascades. When that family is not allowed the caller falls back to
 * Inter (LTR) or Cairo (RTL) and reports the substitution.
 */
export function findAllowedFont(input: string): AllowedFont | null {
  const first = input
    .split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ');
  if (!first) return null;
  const lower = first.toLowerCase();
  return ALLOWED_FONTS.find((font) => font.toLowerCase() === lower) ?? null;
}

export function fallbackFont(direction: 'ltr' | 'rtl'): AllowedFont {
  return direction === 'rtl' ? 'Cairo' : 'Inter';
}

export function normalizeFontWeight(input: string): number {
  const value = input.trim().toLowerCase();
  if (value === 'normal') return 400;
  if (value === 'bold') return 700;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 400;
  const clamped = Math.min(900, Math.max(100, parsed));
  return Math.round(clamped / 100) * 100;
}

export function isArabicFont(font: AllowedFont): boolean {
  return ARABIC_FONTS.has(font);
}
