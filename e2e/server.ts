import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../apps/server/src/app.js';
import { AiService } from '../apps/server/src/ai/service.js';
import type { AiProvider } from '../apps/server/src/ai/provider.js';
import { DailySpendLedger } from '../apps/server/src/ai/spend.js';
import { SlidingWindowLimiter } from '../apps/server/src/ai/rate-limit.js';
import { closeExportBrowser } from '../apps/server/src/export/renderer.js';
import { parseDesignHtml, serializeDesignDoc } from '../packages/core/src/index.js';
import { qualityDoc } from './fixtures.js';

// This fixture must never become a public deployment mode or read private .env.
if (process.env.POSTER_E2E !== 'true')
  throw new Error('Only the Playwright fixture may start this loopback test server');
const root = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
if (!existsSync(resolve(root, 'index.html')))
  throw new Error('Run pnpm build before browser tests');

const provider: AiProvider = {
  name: 'e2e-mock',
  model: 'e2e-mock-no-network',
  async complete(messages) {
    const user = messages.find((message) => message.role === 'user')?.content ?? '';
    let text: string;
    if (user.includes('E2E_INVALID_OUTPUT'))
      text = '<div class="artboard"><script>invalid</script></div>';
    else if (user.startsWith('Selected layer ids:')) {
      const html = /<untrusted_design_data>\s*([\s\S]*?)\s*<\/untrusted_design_data>/.exec(
        user,
      )?.[1];
      if (!html) throw new Error('Missing fixture edit document');
      const doc = parseDesignHtml(html).doc;
      const ids = (/^Selected layer ids: (.*)$/m.exec(user)?.[1] ?? '').split(', ');
      const instruction =
        user.split('Instruction (authoritative, outside the data block):\n')[1]?.split('\n')[0] ??
        'Edit';
      doc.layers = doc.layers
        .filter((layer) => ids.includes(layer.id))
        .map((layer) =>
          layer.type === 'text'
            ? { ...layer, content: [{ kind: 'text' as const, text: `AI edit: ${instruction}` }] }
            : layer,
        );
      text = serializeDesignDoc(doc);
    } else {
      const dimensions = /Artboard: (\d+) x (\d+) px\./.exec(user);
      if (!dimensions) throw new Error('Missing fixture dimensions');
      text = serializeDesignDoc(qualityDoc(Number(dimensions[1]), Number(dimensions[2])));
    }
    return { text, model: 'e2e-mock-no-network', inputTokens: 20, outputTokens: 20, latencyMs: 1 };
  },
};
const limiter = () => new SlidingWindowLimiter(1000, 60_000);
const ai = new AiService({
  provider,
  prices: { inputPerMTok: 0, outputPerMTok: 0 },
  ledger: new DailySpendLedger(1),
  maxOutputTokens: 1000,
  timeoutMs: 2000,
  generateLimiter: limiter(),
  editLimiter: limiter(),
  sessionLimiter: limiter(),
});
const app = await buildServer({
  logger: false,
  auth: null,
  ai,
  rateLimits: { designPerMinute: 1000, exportPerMinute: 1000 },
});
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};
app.get('/*', async (request, reply) => {
  if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Unknown API route' });
  const pathname = decodeURIComponent(request.url.split('?')[0] ?? '/');
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) return reply.code(404).send();
  try {
    return reply
      .header('x-content-type-options', 'nosniff')
      .type(mime[extname(path)] ?? 'application/octet-stream')
      .send(await readFile(path));
  } catch {
    return reply.code(404).send();
  }
});
const shutdown = async () => {
  await app.close();
  await closeExportBrowser();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
await app.listen({ host: '127.0.0.1', port: 4190 });
