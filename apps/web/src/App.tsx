import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseDesignHtml,
  serializeDesignDoc,
  validateDesignDoc,
  type DesignDoc,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type SvgLayer,
  type SvgNode,
  type TextLayer,
  type Warning,
} from '@poster/core';
import { Canvas } from './components/Canvas.js';
import { IconButton } from './components/controls.js';
import { DocPreview } from './components/DocPreview.js';
import { ExportDialog } from './components/ExportDialog.js';
import { Inspector } from './components/Inspector.js';
import { LeftRail, type PanelId } from './components/LeftRail.js';
import { Toasts, type ToastItem, type ToastTone } from './components/Toasts.js';
import { TopBar, type SaveState } from './components/TopBar.js';
import { WarningsBar } from './components/WarningsBar.js';
import { editDesign, generateDesign, type AiUsage } from './editor/api.js';
import {
  createAssetFromFile,
  fitAssetIntoArtboard,
  revokeAsset,
  type AssetEntry,
} from './editor/assets.js';
import { useDocHistory } from './editor/history.js';
import { deleteAssetRecord, loadAssetRecords, saveAssetRecord } from './editor/storage.js';
import {
  ELEMENT_LABELS,
  addLayer,
  alignLayers,
  canAddLayer,
  deleteLayers,
  duplicateLayers,
  estimatedLayerHeight,
  reorderLayer,
  uniqueLayerId,
  updateLayer,
  updateLayers,
  type AlignTarget,
  type ElementKind,
  type ReorderMove,
  type TextPreset,
} from './editor/layers.js';
import { plainToInline } from './editor/text.js';
import { TEMPLATES, createBlankDoc } from './sample.js';

const ACCENT = '#f5a524';
const STORAGE_KEY = 'poster.design.v1';
const NAME_KEY = 'poster.name.v1';

const BASE_LAYER = { rotation: 0, opacity: 1, hidden: false, locked: false } as const;

const SVG_ELEMENTS: Record<'star' | 'check' | 'arrow', SvgNode[]> = {
  star: [
    {
      kind: 'element',
      tag: 'path',
      attrs: {
        d: 'M50 6 L62 36 L95 38 L69 59 L78 92 L50 72 L22 92 L31 59 L5 38 L38 36 Z',
        fill: ACCENT,
      },
      children: [],
    },
  ],
  check: [
    {
      kind: 'element',
      tag: 'circle',
      attrs: { cx: '50', cy: '50', r: '44', fill: ACCENT },
      children: [],
    },
    {
      kind: 'element',
      tag: 'path',
      attrs: {
        d: 'M28 52 L45 68 L74 33',
        fill: 'none',
        stroke: '#0b0e12',
        'stroke-width': '9',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      children: [],
    },
  ],
  arrow: [
    {
      kind: 'element',
      tag: 'path',
      attrs: {
        d: 'M8 50 H78 M58 28 L80 50 L58 72',
        fill: 'none',
        stroke: ACCENT,
        'stroke-width': '10',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      children: [],
    },
  ],
};

function layerHeight(layer: Layer): number {
  return 'height' in layer ? layer.height : estimatedLayerHeight(layer);
}

function textLayerFor(doc: DesignDoc, preset: TextPreset, index: number): TextLayer {
  const width = Math.round(doc.width * 0.78);
  return {
    ...BASE_LAYER,
    id: uniqueLayerId(doc, 'text'),
    name: preset.label,
    left: Math.round((doc.width - width) / 2),
    top: Math.round(doc.height / 2 + index * 24),
    width,
    type: 'text',
    dir: preset.dir,
    content: plainToInline(preset.content),
    style: {
      fontFamily: preset.fontFamily,
      fontSize: preset.fontSize,
      fontWeight: preset.fontWeight,
      italic: false,
      underline: false,
      color: '#ffffff',
      align: preset.align,
      lineHeight: 1.3,
      letterSpacing: 0,
      textTransform: 'none',
    },
  };
}

function elementLayerFor(doc: DesignDoc, kind: ElementKind): Layer {
  const side = Math.round(Math.min(doc.width, doc.height) * 0.3);
  const width = kind === 'line' ? Math.round(doc.width * 0.45) : side;
  const height = kind === 'line' ? Math.max(4, Math.round(side * 0.04)) : side;
  const base = {
    ...BASE_LAYER,
    id: uniqueLayerId(doc, kind),
    name: ELEMENT_LABELS[kind],
    left: Math.round((doc.width - width) / 2),
    top: Math.round((doc.height - height) / 2),
    width,
  };

  if (kind === 'star' || kind === 'check' || kind === 'arrow') {
    const layer: SvgLayer = {
      ...base,
      type: 'svg',
      height,
      viewBox: '0 0 100 100',
      nodes: SVG_ELEMENTS[kind],
    };
    return layer;
  }

  const radius =
    kind === 'circle' || kind === 'ring' ? 999 : kind === 'rounded' ? 28 : kind === 'line' ? 2 : 0;
  const layer: ShapeLayer = {
    ...base,
    type: 'shape',
    height,
    style: {
      fill:
        kind === 'ring'
          ? { kind: 'solid', color: '#00000000' }
          : { kind: 'solid', color: ACCENT },
      radius,
      ...(kind === 'ring'
        ? { border: { width: 12, style: 'solid' as const, color: ACCENT } }
        : {}),
    },
  };
  return layer;
}

function imageLayerFor(doc: DesignDoc, asset: AssetEntry): ImageLayer {
  const size = fitAssetIntoArtboard(doc.width, doc.height, asset.width, asset.height);
  return {
    ...BASE_LAYER,
    id: uniqueLayerId(doc, 'image'),
    name: asset.name,
    left: Math.round((doc.width - size.width) / 2),
    top: Math.round((doc.height - size.height) / 2),
    width: size.width,
    height: size.height,
    type: 'image',
    src: `asset:${asset.id}`,
    style: { fit: 'cover', position: { x: 50, y: 50 }, radius: 18 },
  };
}

function distributeLayers(
  doc: DesignDoc,
  ids: readonly string[],
  axis: 'horizontal' | 'vertical',
): DesignDoc {
  const picked = doc.layers.filter((layer) => ids.includes(layer.id));
  if (picked.length < 3) return doc;

  const horizontal = axis === 'horizontal';
  const sorted = [...picked].sort((a, b) => (horizontal ? a.left - b.left : a.top - b.top));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return doc;

  const start = horizontal ? first.left : first.top;
  const end = horizontal ? last.left + last.width : last.top + layerHeight(last);
  const total = sorted.reduce(
    (sum, layer) => sum + (horizontal ? layer.width : layerHeight(layer)),
    0,
  );
  const gap = (end - start - total) / (sorted.length - 1);

  const positions = new Map<string, number>();
  let cursor = start;
  for (const layer of sorted) {
    positions.set(layer.id, Math.round(cursor));
    cursor += (horizontal ? layer.width : layerHeight(layer)) + gap;
  }

  let next = doc;
  positions.forEach((value, id) => {
    next = updateLayer(next, id, (layer) =>
      horizontal ? { ...layer, left: value } : { ...layer, top: value },
    );
  });
  return next;
}

export function App() {
  const [initialDoc] = useState<DesignDoc>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return validateDesignDoc(JSON.parse(raw));
    } catch {
      // A corrupt snapshot should never block the editor.
    }
    return TEMPLATES[0]?.doc ?? createBlankDoc();
  });

  const history = useDocHistory(initialDoc);
  const doc = history.doc;

  const [name, setName] = useState(
    () => window.localStorage.getItem(NAME_KEY) ?? 'ملصق بدون عنوان',
  );
  const [panel, setPanel] = useState<PanelId | null>('layers');
  const [selection, setSelection] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [fitScale, setFitScale] = useState(0.4);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [modal, setModal] = useState<'preview' | 'help' | 'export' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState<'auto' | 'ar' | 'en'>('auto');
  const [style, setStyle] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [lastUsage, setLastUsage] = useState<AiUsage | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const scale = Math.min(2, Math.max(0.08, fitScale * zoom));

  const notify = useCallback((tone: ToastTone, message: string) => {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const assetUrls = useMemo(() => {
    const map: Record<string, string> = {};
    for (const asset of assets) {
      map[asset.id] = asset.url;
      map[`asset:${asset.id}`] = asset.url;
    }
    return map;
  }, [assets]);

  useEffect(() => {
    setSelection((current) => current.filter((id) => doc.layers.some((layer) => layer.id === id)));
    setEditingId((current) =>
      current && doc.layers.some((layer) => layer.id === current) ? current : null,
    );
  }, [doc]);

  useEffect(() => {
    setSaveState('dirty');
    const handle = window.setTimeout(() => {
      setSaveState('saving');
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
        window.localStorage.setItem(NAME_KEY, name);
        setLastSavedAt(Date.now());
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 700);
    return () => window.clearTimeout(handle);
  }, [doc, name]);

  useEffect(
    () => () => {
      setAssets((current) => {
        current.forEach(revokeAsset);
        return current;
      });
    },
    [],
  );

  // Restores the asset library from IndexedDB so `asset:` layers survive a reload.
  useEffect(() => {
    let cancelled = false;
    void loadAssetRecords().then((restored) => {
      if (cancelled) {
        restored.forEach(revokeAsset);
        return;
      }
      if (restored.length === 0) return;
      setAssets((current) => {
        const known = new Set(current.map((item) => item.id));
        restored.filter((item) => known.has(item.id)).forEach(revokeAsset);
        return [...restored.filter((item) => !known.has(item.id)), ...current];
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deleteSelection = useCallback(() => {
    if (selection.length === 0) return;
    history.update((current) => deleteLayers(current, selection));
    setSelection([]);
    setEditingId(null);
  }, [history, selection]);

  const duplicateSelection = useCallback(() => {
    if (selection.length === 0) return;
    let nextIds: string[] = [];
    history.update((current) => {
      const result = duplicateLayers(current, selection);
      nextIds = result.ids;
      return result.doc;
    });
    if (nextIds.length > 0) setSelection(nextIds);
  }, [history, selection]);

  const addText = useCallback(
    (preset: TextPreset) => {
      if (!canAddLayer(doc)) {
        notify('error', 'وصلت إلى الحد الأقصى للطبقات');
        return;
      }
      const layer = textLayerFor(doc, preset, doc.layers.length);
      history.update((current) => addLayer(current, layer));
      setSelection([layer.id]);
      setPanel('layers');
    },
    [doc, history, notify],
  );

  const addElement = useCallback(
    (kind: ElementKind) => {
      if (!canAddLayer(doc)) {
        notify('error', 'وصلت إلى الحد الأقصى للطبقات');
        return;
      }
      const layer = elementLayerFor(doc, kind);
      history.update((current) => addLayer(current, layer));
      setSelection([layer.id]);
    },
    [doc, history, notify],
  );

  const addImage = useCallback(
    (asset: AssetEntry) => {
      if (!canAddLayer(doc)) {
        notify('error', 'وصلت إلى الحد الأقصى للطبقات');
        return;
      }
      const layer = imageLayerFor(doc, asset);
      history.update((current) => addLayer(current, layer));
      setSelection([layer.id]);
    },
    [doc, history, notify],
  );

  const handleUpload = useCallback(
    async (files: FileList) => {
      setUploadBusy(true);
      const added: AssetEntry[] = [];
      try {
        for (const file of Array.from(files)) {
          const entry = await createAssetFromFile(file, assets.length + added.length);
          await saveAssetRecord(entry, file);
          added.push(entry);
        }
        setAssets((current) => [...current, ...added]);
        notify('success', `أُضيفت ${added.length} صورة`);
      } catch (cause) {
        added.forEach(revokeAsset);
        notify('error', cause instanceof Error ? cause.message : 'تعذر رفع الصورة');
      } finally {
        setUploadBusy(false);
      }
    },
    [assets.length, notify],
  );

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      notify('error', 'اكتب وصفًا أطول للتصميم');
      return;
    }
    setAiBusy(true);
    const result = await generateDesign({
      prompt: trimmed,
      width: doc.width,
      height: doc.height,
      language,
      style,
    });
    setAiBusy(false);
    if (!result.ok) {
      notify('error', result.error.message);
      return;
    }
    try {
      const parsed = parseDesignHtml(result.data.designHtml);
      history.reset(parsed.doc);
      setSelection([]);
      setWarnings(parsed.warnings);
      setLastUsage(result.data.usage);
      notify('success', 'تم توليد التصميم');
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'مخرج التوليد غير صالح');
    }
  }, [prompt, doc.width, doc.height, language, style, history, notify]);

  const handleEdit = useCallback(
    async (instruction: string) => {
      if (selection.length === 0) return;
      setAiBusy(true);
      const result = await editDesign({
        designHtml: serializeDesignDoc(doc),
        instruction,
        selectedLayerIds: selection,
        allowNewLayers: false,
      });
      setAiBusy(false);
      if (!result.ok) {
        notify('error', result.error.message);
        return;
      }
      try {
        const parsed = parseDesignHtml(result.data.designHtml);
        history.replace(parsed.doc);
        setWarnings(parsed.warnings);
        setLastUsage(result.data.usage);
        notify('success', 'تم تطبيق التعديل');
      } catch (cause) {
        notify('error', cause instanceof Error ? cause.message : 'مخرج التعديل غير صالح');
      }
    },
    [doc, history, notify, selection],
  );

  const copyHtml = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(serializeDesignDoc(doc));
      notify('success', 'تم نسخ Design HTML إلى الحافظة');
    } catch {
      notify('error', 'تعذر النسخ إلى الحافظة');
    }
  }, [doc, notify]);

  const saveNow = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
      window.localStorage.setItem(NAME_KEY, name);
      setLastSavedAt(Date.now());
      setSaveState('saved');
      notify('success', 'تم الحفظ محليًا');
    } catch {
      setSaveState('error');
      notify('error', 'تعذر الحفظ محليًا');
    }
  }, [doc, name, notify]);

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const parsed = parseDesignHtml(await file.text());
        history.reset(parsed.doc);
        setWarnings(parsed.warnings);
        setSelection([]);
        setEditingId(null);
        notify('success', `تم استيراد ${file.name}`);
      } catch (cause) {
        notify('error', cause instanceof Error ? cause.message : 'تعذر استيراد الملف');
      }
    },
    [history, notify],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        history.redo();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        setZoom((current) => Math.min(2, current * 1.1));
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        setZoom((current) => Math.max(0.15, current / 1.1));
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        setZoom(1);
        return;
      }
      if (event.key === 'Escape') {
        setSelection([]);
        setEditingId(null);
        setModal(null);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'F2') && selection.length === 1) {
        const candidate = doc.layers.find((layer) => layer.id === selection[0]);
        if (candidate?.type === 'text' && !candidate.locked) {
          event.preventDefault();
          setEditingId(candidate.id);
          return;
        }
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length > 0) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key.startsWith('Arrow') && selection.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        history.update((current) =>
          updateLayers(current, selection, (layer) => ({
            ...layer,
            left: layer.left + dx,
            top: layer.top + dy,
          })),
        );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history, selection, deleteSelection, duplicateSelection, doc]);

  return (
    <div className="app" dir="rtl">
      <TopBar
        name={name}
        onNameChange={setName}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        saveState={saveState}
        lastSavedAt={lastSavedAt}
        onSave={saveNow}
        onImport={() => importRef.current?.click()}
        onCopyHtml={copyHtml}
        onExport={() => setModal('export')}
        onPreview={() => setModal('preview')}
        onHelp={() => setModal('help')}
        onToggleAi={() => setPanel((current) => (current === 'ai' ? null : 'ai'))}
        aiActive={panel === 'ai'}
        aiBusy={aiBusy}
      />

      <div className="workspace">
        <LeftRail
          panel={panel}
          onPanelChange={(next) => setPanel((current) => (current === next ? null : next))}
          onClosePanel={() => setPanel(null)}
          doc={doc}
          selection={selection}
          assets={assets}
          onSelect={setSelection}
          onAddTemplate={(templateDoc, templateName) => {
            history.reset(templateDoc);
            setSelection([]);
            setEditingId(null);
            notify('success', `تم تطبيق قالب ${templateName}`);
          }}
          onAddText={addText}
          onAddElement={addElement}
          onUpload={handleUpload}
          uploadBusy={uploadBusy}
          onAddImage={addImage}
          onRemoveAsset={(asset) => {
            void deleteAssetRecord(asset.id);
            revokeAsset(asset);
            setAssets((current) => current.filter((item) => item.id !== asset.id));
          }}
          onToggleHidden={(id) => {
            history.update((current) =>
              updateLayer(current, id, (layer) => ({ ...layer, hidden: !layer.hidden })),
            );
          }}
          onToggleLocked={(id) => {
            history.update((current) =>
              updateLayer(current, id, (layer) => ({ ...layer, locked: !layer.locked })),
            );
          }}
          onDelete={deleteSelection}
          onDuplicate={duplicateSelection}
          onReorder={(id: string, move: ReorderMove) => {
            history.update((current) => reorderLayer(current, id, move));
          }}
          onStartEditText={(id) => {
            setSelection([id]);
            setEditingId(id);
          }}
          templates={TEMPLATES}
          ai={{
            prompt,
            onPromptChange: setPrompt,
            language,
            onLanguageChange: setLanguage,
            style,
            onStyleChange: setStyle,
            width: doc.width,
            height: doc.height,
            busy: aiBusy,
            onGenerate: handleGenerate,
            selectionCount: selection.length,
            onEdit: handleEdit,
            lastUsage,
          }}
        />

        <main className="canvas-area">
          <Canvas
            doc={doc}
            scale={scale}
            selection={selection}
            editingId={editingId}
            assets={assetUrls}
            showGrid={showGrid}
            onFitScale={setFitScale}
            onZoomChange={(next) => setZoom(next / Math.max(fitScale, 0.08))}
            onSelectionChange={setSelection}
            onEditingChange={setEditingId}
            onUpdate={history.update}
            onCommit={history.commit}
          />

          <div className="zoom-bar">
            <button
              type="button"
              className="zoom-button"
              onClick={() => setZoom((current) => Math.max(0.15, current / 1.1))}
              aria-label="تصغير"
            >
              −
            </button>
            <span className="zoom-value">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              className="zoom-button"
              onClick={() => setZoom((current) => Math.min(2, current * 1.1))}
              aria-label="تكبير"
            >
              +
            </button>
            <button type="button" className="zoom-button" onClick={() => setZoom(1)}>
              ملاءمة
            </button>
            <button
              type="button"
              className={`zoom-button${showGrid ? ' is-active' : ''}`}
              onClick={() => setShowGrid((current) => !current)}
              aria-pressed={showGrid}
            >
              شبكة
            </button>
          </div>
        </main>

        <Inspector
          doc={doc}
          selection={selection}
          assets={assets}
          onUpdate={history.update}
          onDelete={deleteSelection}
          onDuplicate={duplicateSelection}
          onReorder={(id, move) => {
            history.update((current) => reorderLayer(current, id, move));
          }}
          onAlign={(target: AlignTarget) => {
            history.update((current) => alignLayers(current, selection, target));
          }}
          onDistribute={(axis) => {
            history.update((current) => distributeLayers(current, selection, axis));
          }}
          onStartEditText={(id) => {
            setSelection([id]);
            setEditingId(id);
          }}
          onReplaceImage={(layerId, asset) => {
            history.update((current) =>
              updateLayer(current, layerId, (layer) =>
                layer.type === 'image'
                  ? { ...layer, src: `asset:${asset.id}`, name: asset.name }
                  : layer,
              ),
            );
          }}
        />
      </div>

      {warnings.length > 0 ? (
        <WarningsBar warnings={warnings} onDismiss={() => setWarnings([])} />
      ) : null}

      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))}
      />

      <input
        ref={importRef}
        type="file"
        accept=".html,.htm,text/html"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImportFile(file);
          event.target.value = '';
        }}
      />

      {modal === 'export' ? (
        <ExportDialog doc={doc} assets={assets} name={name} onClose={() => setModal(null)} />
      ) : null}

      {modal === 'preview' ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="معاينة التصميم">
          <div className="modal-panel">
            <header className="modal-header">
              <h2>معاينة التصميم</h2>
              <IconButton icon="close" label="إغلاق المعاينة" onClick={() => setModal(null)} />
            </header>
            <div className="modal-body">
              <DocPreview doc={doc} width={Math.min(760, doc.width)} />
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'help' ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="اختصارات لوحة المفاتيح">
          <div className="modal-panel">
            <header className="modal-header">
              <h2>اختصارات لوحة المفاتيح</h2>
              <IconButton icon="close" label="إغلاق الاختصارات" onClick={() => setModal(null)} />
            </header>
            <div className="modal-body">
              <ul className="shortcut-list">
                <li>
                  <span>تراجع</span>
                  <kbd>Ctrl</kbd> <kbd>Z</kbd>
                </li>
                <li>
                  <span>إعادة</span>
                  <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd>
                </li>
                <li>
                  <span>تكرار التحديد</span>
                  <kbd>Ctrl</kbd> <kbd>D</kbd>
                </li>
                <li>
                  <span>حذف التحديد</span>
                  <kbd>Delete</kbd>
                </li>
                <li>
                  <span>تحريك 1px / 10px</span>
                  <kbd>أسهم</kbd> / <kbd>Shift</kbd> + <kbd>أسهم</kbd>
                </li>
                <li>
                  <span>تكبير / تصغير</span>
                  <kbd>Ctrl</kbd> <kbd>+</kbd> / <kbd>−</kbd>
                </li>
                <li>
                  <span>ملاءمة اللوحة</span>
                  <kbd>Ctrl</kbd> <kbd>0</kbd>
                </li>
                <li>
                  <span>إلغاء التحديد</span>
                  <kbd>Esc</kbd>
                </li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
