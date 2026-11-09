import { DesignError, LIMITS } from '@poster/core';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { BrowserRenderJobPayload } from './worker-protocol.js';

export type RenderedExport = {
  bytes: Buffer;
  width: number;
  height: number;
  contentType: string;
};

export type BrowserRenderJob = BrowserRenderJobPayload;

let browserPromise: Promise<Browser> | null = null;

function browser(sandbox: boolean): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ chromiumSandbox: sandbox }).catch((cause: unknown) => {
      browserPromise = null;
      throw new DesignError('EXPORT_FAILED', 'The export browser could not start', 'export', {
        reason: cause instanceof Error ? cause.message : 'unknown',
      });
    });
  }
  return browserPromise;
}

export async function closeRendererBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  const instance = await pending.catch(() => null);
  await instance?.close();
}

function withTimeout<T>(promise: Promise<T>, path: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DesignError('EXPORT_FAILED', 'The export worker timed out', path));
    }, LIMITS.export.timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

/**
 * Renders a self-contained document in a fresh, JavaScript-free context. Every
 * http(s) request is aborted by the route interceptor, the document also carries
 * a `default-src 'none'` CSP, and the context is offline. `data:` URLs are the
 * only permitted subresources because fonts and images are embedded in the HTML.
 */
export async function renderHtml(job: BrowserRenderJob): Promise<RenderedExport> {
  let context: BrowserContext | undefined;
  try {
    const instance = await browser(job.sandbox);
    context = await instance.newContext({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: job.format === 'pdf' ? 2 : job.scale,
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: 'block',
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:')) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(LIMITS.export.timeoutMs);

    await withTimeout(page.setContent(job.html, { waitUntil: 'load' }), 'export');
    // Fixed string, not page-authored input. Page scripts stay disabled.
    await withTimeout(page.evaluate('document.fonts.ready'), 'export');

    if (job.format === 'pdf') {
      const bytes = await withTimeout(
        page.pdf({
          // Playwright wants px/in/cm/mm; 1 CSS px = 0.75pt = 1/96in.
          width: `${((job.width * 0.75) / 72).toFixed(4)}in`,
          height: `${((job.height * 0.75) / 72).toFixed(4)}in`,
          printBackground: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          pageRanges: '1',
        }),
        'export',
      );
      return { bytes, width: job.width, height: job.height, contentType: 'application/pdf' };
    }

    const bytes = await withTimeout(
      job.format === 'jpeg'
        ? page.screenshot({
            type: 'jpeg',
            quality: Math.round(job.quality * 100),
            animations: 'disabled',
            caret: 'hide',
          })
        : page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }),
      'export',
    );

    return {
      bytes,
      width: job.width * job.scale,
      height: job.height * job.scale,
      contentType: job.format === 'jpeg' ? 'image/jpeg' : 'image/png',
    };
  } catch (cause) {
    if (cause instanceof DesignError) throw cause;
    throw new DesignError('EXPORT_FAILED', 'The export renderer failed', 'export');
  } finally {
    await context?.close().catch(() => undefined);
  }
}
