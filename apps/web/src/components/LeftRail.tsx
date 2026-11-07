import { useRef, type ChangeEvent } from 'react';
import { LIMITS, type DesignDoc, type Layer } from '@poster/core';
import type { AssetEntry } from '../editor/assets.js';
import { formatBytes } from '../editor/assets.js';
import {
  ELEMENT_KINDS,
  ELEMENT_LABELS,
  TEXT_PRESETS,
  layerSummary,
  type ElementKind,
  type ReorderMove,
  type TextPreset,
} from '../editor/layers.js';
import { AiPanel, type AiPanelProps } from './AiPanel.js';
import { Button, IconButton, Spinner } from './controls.js';
import { DocPreview } from './DocPreview.js';
import { Icon, type IconName } from './icons.js';

export type PanelId = 'templates' | 'elements' | 'text' | 'uploads' | 'layers' | 'ai';

const PANEL_META: Record<PanelId, { title: string; icon: IconName }> = {
  templates: { title: 'القوالب', icon: 'templates' },
  elements: { title: 'العناصر', icon: 'elements' },
  text: { title: 'النصوص', icon: 'text' },
  uploads: { title: 'الصور', icon: 'uploads' },
  layers: { title: 'الطبقات', icon: 'layers' },
  ai: { title: 'المساعد', icon: 'sparkles' },
};

const RAIL_ITEMS: PanelId[] = ['templates', 'elements', 'text', 'uploads', 'layers', 'ai'];

const TYPE_ICON: Record<Layer['type'], IconName> = {
  text: 'textLayer',
  shape: 'shape',
  image: 'image',
  svg: 'svgLayer',
};

function ElementThumb({ kind }: { kind: ElementKind }) {
  if (kind === 'star') {
    return (
      <svg viewBox="0 0 100 100" className="el-svg" aria-hidden="true">
        <path
          d="M50 6 L62 36 L95 38 L69 59 L78 92 L50 72 L22 92 L31 59 L5 38 L38 36 Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (kind === 'check') {
    return (
      <svg viewBox="0 0 100 100" className="el-svg" aria-hidden="true">
        <circle cx="50" cy="50" r="44" fill="currentColor" />
        <path
          d="M28 52 L45 68 L74 33"
          fill="none"
          stroke="#0b0e12"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'arrow') {
    return (
      <svg viewBox="0 0 100 100" className="el-svg" aria-hidden="true">
        <path
          d="M8 50 H78 M58 28 L80 50 L58 72"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return <span className={`el-thumb el-thumb--${kind}`} aria-hidden="true" />;
}

function LayerRow({
  layer,
  selected,
  onSelect,
  onToggleHidden,
  onToggleLocked,
  onReorder,
  onStartEditText,
  first,
  last,
}: {
  layer: Layer;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onReorder: (id: string, move: ReorderMove) => void;
  onStartEditText: (id: string) => void;
  first: boolean;
  last: boolean;
}) {
  return (
    <div
      className={`layer-row${selected ? ' is-selected' : ''}${layer.hidden ? ' is-hidden' : ''}`}
      role="button"
      tabIndex={0}
      onClick={(event) => onSelect(layer.id, event.shiftKey || event.metaKey || event.ctrlKey)}
      onDoubleClick={() => {
        if (layer.type === 'text') onStartEditText(layer.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(layer.id, event.shiftKey);
        }
      }}
    >
      <span className={`layer-type layer-type--${layer.type}`}>
        <Icon name={TYPE_ICON[layer.type]} size={15} />
      </span>
      <span className="layer-info">
        <span className="layer-name">{layer.name}</span>
        <span className="layer-summary">{layerSummary(layer)}</span>
      </span>
      <span className="layer-row-actions">
        <span className="layer-order">
          <button
            type="button"
            className="mini-button"
            title="للأمام"
            aria-label="نقل الطبقة للأمام"
            disabled={last}
            onClick={(event) => {
              event.stopPropagation();
              onReorder(layer.id, 'forward');
            }}
          >
            <Icon name="up" size={13} />
          </button>
          <button
            type="button"
            className="mini-button"
            title="للخلف"
            aria-label="نقل الطبقة للخلف"
            disabled={first}
            onClick={(event) => {
              event.stopPropagation();
              onReorder(layer.id, 'backward');
            }}
          >
            <Icon name="down" size={13} />
          </button>
        </span>
        <button
          type="button"
          className={`mini-button${layer.hidden ? ' is-on' : ''}`}
          title={layer.hidden ? 'إظهار' : 'إخفاء'}
          aria-label={layer.hidden ? 'إظهار الطبقة' : 'إخفاء الطبقة'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleHidden(layer.id);
          }}
        >
          <Icon name={layer.hidden ? 'eyeOff' : 'eye'} size={14} />
        </button>
        <button
          type="button"
          className={`mini-button${layer.locked ? ' is-on' : ''}`}
          title={layer.locked ? 'فتح القفل' : 'قفل'}
          aria-label={layer.locked ? 'فتح قفل الطبقة' : 'قفل الطبقة'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleLocked(layer.id);
          }}
        >
          <Icon name={layer.locked ? 'lock' : 'unlock'} size={14} />
        </button>
      </span>
    </div>
  );
}

export type LeftRailProps = {
  panel: PanelId | null;
  onPanelChange: (panel: PanelId) => void;
  onClosePanel: () => void;
  doc: DesignDoc;
  selection: string[];
  assets: AssetEntry[];
  onSelect: (ids: string[]) => void;
  onAddTemplate: (doc: DesignDoc, name: string) => void;
  onAddText: (preset: TextPreset) => void;
  onAddElement: (kind: ElementKind) => void;
  onUpload: (files: FileList) => void;
  uploadBusy: boolean;
  onAddImage: (asset: AssetEntry) => void;
  onRemoveAsset: (asset: AssetEntry) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onDuplicate: (ids: string[]) => void;
  onReorder: (id: string, move: ReorderMove) => void;
  onStartEditText: (id: string) => void;
  templates: readonly { id: string; name: string; doc: DesignDoc }[];
  ai: AiPanelProps;
};

export function LeftRail({
  panel,
  onPanelChange,
  onClosePanel,
  doc,
  selection,
  assets,
  onSelect,
  onAddTemplate,
  onAddText,
  onAddElement,
  onUpload,
  uploadBusy,
  onAddImage,
  onRemoveAsset,
  onToggleHidden,
  onToggleLocked,
  onDelete,
  onDuplicate,
  onReorder,
  onStartEditText,
  templates,
  ai,
}: LeftRailProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onUpload(event.target.files);
    }
    event.target.value = '';
  };

  const meta = panel ? PANEL_META[panel] : null;

  return (
    <>
      <nav className="rail" aria-label="أدوات المحرر">
        <div className="rail-top">
          {RAIL_ITEMS.map((item) => {
            const info = PANEL_META[item];
            const active = panel === item;
            return (
              <button
                key={item}
                type="button"
                className={`rail-button${active ? ' is-active' : ''}`}
                onClick={() => onPanelChange(item)}
                aria-pressed={active}
                title={info.title}
              >
                <span className="rail-icon">
                  <Icon name={info.icon} size={21} />
                </span>
                <span className="rail-label">{info.title}</span>
              </button>
            );
          })}
        </div>
        <div className="rail-bottom">
          <span className="rail-version">M7</span>
        </div>
      </nav>

      {panel && meta ? (
        <aside className="panel" aria-label={meta.title}>
          <header className="panel-header">
            <span className="panel-icon">
              <Icon name={meta.icon} size={17} />
            </span>
            <h2>{meta.title}</h2>
            <IconButton icon="close" label="إغلاق اللوحة" size="sm" onClick={onClosePanel} />
          </header>

          <div className="panel-body">
            {panel === 'templates' ? (
              <div className="templates">
                <p className="panel-hint">ابدأ من قالب جاهز، ثم عدّل النصوص والألوان. يمكنك التراجع دائماً.</p>
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="template-card"
                    onClick={() => onAddTemplate(template.doc, template.name)}
                  >
                    <DocPreview doc={template.doc} width={248} />
                    <span className="template-meta">
                      <strong>{template.name}</strong>
                      <small>
                        {template.doc.width} × {template.doc.height}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {panel === 'elements' ? (
              <div className="elements">
                <p className="panel-hint">أشكال أساسية تُضاف إلى منتصف اللوحة وتبقى قابلة للتحرير.</p>
                <div className="elements-grid">
                  {ELEMENT_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className="element-button"
                      onClick={() => onAddElement(kind)}
                      title={`إضافة ${ELEMENT_LABELS[kind]}`}
                    >
                      <span className="element-preview">
                        <ElementThumb kind={kind} />
                      </span>
                      <span>{ELEMENT_LABELS[kind]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {panel === 'text' ? (
              <div className="text-presets">
                <p className="panel-hint">أنماط نصية جاهزة بخطوط عربية ولاتينية مستضافة ذاتياً.</p>
                {TEXT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="text-preset"
                    onClick={() => onAddText(preset)}
                  >
                    <span
                      className="text-preset-preview"
                      dir={preset.dir}
                      style={{
                        fontFamily: `'${preset.fontFamily}', sans-serif`,
                        fontWeight: preset.fontWeight,
                        textAlign: preset.align,
                      }}
                    >
                      {preset.content}
                    </span>
                    <span className="text-preset-meta">
                      <strong>{preset.label}</strong>
                      <small>
                        {preset.fontFamily} · {preset.fontSize}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {panel === 'uploads' ? (
              <div className="uploads">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  hidden
                  onChange={handleFiles}
                />
                <Button
                  icon="uploads"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadBusy}
                  full
                >
                  {uploadBusy ? 'جارٍ الرفع…' : 'إضافة صور'}
                </Button>
                <p className="panel-hint">
                  PNG أو JPEG أو WebP، حتى 10 ميغابايت و{LIMITS.assets.maxPerDocument} صورة لكل
                  تصميم. تُحفظ الصور محليًا وتبقى بعد إعادة تحميل الصفحة.
                </p>
                {uploadBusy ? <Spinner size={18} /> : null}
                {assets.length === 0 ? (
                  <div className="empty-state">
                    <Icon name="image" size={28} />
                    <p>لا توجد صور بعد. أضف صورة لتظهر هنا.</p>
                  </div>
                ) : (
                  <div className="assets-grid">
                    {assets.map((asset) => (
                      <div key={asset.id} className="asset-card">
                        <button
                          type="button"
                          className="asset-add"
                          onClick={() => onAddImage(asset)}
                          title="إضافة الصورة إلى اللوحة"
                        >
                          <img src={asset.url} alt={asset.name} draggable={false} />
                        </button>
                        <div className="asset-meta">
                          <span className="asset-name">{asset.name}</span>
                          <span className="asset-dims">
                            {asset.width}×{asset.height} · {formatBytes(asset.bytes)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="asset-remove"
                          onClick={() => onRemoveAsset(asset)}
                          aria-label={`حذف ${asset.name}`}
                          title="حذف الصورة"
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {panel === 'layers' ? (
              <div className="layers-panel">
                <p className="panel-hint">الطبقة الأعلى تظهر أولاً. انقر لتحديد، Shift لتحديد عدة طبقات.</p>
                {doc.layers.length === 0 ? (
                  <div className="empty-state">
                    <Icon name="layers" size={28} />
                    <p>لا توجد طبقات. أضف نصاً أو عنصراً للبدء.</p>
                  </div>
                ) : (
                  <div className="layer-list">
                    {doc.layers
                      .slice()
                      .reverse()
                      .map((layer, index, all) => (
                        <LayerRow
                          key={layer.id}
                          layer={layer}
                          selected={selection.includes(layer.id)}
                          onSelect={(id, additive) => {
                            if (additive) {
                              onSelect(
                                selection.includes(id)
                                  ? selection.filter((item) => item !== id)
                                  : [...selection, id],
                              );
                            } else {
                              onSelect([id]);
                            }
                          }}
                          onToggleHidden={onToggleHidden}
                          onToggleLocked={onToggleLocked}
                          onReorder={onReorder}
                          onStartEditText={onStartEditText}
                          first={index === all.length - 1}
                          last={index === 0}
                        />
                      ))}
                  </div>
                )}
                <div className="layers-footer">
                  <Button
                    icon="duplicate"
                    onClick={() => onDuplicate(selection)}
                    disabled={selection.length === 0}
                  >
                    تكرار
                  </Button>
                  <Button
                    icon="trash"
                    variant="danger"
                    onClick={() => onDelete(selection)}
                    disabled={selection.length === 0}
                  >
                    حذف
                  </Button>
                </div>
              </div>
            ) : null}

            {panel === 'ai' ? <AiPanel {...ai} /> : null}
          </div>
        </aside>
      ) : null}
    </>
  );
}
