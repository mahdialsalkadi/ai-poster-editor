import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesignError } from '@poster/core';

const WEIGHTS = [400, 700] as const;
const SUBSETS = ['arabic', 'latin'] as const;

const cache = new Map<string, string>();

function slugOf(family: string): string {
  return family.trim().toLowerCase().replace(/\s+/g, '-');
}

function fontDirectory(family: string): string {
  return fileURLToPath(
    new URL(
      `../../../../apps/web/node_modules/@fontsource/${slugOf(family)}/files/`,
      import.meta.url,
    ),
  );
}

function faceRule(family: string, weight: number, file: string): string {
  const bytes = readFileSync(file);
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');}`;
}

/**
 * Embeds the fonts a document actually uses as inline woff2 data URIs, so the
 * exported document has no external reference at all (contract §12.1).
 */
export function buildFontCss(families: Iterable<string>): string {
  const rules: string[] = [];

  for (const family of [...new Set(families)].sort()) {
    const cached = cache.get(family);
    if (cached) {
      rules.push(cached);
      continue;
    }

    const directory = fontDirectory(family);
    const slug = slugOf(family);
    const familyRules: string[] = [];
    for (const weight of WEIGHTS) {
      for (const subset of SUBSETS) {
        const file = join(directory, `${slug}-${subset}-${weight}-normal.woff2`);
        if (existsSync(file)) familyRules.push(faceRule(family, weight, file));
      }
    }

    if (familyRules.length === 0) {
      throw new DesignError(
        'INTERNAL_ERROR',
        `Font ${family} is not available for export`,
        'fontFamily',
      );
    }

    const css = familyRules.join('\n');
    cache.set(family, css);
    rules.push(css);
  }

  return rules.join('\n');
}
