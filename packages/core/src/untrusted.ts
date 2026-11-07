/**
 * Prompt-side boundary for untrusted data (contract §12.2).
 *
 * The AI prompts receive the current design, reference documents and layer text
 * inside a delimited block. Everything in that block is data: it must not be
 * able to close the block early and continue as if it were the surrounding
 * prompt, and it must not be able to open a second block either.
 */

export const UNTRUSTED_TAG = 'untrusted_design_data';

const OPEN = `<${UNTRUSTED_TAG}>`;
const CLOSE = `</${UNTRUSTED_TAG}>`;

/**
 * Breaks every sequence that could open or close the block, in any casing and in
 * both the raw `<` form and the `&lt;` form that canonical Design HTML uses for
 * text. The backslash keeps the payload readable while making the delimiter
 * unparseable as a tag.
 */
function neutralize(payload: string): string {
  return payload
    .replace(/<(\/?)(untrusted_design_data)/gi, '<\\$1$2')
    .replace(/&lt;(\/?)(untrusted_design_data)/gi, '&lt;\\$1$2');
}

/**
 * Wraps an untrusted payload in the block the prompts expect.
 *
 * The payload is not escaped, reformatted or truncated here: it is already
 * canonical Design HTML or plain reference text, and the only transformation is
 * delimiter neutralization.
 */
export function wrapUntrustedData(payload: string): string {
  return `${OPEN}\n${neutralize(payload)}\n${CLOSE}`;
}
