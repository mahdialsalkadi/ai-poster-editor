import { DesignError, LIMITS } from '@poster/core';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { ExportOptions } from '@poster/contracts';
import type { DesignDoc } from '@poster/core';
import type { ExportAssets } from './serialize.js';
import { serializeForExport } from './serialize.js';

export type RenderedExport = {
  bytes: Buffer;
  width: number;
  height: number;
  contentType: string;
};

let browserPromise: Promise<Browser> | null = null;

function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch().catch((cause: unknown) => {
      browserPromise = null;
      throw new DesignError('EXPORT_FAILED', 'The export browser could not start', 'export', {
        reason: cause instanceof Error ? cause.message : 'unknown',
      });
    });
  }
  return browserPromise;
}

export async function closeExportBrowser(): Promise<void> {
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
 * Renders the self-contained document in a fresh, JavaScript-free context. The
 * page is the only input: no editor DOM and no network (contract §12.1).
 */
export async function renderDesign(input: {
  doc: DesignDoc;
  assets: ExportAssets;
  options: ExportOptions;
}): Promise<RenderedExport> {
  const { doc, assets, options } = input;
  const html = serializeForExport(doc, assets);

  if (options.format === 'html') {
    return {
      bytes: Buffer.from(html, 'utf8'),
      width: doc.width,
      height: doc.height,
      contentType: 'text/html; charset=utf-8',
    };
  }

  let context: BrowserContext | undefined;
  try {
    const instance = await browser();
    context = await instance.newContext({
      viewport: { width: doc.width, height: doc.height },
      deviceScaleFactor: options.format === 'pdf' ? 2 : options.scale,
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(LIMITS.export.timeoutMs);

    await withTimeout(page.setContent(html, { waitUntil: 'load' }), 'export');
    // Runs in the page; the string form keeps the server's `lib` free of DOM types.
    await withTimeout(page.evaluate('document.fonts.ready'), 'export');

    if (options.format === 'pdf') {
      const bytes = await withTimeout(
        page.pdf({
          // Playwright wants px/in/cm/mm; 1 CSS px = 0.75pt = 1/96in.
          width: `${((doc.width * 0.75) / 72).toFixed(4)}in`,
          height: `${((doc.height * 0.75) / 72).toFixed(4)}in`,
          printBackground: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          pageRanges: '1',
        }),
        'export',
      );
      return { bytes, width: doc.width, height: doc.height, contentType: 'application/pdf' };
    }

    const bytes = await withTimeout(
      options.format === 'jpeg'
        ? page.screenshot({
            type: 'jpeg',
            quality: Math.round(options.quality * 100),
            animations: 'disabled',
            caret: 'hide',
          })
        : page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }),
      'export',
    );

    return {
      bytes,
      width: doc.width * options.scale,
      height: doc.height * options.scale,
      contentType: options.format === 'jpeg' ? 'image/jpeg' : 'image/png',
    };
  } catch (cause) {
    if (cause instanceof DesignError) throw cause;
    throw new DesignError('EXPORT_FAILED', 'The export renderer failed', 'export');
  } finally {
    await context?.close().catch(() => undefined);
  }
}
