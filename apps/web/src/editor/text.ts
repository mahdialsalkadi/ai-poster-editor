import { LIMITS, type InlineNode } from '@poster/core';

/** Flattens inline content to plain text for the editor. Inline styling is not preserved. */
export function inlineToPlain(nodes: readonly InlineNode[]): string {
  return nodes.map((node) => (node.kind === 'br' ? '\n' : node.text)).join('');
}

/**
 * Converts plain text to inline nodes. Newlines become `<br>` nodes. Empty
 * input produces one empty text node so the layer still has content.
 */
export function plainToInline(text: string): InlineNode[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const limited = Array.from(normalized).slice(0, LIMITS.text.maxCodepointsPerLayer).join('');
  const lines = limited.split('\n');
  const nodes: InlineNode[] = [];

  lines.forEach((line, index) => {
    if (index > 0) nodes.push({ kind: 'br' });
    if (line.length > 0) nodes.push({ kind: 'text', text: line });
  });

  if (nodes.length === 0) nodes.push({ kind: 'text', text: '' });
  return nodes;
}

export function textCodepointLength(text: string): number {
  return Array.from(text).length;
}

/** Counts visual lines for text-height estimation. */
export function inlineLineCount(nodes: readonly InlineNode[]): number {
  let lines = 1;
  for (const node of nodes) {
    if (node.kind === 'br') {
      lines += 1;
    } else {
      lines += node.text.split('\n').length - 1;
    }
  }
  return lines;
}
