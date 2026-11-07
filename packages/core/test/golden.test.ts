import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDesignHtml, serializeDesignDoc } from '../src/index';

const dir = fileURLToPath(new URL('./fixtures/golden/', import.meta.url));
const fixtures = readdirSync(dir)
  .filter((file) => file.endsWith('.html') && !file.endsWith('.golden.html'))
  .sort();

describe('golden files', () => {
  it('covers the three sample designs required for visual regression', () => {
    expect(fixtures).toEqual(['poster-rtl.html', 'social-card.html', 'story-svg.html']);
  });

  it.each(fixtures)('%s parses cleanly and serializes to its golden output', (file) => {
    const input = readFileSync(join(dir, file), 'utf8');
    const { doc, warnings } = parseDesignHtml(input);
    expect(warnings).toEqual([]);

    const html = serializeDesignDoc(doc);
    const goldenPath = join(dir, file.replace(/\.html$/, '.golden.html'));
    if (process.env.UPDATE_GOLDENS === '1') {
      writeFileSync(goldenPath, html, 'utf8');
    }
    const golden = readFileSync(goldenPath, 'utf8').replace(/\r\n/g, '\n');
    expect(html).toBe(golden);
  });
});
