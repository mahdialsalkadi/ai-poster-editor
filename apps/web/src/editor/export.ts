import type { DesignDoc } from '@poster/core';
import type { ExportFormat } from '@poster/contracts';
import type { AssetEntry } from './assets.js';

export type ExportScale = 1 | 2 | 3;

export type ExportOutput = {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  durationMs: number;
  cacheHit: boolean;
  id: string;
};

export type ExportResult =
  { ok: true; data: ExportOutput } | { ok: false; message: string; code?: string };

export type ExportInput = {
  doc: DesignDoc;
  assets: readonly AssetEntry[];
  name: string;
  format: ExportFormat;
  scale: ExportScale;
  quality: number;
  idempotencyKey: string;
};

const EXTENSION: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  pdf: 'pdf',
  html: 'html',
};

function safeBaseName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || 'poster';
}

function referencedAssetIds(doc: DesignDoc): string[] {
  const ids = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.type !== 'image' || layer.hidden || !layer.src.startsWith('asset:')) continue;
    ids.add(layer.src.slice('asset:'.length));
  }
  return [...ids];
}

type ErrorBody = { error?: { code?: string; message?: string } };

/**
 * Sends the canonical document and only the referenced image bytes to
 * `POST /api/export` as multipart/form-data (docs/contract.md §12.1).
 */
export async function exportDesign(input: ExportInput): Promise<ExportResult> {
  const byId = new Map(input.assets.map((asset) => [asset.id, asset]));
  const form = new FormData();

  form.append(
    'options',
    JSON.stringify({
      format: input.format,
      scale: input.scale,
      quality: input.quality,
      idempotencyKey: input.idempotencyKey,
    }),
  );
  form.append('doc', JSON.stringify(input.doc));

  try {
    for (const id of referencedAssetIds(input.doc)) {
      const asset = byId.get(id);
      if (!asset) {
        return {
          ok: false,
          code: 'ASSET_UNRESOLVED',
          message: `الصورة ${id} غير موجودة في مكتبة الصور. أعد رفعها ثم حاول مجددًا.`,
        };
      }
      const blob = await (await fetch(asset.url)).blob();
      form.append(`asset:${id}`, blob, `${asset.name}.${EXTENSION[input.format]}`);
    }
  } catch {
    return { ok: false, message: 'تعذر قراءة إحدى الصور. أعد رفعها ثم حاول مجددًا.' };
  }

  let response: Response;
  try {
    response = await fetch('/api/export', { method: 'POST', body: form, credentials: 'include' });
  } catch {
    return { ok: false, message: 'تعذر الاتصال بالخادم. تأكد من تشغيل واجهة API.' };
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const body =
      typeof payload === 'object' && payload !== null ? (payload as ErrorBody) : ({} as ErrorBody);
    return {
      ok: false,
      message: body.error?.message ?? `فشل التصدير (${response.status})`,
      ...(body.error?.code ? { code: body.error.code } : {}),
    };
  }

  const blob = await response.blob();
  const numberHeader = (name: string, fallback: number): number => {
    const value = Number.parseInt(response.headers.get(name) ?? '', 10);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    ok: true,
    data: {
      blob,
      filename: `${safeBaseName(input.name)}.${EXTENSION[input.format]}`,
      width: numberHeader('x-export-width', input.doc.width),
      height: numberHeader('x-export-height', input.doc.height),
      durationMs: numberHeader('x-export-duration-ms', 0),
      cacheHit: response.headers.get('x-export-cache') === 'hit',
      id: response.headers.get('x-export-id') ?? '',
    },
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
