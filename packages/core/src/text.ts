import type { InlineNode } from './model.js';

/**
 * Canonical inline text.
 *
 * HTML collapses whitespace, so the model must store text in its collapsed
 * form: otherwise `parse(serialize(doc))` cannot deep-equal `doc` whenever a
 * text node starts or ends with a space. This mirrors the parser exactly
 * (merge adjacent equivalent nodes, drop empty ones, no leading/trailing break).
 */
function collapseWhitespace(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t\n\f\r]+/g, ' ');
}

function sameSpanStyle(
  a: Extract<InlineNode, { kind: 'span' }>,
  b: Extract<InlineNode, { kind: 'span' }>,
): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    (a.color ?? '') === (b.color ?? '')
  );
}

export function canonicalInlineText(nodes: readonly InlineNode[]): InlineNode[] {
  const prepared: InlineNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'br') {
      prepared.push({ kind: 'br' });
      continue;
    }
    const text = collapseWhitespace(node.text);
    if (node.kind === 'text') {
      prepared.push({ kind: 'text', text });
      continue;
    }
    prepared.push({
      kind: 'span',
      text,
      ...(node.bold ? { bold: true } : {}),
      ...(node.italic ? { italic: true } : {}),
      ...(node.underline ? { underline: true } : {}),
      ...(node.color ? { color: node.color } : {}),
    });
  }

  const merged: InlineNode[] = [];
  for (const node of prepared) {
    const last = merged[merged.length - 1];
    if (node.kind === 'br') {
      if (!last || (last.kind === 'br' && merged.at(-2)?.kind === 'br')) continue;
      merged.push(node);
      continue;
    }
    if (!node.text) continue;
    if (last?.kind === 'text' && node.kind === 'text') {
      last.text += node.text;
      continue;
    }
    if (last?.kind === 'span' && node.kind === 'span' && sameSpanStyle(last, node)) {
      last.text += node.text;
      continue;
    }
    merged.push(node);
  }

  // Collapse again after merging so whitespace runs that meet at a node
  // boundary collapse exactly as they do inside a single DOM text node.
  for (const node of merged) {
    if (node.kind !== 'br') node.text = collapseWhitespace(node.text);
  }

  const first = merged[0];
  if (first && first.kind === 'text') first.text = first.text.replace(/^ +/, '');
  const tail = merged[merged.length - 1];
  if (tail && tail.kind === 'text') tail.text = tail.text.replace(/ +$/, '');

  const cleaned = merged.filter((node) => node.kind === 'br' || node.text.length > 0);
  while (cleaned[0]?.kind === 'br') cleaned.shift();
  while (cleaned[cleaned.length - 1]?.kind === 'br') cleaned.pop();
  return cleaned;
}
