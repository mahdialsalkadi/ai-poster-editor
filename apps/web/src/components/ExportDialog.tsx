import { useMemo, useRef, useState } from 'react';
import type { DesignDoc } from '@poster/core';
import { EXPORT_LIMITS, type ExportFormat } from '@poster/contracts';
import { useI18n, type MessageKey } from '../i18n.js';
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

const FORMATS: { value: ExportFormat; label: string; title: MessageKey }[] = [
  { value: 'png', label: 'PNG', title: 'pngTitle' },
  { value: 'jpeg', label: 'JPG', title: 'jpegTitle' },
  { value: 'pdf', label: 'PDF', title: 'pdfTitle' },
  { value: 'html', label: 'HTML', title: 'htmlTitle' },
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
  const { t } = useI18n();
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
    if (format === 'html') return t('independentHtmlDoc');
    if (format === 'pdf') return `${pointWidth} × ${pointHeight} pt`;
    return `${width} × ${height} px`;
  }, [format, height, pointWidth, pointHeight, t, width]);

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
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('exportDesign')}>
      <div className="modal-panel export-panel">
        <header className="modal-header">
          <h2>{t('exportDesign')}</h2>
          <IconButton icon="close" label={t('closeExport')} onClick={onClose} disabled={busy} />
        </header>

        <div className="modal-body export-body">
          <Field label={t('format')}>
            <Segmented
              value={format}
              onChange={(next) => {
                setFormat(next);
                resetOutput();
              }}
              options={FORMATS.map((item) => ({ ...item, title: t(item.title) }))}
              ariaLabel={t('exportFormat')}
            />
          </Field>

          <Field
            label={t('resolution')}
            hint={raster ? t('resolutionHintRaster') : t('resolutionHintVector')}
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
                title: t('pixelSize', {
                  value,
                  width: doc.width * value,
                  height: doc.height * value,
                }),
              }))}
              ariaLabel={t('exportResolution')}
            />
          </Field>

          {format === 'jpeg' ? (
            <Field label={t('quality')}>
              <Slider
                value={quality}
                onChange={(value) => {
                  setQuality(value);
                  resetOutput();
                }}
                min={40}
                max={100}
                ariaLabel={t('jpegQuality')}
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
                ? t('htmlSummary')
                : format === 'pdf'
                  ? t('pdfSummary')
                  : t('megapixels', { value: (pixels / 1_000_000).toFixed(1) })}
            </span>
          </div>

          {overLimit ? (
            <p className="export-error" role="alert">
              {t('overLimit', { limit: EXPORT_LIMITS.maxOutputPixels / 1_000_000 })}
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
                <strong>{t('fileCreated')}</strong>
                <span>
                  {formatBytes(output.blob.size)} · {output.width} × {output.height}
                  {output.cacheHit ? ` · ${t('fromCache')}` : ` · ${output.durationMs}ms`}
                </span>
              </div>
              <Button icon="download" onClick={() => downloadBlob(output.blob, output.filename)}>
                {t('downloadAgain')}
              </Button>
            </div>
          ) : null}

          <div className="export-actions">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('close')}
            </Button>
            <Button
              variant="primary"
              icon="download"
              onClick={() => void run()}
              disabled={busy || overLimit}
            >
              {busy ? (
                <>
                  <Spinner size={15} /> {t('exporting')}
                </>
              ) : (
                t('exportAndDownload')
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
