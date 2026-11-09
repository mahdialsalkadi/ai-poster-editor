import { useMemo, useRef, useState } from 'react';
import type { DesignDoc } from '@poster/core';
import { EXPORT_LIMITS, type ExportFormat } from '@poster/contracts';
import type { AssetEntry } from '../editor/assets.js';
import {
  downloadBlob,
  exportDesign,
  formatBytes,
  type ExportOutput,
  type ExportScale,
} from '../editor/export.js';
import { Button, Field, IconButton, Segmented, Slider, Spinner } from './controls.js';
import { Icon } from './icons.js';

const FORMATS: { value: ExportFormat; label: string; title: string }[] = [
  { value: 'png', label: 'PNG', title: 'PNG بخلفية كاملة أو شفافة' },
  { value: 'jpeg', label: 'JPG', title: 'JPEG مسطح بجودة قابلة للضبط' },
  { value: 'pdf', label: 'PDF', title: 'صفحة PDF بمقاس اللوحة' },
  { value: 'html', label: 'HTML', title: 'نسخة HTML مستقلة بذاتها' },
];

const SCALES: ExportScale[] = [1, 2, 3];

function createKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export type ExportDialogProps = {
  doc: DesignDoc;
  assets: readonly AssetEntry[];
  name: string;
  onUnauthorized: () => void;
  onClose: () => void;
};

export function ExportDialog({ doc, assets, name, onUnauthorized, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState<ExportScale>(2);
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<ExportOutput | null>(null);
  const idempotencyKey = useRef(createKey());

  // A key identifies one exact request: changing an option must not replay an
  // earlier export from the server cache.
  const resetOutput = () => {
    idempotencyKey.current = createKey();
    setOutput(null);
    setError(null);
  };

  const raster = format === 'png' || format === 'jpeg';
  const factor = raster ? scale : 1;
  const width = doc.width * factor;
  const height = doc.height * factor;
  const pixels = width * height;
  const overLimit = raster && pixels > EXPORT_LIMITS.maxOutputPixels;
  const pointWidth = Math.round(doc.width * 0.75);
  const pointHeight = Math.round(doc.height * 0.75);

  const sizeLabel = useMemo(() => {
    if (format === 'html') return 'مستند HTML مستقل';
    if (format === 'pdf') return `${pointWidth} × ${pointHeight} pt`;
    return `${width} × ${height} px`;
  }, [format, height, pointWidth, pointHeight, width]);

  const run = async () => {
    if (busy || overLimit) return;
    setBusy(true);
    setError(null);
    const result = await exportDesign({
      doc,
      assets,
      name,
      format,
      scale,
      quality: quality / 100,
      idempotencyKey: idempotencyKey.current,
    });
    setBusy(false);
    if (!result.ok) {
      setOutput(null);
      setError(result.message);
      if (result.code === 'UNAUTHORIZED') onUnauthorized();
      return;
    }
    setOutput(result.data);
    downloadBlob(result.data.blob, result.data.filename);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="تصدير التصميم">
      <div className="modal-panel export-panel">
        <header className="modal-header">
          <h2>تصدير التصميم</h2>
          <IconButton icon="close" label="إغلاق التصدير" onClick={onClose} disabled={busy} />
        </header>

        <div className="modal-body export-body">
          <Field label="الصيغة">
            <Segmented
              value={format}
              onChange={(next) => {
                setFormat(next);
                resetOutput();
              }}
              options={FORMATS}
              ariaLabel="صيغة التصدير"
            />
          </Field>

          <Field
            label="الدقة"
            hint={raster ? 'كل مضاعف يضاعف أبعاد البكسل.' : 'مقاس PDF وHTML يتبع اللوحة دائمًا.'}
          >
            <Segmented
              value={String(scale) as '1' | '2' | '3'}
              onChange={(next) => {
                setScale(Number(next) as ExportScale);
                resetOutput();
              }}
              options={SCALES.map((value) => ({
                value: String(value) as '1' | '2' | '3',
                label: `${value}×`,
                title: `${value}× (${doc.width * value} × ${doc.height * value} بكسل)`,
              }))}
              ariaLabel="دقة التصدير"
            />
          </Field>

          {format === 'jpeg' ? (
            <Field label="الجودة">
              <Slider
                value={quality}
                onChange={(value) => {
                  setQuality(value);
                  resetOutput();
                }}
                min={40}
                max={100}
                ariaLabel="جودة JPEG"
              />
            </Field>
          ) : null}

          <div className="export-summary">
            <span>
              <Icon name="image" size={16} />
              {sizeLabel}
            </span>
            <span className="export-summary-note">
              {format === 'html'
                ? 'ملف واحد بخطوطه وصوره، بلا أي مرجع خارجي.'
                : format === 'pdf'
                  ? 'صفحة واحدة بلا هوامش، النص يبقى متجهًا.'
                  : `${(pixels / 1_000_000).toFixed(1)} ميجابكسل`}
            </span>
          </div>

          {overLimit ? (
            <p className="export-error" role="alert">
              الناتج يتجاوز حد {EXPORT_LIMITS.maxOutputPixels / 1_000_000} ميجابكسل. اختر دقة أقل.
            </p>
          ) : null}

          {error ? (
            <p className="export-error" role="alert">
              {error}
            </p>
          ) : null}

          {output ? (
            <div className="export-result">
              <div>
                <strong>تم إنشاء الملف</strong>
                <span>
                  {formatBytes(output.blob.size)} · {output.width} × {output.height}
                  {output.cacheHit ? ' · من الذاكرة المؤقتة' : ` · ${output.durationMs}ms`}
                </span>
              </div>
              <Button icon="download" onClick={() => downloadBlob(output.blob, output.filename)}>
                تنزيل مرة أخرى
              </Button>
            </div>
          ) : null}

          <div className="export-actions">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              إغلاق
            </Button>
            <Button
              variant="primary"
              icon="download"
              onClick={() => void run()}
              disabled={busy || overLimit}
            >
              {busy ? (
                <>
                  <Spinner size={15} /> جارٍ التصدير…
                </>
              ) : (
                'تصدير وتنزيل'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
