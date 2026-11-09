import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const critical = { lines: 90, statements: 90, functions: 100, branches: 80 };

export default defineConfig({
  resolve: {
    alias: {
      '@poster/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@poster/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/**'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/core/src/**/*.ts', 'packages/contracts/src/**/*.ts'],
      thresholds: Object.fromEntries(
        ['parse', 'style', 'css-guard', 'merge', 'merge-scoped'].map((name) => [
          `packages/core/src/${name}.ts`,
          critical,
        ]),
      ),
    },
  },
});
