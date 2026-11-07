import { SecurityViolationError } from './errors.js';

/**
 * CSS escaping is a decoding step, not a cosmetic one: `\75rl(` and `u\72l(`
 * are the same function as `url(` once the browser decodes them. Security
 * checks therefore run on the decoded form, never on the raw source text.
 */
const FORBIDDEN_CSS_RE = /(?:url\s*\(|@import|expression\s*\(|javascript\s*:)/i;
const LOCAL_SVG_URL_RE = /^url\(\s*#[A-Za-z][A-Za-z0-9_-]{0,63}\s*\)$/;
const REMOTE_OR_SCRIPT_SCHEME_RE = /^(?:javascript|vbscript|data|file|blob|https?):/i;

export function decodeCssEscapes(input: string): string {
  if (!input.includes('\\')) return input;
  return input.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|([\s\S]))/g,
    (_match: string, hex: string | undefined, literal: string | undefined): string => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        if (!Number.isFinite(codePoint) || codePoint === 0 || codePoint > 0x10ffff) return '\uFFFD';
        return String.fromCodePoint(codePoint);
      }
      return literal ?? '';
    },
  );
}

/** True when a CSS fragment contains an executable or remote-loading value. */
export function containsForbiddenCss(value: string): boolean {
  if (FORBIDDEN_CSS_RE.test(value)) return true;
  const decoded = decodeCssEscapes(value);
  return decoded !== value && FORBIDDEN_CSS_RE.test(decoded);
}

/**
 * SVG paint values may be a color, `none`, or a local `url(#id)` reference.
 * Anything else is a violation, including escaped spellings of `url(`.
 */
export function assertSafePaintValue(raw: string, path: string): void {
  const decoded = decodeCssEscapes(raw).trim();
  if (LOCAL_SVG_URL_RE.test(decoded)) return;
  if (/url\s*\(/i.test(decoded)) {
    throw new SecurityViolationError('Only local SVG url(#id) references are allowed', path);
  }
  if (REMOTE_OR_SCRIPT_SCHEME_RE.test(decoded)) {
    throw new SecurityViolationError('Remote or script paint values are not allowed', path);
  }
}
