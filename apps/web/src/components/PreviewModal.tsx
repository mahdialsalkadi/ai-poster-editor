import { useEffect, useRef, useState } from 'react';
import type { DesignDoc } from '@poster/core';
import { useI18n } from '../i18n.js';
import type { AssetEntry } from '../editor/assets.js';
import { IconButton } from './controls.js';
import { DocPreview } from './DocPreview.js';

export type PreviewModalProps = {
  doc: DesignDoc;
  assets: readonly AssetEntry[];
  onClose: () => void;
};

type Backdrop = 'dark' | 'light' | 'checker';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;

export function PreviewModal({ doc, assets, onClose }: PreviewModalProps) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [backdrop, setBackdrop] = useState<Backdrop>('dark');
  const [fullscreen, setFullscreen] = useState(false);
  const [fitScale, setFitScale] = useState(0.5);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measure = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      const next = Math.min(
        1,
        Math.max(MIN_ZOOM, Math.min((box.width - 48) / doc.width, (box.height - 48) / doc.height)),
      );
      setFitScale(next);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [doc.width, doc.height, fullscreen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    const onFullscreen = () => setFullscreen(document.fullscreenElement !== null);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [onClose]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  const images = doc.layers.filter((layer) => layer.type === 'image').length;

  const step = (direction: 1 | -1) => {
    const current = zoom === 'fit' ? fitScale : zoom;
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * (direction === 1 ? 1.15 : 0.87))));
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void panelRef.current?.requestFullscreen?.();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('previewDesign')}>
      <div className="modal-panel preview-panel" ref={panelRef} data-testid="preview-panel">
        <header className="modal-header">
          <h2>{t('previewDesign')}</h2>
          <div className="preview-toolbar" role="toolbar" aria-label={t('previewDesign')}>
            <button
              type="button"
              className="preview-button"
              data-testid="preview-zoom-out"
              aria-label={t('zoomOut')}
              onClick={() => step(-1)}
            >
              −
            </button>
            <span className="preview-zoom" data-testid="preview-zoom">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="preview-button"
              data-testid="preview-zoom-in"
              aria-label={t('zoomIn')}
              onClick={() => step(1)}
            >
              +
            </button>
            <button
              type="button"
              className="preview-button"
              data-testid="preview-fit"
              onClick={() => setZoom('fit')}
            >
              {t('fitToScreen')}
            </button>
            <button
              type="button"
              className="preview-button"
              data-testid="preview-actual"
              onClick={() => setZoom(1)}
            >
              {t('actualSize')}
            </button>
            <span className="preview-divider" aria-hidden="true" />
            {(['dark', 'light', 'checker'] as Backdrop[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`preview-button${backdrop === option ? ' is-active' : ''}`}
                data-testid={`preview-backdrop-${option}`}
                aria-pressed={backdrop === option}
                onClick={() => setBackdrop(option)}
              >
                {t(
                  option === 'dark'
                    ? 'backdropDark'
                    : option === 'light'
                      ? 'backdropLight'
                      : 'backdropChecker',
                )}
              </button>
            ))}
            <button
              type="button"
              className="preview-button"
              data-testid="preview-fullscreen"
              onClick={toggleFullscreen}
            >
              {fullscreen ? t('exitFullscreen') : t('fullscreen')}
            </button>
          </div>
          <IconButton icon="close" label={t('close')} onClick={onClose} />
        </header>

        <div className={`preview-stage preview-stage--${backdrop}`} data-testid="preview-stage">
          <DocPreview doc={doc} width={Math.max(1, Math.round(doc.width * scale))} />
        </div>

        <footer className="preview-footer">
          <span>
            {t('artboardSize')}: {doc.width} × {doc.height}
          </span>
          <span>{t('assetsUsed', { images, total: assets.length })}</span>
        </footer>
      </div>
    </div>
  );
}
