import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser } from '@poster/contracts';
import {
  importDesignDocument,
  parseDesignHtml,
  serializeDesignDoc,
  type DesignDoc,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type SvgLayer,
  type SvgNode,
  type TextLayer,
  type Warning,
} from '@poster/core';
import { AccountDialog } from './components/AccountDialog.js';
import { Canvas } from './components/Canvas.js';
import { ContextualToolbar } from './components/ContextualToolbar.js';
import { IconButton } from './components/controls.js';
import { PreviewModal } from './components/PreviewModal.js';
import { ExportDialog } from './components/ExportDialog.js';
import { Inspector } from './components/Inspector.js';
import { LeftRail, type PanelId } from './components/LeftRail.js';
import { Toasts, type ToastItem, type ToastTone } from './components/Toasts.js';
import { TopBar, type SaveState } from './components/TopBar.js';
import { WarningsBar } from './components/WarningsBar.js';
import {
  I18nContext,
  applyDocumentLang,
  readStoredLang,
  translator,
  writeStoredLang,
  type Lang,
} from './i18n.js';
import { currentUser, editDesign, generateDesign, type AiUsage } from './editor/api.js';
import {
  createAssetFromBase64,
  createAssetFromFile,
  createAssetId,
  fitAssetIntoArtboard,
  revokeAsset,
  type AssetEntry,
} from './editor/assets.js';
import { useDocHistory } from './editor/history.js';
import { copyLayers, pasteLayers } from './editor/clipboard.js';
import {
  DocumentConflictError,
  loadDocument,
  saveDocument,
  type DocumentLoad,
} from './editor/documents.js';
import {
  createSnapshotId,
  deleteAssetRecord,
  deleteSnapshotRecord,
  loadAssetRecords,
  loadSnapshotRecords,
  saveAssetRecord,
  saveSnapshotRecord,
  type StoredSnapshot,
} from './editor/storage.js';
import {
  ELEMENT_LABELS,
  TEXT_PRESETS,
  addLayer,
  alignLayers,
  canAddLayer,
  deleteLayers,
  duplicateLayers,
  estimatedLayerHeight,
  applyCopiedStyle,
  applyTextEffectPreset,
  copyLayerStyle,
  magicResizeDoc,
  reorderLayer,
  uniqueLayerId,
  updateLayer,
  updateLayers,
  type AlignTarget,
  type CopiedStyle,
  type ElementKind,
  type ReorderMove,
  type TextEffectPreset,
  type TextPreset,
} from './editor/layers.js';
import { plainToInline } from './editor/text.js';
import { extractDocumentColors, normalizeColor, replaceColorAcrossDoc } from './editor/fills.js';
import { TEMPLATES, createBlankDoc } from './sample.js';

const ACCENT = '#f5a524';

const BASE_LAYER = { rotation: 0, opacity: 1, hidden: false, locked: false } as const;

/** Single-key insertions, active only when no modifier is held. */
const QUICK_INSERT: Record<string, 'text' | ElementKind> = {
  t: 'text',
  r: 'rectangle',
  c: 'circle',
  l: 'line',
};

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

/**
 * Imported images get a fresh local id so two imports never share one stored
 * blob; the layer refs follow the remapped ids.
 */
function remapImportedAssets(doc: DesignDoc, idMap: ReadonlyMap<string, string>): DesignDoc {
  if (idMap.size === 0) return doc;
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.type !== 'image' || !layer.src.startsWith('asset:')) return layer;
      const mapped = idMap.get(layer.src.slice('asset:'.length));
      return mapped ? { ...layer, src: `asset:${mapped}` } : layer;
    }),
  };
}

function centeredLayer(doc: DesignDoc, layer: Layer): Layer {
  const height = 'height' in layer ? layer.height : estimatedLayerHeight(layer);
  return {
    ...layer,
    left: Math.round((doc.width - layer.width) / 2),
    top: Math.round((doc.height - height) / 2),
  };
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
        kind === 'ring' ? { kind: 'solid', color: '#00000000' } : { kind: 'solid', color: ACCENT },
      radius,
      ...(kind === 'ring' ? { border: { width: 12, style: 'solid' as const, color: ACCENT } } : {}),
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
  const [initialDoc] = useState<DesignDoc>(() => TEMPLATES[0]?.doc ?? createBlankDoc());

  const history = useDocHistory(initialDoc);
  const doc = history.doc;

  const [name, setName] = useState('ملصق بدون عنوان');
  const [storageReady, setStorageReady] = useState(false);
  const [recovery, setRecovery] = useState<Extract<DocumentLoad, { kind: 'recovery' }> | null>(
    null,
  );
  const [storageError, setStorageError] = useState(false);
  const [storageConflict, setStorageConflict] = useState(false);
  const revisionRef = useRef<string | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
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
  const [showRulers, setShowRulers] = useState(false);
  const [showSafeMargin, setShowSafeMargin] = useState(false);
  const [showBleed, setShowBleed] = useState(false);
  const [viewReset, setViewReset] = useState(0);
  const [zoomMenu, setZoomMenu] = useState(false);
  const [styleClipboard, setStyleClipboard] = useState<CopiedStyle | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [modal, setModal] = useState<'preview' | 'help' | 'export' | 'account' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState<'auto' | 'ar' | 'en'>('auto');
  const [style, setStyle] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [lastUsage, setLastUsage] = useState<AiUsage | null>(null);
  const [snapshots, setSnapshots] = useState<StoredSnapshot[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [uiLang, setUiLang] = useState<Lang>(() => readStoredLang());
  const importRef = useRef<HTMLInputElement>(null);
  const layerClipboard = useRef<Layer[]>([]);
  const pasteCount = useRef(0);

  const scale = Math.min(2, Math.max(0.08, fitScale * zoom));

  // `Fit` restores the whole viewport, not just the zoom multiplier, so a
  // panned canvas cannot stay off-centre after the user asks to fit.
  const resetView = useCallback(() => {
    setZoom(1);
    setViewReset((value) => value + 1);
    setZoomMenu(false);
  }, []);

  const applyScale = useCallback(
    (target: number) => {
      setZoom(Math.min(2, Math.max(0.15, target / Math.max(fitScale, 0.08))));
      setZoomMenu(false);
    },
    [fitScale],
  );

  const t = useMemo(() => translator(uiLang), [uiLang]);
  const dir = uiLang === 'ar' ? ('rtl' as const) : ('ltr' as const);
  const i18n = useMemo(() => ({ lang: uiLang, dir, t, setLang: setUiLang }), [uiLang, dir, t]);

  useEffect(() => {
    applyDocumentLang(uiLang);
    writeStoredLang(uiLang);
  }, [uiLang]);

  const notify = useCallback((tone: ToastTone, message: string) => {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const refreshAuth = useCallback(async () => {
    const result = await currentUser();
    setAuthUser(result.ok ? result.data.user : null);
    setAuthReady(true);
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

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

  const resetHistory = history.reset;
  useEffect(() => {
    let cancelled = false;
    void loadDocument()
      .then((loaded) => {
        if (cancelled) return;
        revisionRef.current = loaded.revision;
        if (loaded.kind === 'recovery') {
          setRecovery(loaded);
          return;
        }
        if (loaded.current) {
          resetHistory(loaded.current.doc);
          setName(loaded.current.record.name);
          setLastSavedAt(loaded.current.record.savedAt);
        }
        setStorageReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setStorageError(true);
          setSaveState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resetHistory]);

  const persist = useCallback((currentDoc: DesignDoc, currentName: string) => {
    const task = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const record = await saveDocument(currentDoc, currentName, revisionRef.current);
        revisionRef.current = record.revision;
        return record;
      });
    saveQueue.current = task;
    return task;
  }, []);

  useEffect(() => {
    if (!storageReady || storageConflict) return;
    let cancelled = false;
    setSaveState('dirty');
    const handle = window.setTimeout(() => {
      setSaveState('saving');
      void persist(doc, name)
        .then((record) => {
          if (!cancelled) {
            setLastSavedAt(record.savedAt);
            setSaveState('saved');
          }
        })
        .catch((cause: unknown) => {
          if (cause instanceof DocumentConflictError) setStorageConflict(true);
          if (!cancelled) setSaveState('error');
        });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [doc, name, storageReady, storageConflict, persist]);

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
    void loadSnapshotRecords().then(setSnapshots);
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

  // `Alt + Drag` duplicates before the move starts: the gesture then moves the
  // copies, and the single history entry recorded by the canvas covers both.
  const duplicateForDrag = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return null;
      const result = duplicateLayers(doc, ids);
      if (result.ids.length === 0) return null;
      history.update(() => result.doc);
      return {
        ids: result.ids,
        layers: result.doc.layers.filter((candidate) => result.ids.includes(candidate.id)),
      };
    },
    [doc, history],
  );

  const addText = useCallback(
    (preset: TextPreset) => {
      if (!canAddLayer(doc)) {
        notify('error', t('toastMaxLayers'));
        return;
      }
      const layer = textLayerFor(doc, preset, doc.layers.length);
      history.update((current) => addLayer(current, layer));
      setSelection([layer.id]);
      setPanel('layers');
    },
    [doc, history, notify, t],
  );

  const addElement = useCallback(
    (kind: ElementKind) => {
      if (!canAddLayer(doc)) {
        notify('error', t('toastMaxLayers'));
        return;
      }
      const layer = elementLayerFor(doc, kind);
      history.update((current) => addLayer(current, layer));
      setSelection([layer.id]);
    },
    [doc, history, notify, t],
  );

  const addQuickLayer = useCallback(
    (kind: 'text' | ElementKind) => {
      if (!canAddLayer(doc)) {
        notify('error', t('toastMaxLayers'));
        return;
      }
      const layer = centeredLayer(
        doc,
        kind === 'text'
          ? textLayerFor(
              doc,
              TEXT_PRESETS.find((preset) => preset.id === 'body') ?? TEXT_PRESETS[0]!,
              doc.layers.length,
            )
          : elementLayerFor(doc, kind),
      );
      history.update((current) => addLayer(current, layer));
      setSelection([layer.id]);
    },
    [doc, history, notify, t],
  );

  const addImage = useCallback(
    (asset: AssetEntry) => {
      if (!canAddLayer(doc)) {
        notify('error', t('toastMaxLayers'));
        return;
      }
      const layer = imageLayerFor(doc, asset);
      history.update((current) => addLayer(current, layer));
      setSelection([layer.id]);
    },
    [doc, history, notify, t],
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
        notify('success', t('toastImagesAdded', { count: added.length }));
      } catch (cause) {
        added.forEach(revokeAsset);
        notify('error', cause instanceof Error ? cause.message : t('toastUploadFailed'));
      } finally {
        setUploadBusy(false);
      }
    },
    [assets.length, notify, t],
  );

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      notify('error', t('toastPromptTooShort'));
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
      if (result.error.status === 401) setModal('account');
      notify('error', result.error.message);
      return;
    }
    try {
      const parsed = parseDesignHtml(result.data.designHtml);
      history.reset(parsed.doc);
      setSelection([]);
      setWarnings(parsed.warnings);
      setLastUsage(result.data.usage);
      notify('success', t('toastDesignGenerated'));
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : t('toastInvalidOutput'));
    }
  }, [prompt, doc.width, doc.height, language, style, history, notify, t]);

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
        if (result.error.status === 401) setModal('account');
        notify('error', result.error.message);
        return;
      }
      try {
        const parsed = parseDesignHtml(result.data.designHtml);
        await saveSnapshotRecord({
          id: createSnapshotId(),
          createdAt: Date.now(),
          instruction,
          designHtml: serializeDesignDoc(doc),
        });
        setSnapshots(await loadSnapshotRecords());
        history.replace(parsed.doc);
        setWarnings(parsed.warnings);
        setLastUsage(result.data.usage);
        notify('success', t('toastEditApplied'));
      } catch (cause) {
        notify('error', cause instanceof Error ? cause.message : t('toastEditInvalid'));
      }
    },
    [doc, history, notify, selection, t],
  );

  const handleRestoreSnapshot = useCallback(
    async (id: string) => {
      const record = snapshots.find((item) => item.id === id);
      if (!record) return;
      try {
        const parsed = parseDesignHtml(record.designHtml);
        history.replace(parsed.doc);
        setWarnings(parsed.warnings);
        await deleteSnapshotRecord(id);
        setSnapshots((current) => current.filter((item) => item.id !== id));
        notify('success', t('toastSnapshotRestored'));
      } catch {
        notify('error', t('toastSnapshotInvalid'));
      }
    },
    [snapshots, history, notify, t],
  );

  const copyHtml = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(serializeDesignDoc(doc));
      notify('success', t('toastHtmlCopied'));
    } catch {
      notify('error', t('toastCopyFailed'));
    }
  }, [doc, notify, t]);

  const saveNow = useCallback(async () => {
    if (!storageReady || storageConflict) return;
    setSaveState('saving');
    try {
      const record = await persist(doc, name);
      setLastSavedAt(record.savedAt);
      setSaveState('saved');
      notify('success', t('toastSavedLocally'));
    } catch (cause) {
      if (cause instanceof DocumentConflictError) setStorageConflict(true);
      setSaveState('error');
      notify('error', t('toastSaveFailed'));
    }
  }, [doc, name, notify, persist, storageReady, storageConflict, t]);

  const handleImportFile = useCallback(
    async (file: File) => {
      const added: AssetEntry[] = [];
      try {
        const imported = importDesignDocument(await file.text());
        const idMap = new Map<string, string>();
        for (const asset of imported.assets) {
          const id = createAssetId();
          const { entry, file: blob } = await createAssetFromBase64(
            asset.base64,
            asset.mimeType,
            id,
            assets.length + added.length,
          );
          await saveAssetRecord(entry, blob);
          idMap.set(asset.id, id);
          added.push(entry);
        }
        history.reset(remapImportedAssets(imported.doc, idMap));
        if (added.length > 0) setAssets((current) => [...current, ...added]);
        setWarnings(imported.warnings);
        setSelection([]);
        setEditingId(null);
        notify('success', t('toastImported', { name: file.name }));
      } catch (cause) {
        added.forEach(revokeAsset);
        notify('error', cause instanceof Error ? cause.message : t('toastImportFailed'));
      }
    },
    [assets.length, history, notify, t],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (modal || !storageReady || storageConflict) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'c' && selection.length > 0) {
        event.preventDefault();
        layerClipboard.current = copyLayers(doc, selection);
        pasteCount.current = 0;
        return;
      }
      if (mod && key === 'v' && layerClipboard.current.length > 0) {
        event.preventDefault();
        const result = pasteLayers(doc, layerClipboard.current, (pasteCount.current + 1) * 20);
        if (result.ids.length === 0) {
          notify('error', t('toastMaxLayers'));
          return;
        }
        pasteCount.current += 1;
        history.replace(result.doc);
        setSelection(result.ids);
        return;
      }

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
      if (mod && key === 's') {
        event.preventDefault();
        saveNow();
        return;
      }
      if (mod && key === 'e') {
        event.preventDefault();
        setModal('export');
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setModal('help');
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
        resetView();
        return;
      }
      if (mod && (event.key === '[' || event.key === ']')) {
        event.preventDefault();
        const move: ReorderMove =
          event.key === ']'
            ? event.shiftKey
              ? 'front'
              : 'forward'
            : event.shiftKey
              ? 'back'
              : 'backward';
        history.update((current) =>
          selection.reduce((next, id) => reorderLayer(next, id, move), current),
        );
        return;
      }
      if (!mod && !event.shiftKey && !event.altKey) {
        const quick = QUICK_INSERT[key];
        if (quick) {
          event.preventDefault();
          addQuickLayer(quick);
          return;
        }
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
  }, [
    history,
    selection,
    deleteSelection,
    duplicateSelection,
    addQuickLayer,
    doc,
    saveNow,
    resetView,
    modal,
    storageReady,
    storageConflict,
    notify,
    t,
  ]);

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app" dir={dir}>
        {!storageReady || storageConflict ? (
          <div className="modal" role="dialog" aria-modal="true" aria-label="استعادة الحفظ المحلي">
            <div className="modal-panel">
              <div className="modal-body">
                {storageConflict ? (
                  <>
                    <p>
                      حُفظ إصدار أحدث في تبويب آخر. توقف الحفظ لحماية عملك. انسخ التصميم قبل إعادة
                      التحميل.
                    </p>
                    <button onClick={() => void copyHtml()}>نسخ التصميم الحالي</button>
                    <button onClick={() => window.location.reload()}>إعادة التحميل</button>
                  </>
                ) : recovery ? (
                  <>
                    <p>النسخة المحفوظة تالفة أو غير مدعومة. لن نستبدلها دون اختيارك.</p>
                    {recovery.backup ? (
                      <button
                        onClick={() => {
                          if (!recovery.backup) return;
                          history.reset(recovery.backup.doc);
                          setName(recovery.backup.record.name);
                          setRecovery(null);
                          setStorageReady(true);
                        }}
                      >
                        استعادة النسخة الاحتياطية
                      </button>
                    ) : null}
                    <button
                      onClick={() => {
                        history.reset(createBlankDoc());
                        setRecovery(null);
                        setStorageReady(true);
                      }}
                    >
                      بدء تصميم جديد
                    </button>
                  </>
                ) : storageError ? (
                  <>
                    <p>
                      تعذر فتح الحفظ المحلي. تحقق من مساحة المتصفح وصلاحيات التخزين؛ لم تتغير
                      البيانات المحفوظة.
                    </p>
                    <button onClick={() => window.location.reload()}>إعادة المحاولة</button>
                  </>
                ) : (
                  <p>جارٍ تحميل التصميم المحفوظ…</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
        <TopBar
          name={name}
          onNameChange={setName}
          docWidth={doc.width}
          docHeight={doc.height}
          onNewDesign={() => {
            history.reset(createBlankDoc());
            setSelection([]);
            setEditingId(null);
          }}
          onMagicResize={(width, height) =>
            history.update((current) => magicResizeDoc(current, width, height))
          }
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
          accountLabel={authUser?.email ?? (authReady ? t('signIn') : t('account'))}
          onAccount={() => setModal('account')}
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
              notify('success', t('toastTemplateApplied', { name: templateName }));
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
              snapshots,
              onRestoreSnapshot: handleRestoreSnapshot,
            }}
          />

          <main className="canvas-area">
            <ContextualToolbar
              layers={doc.layers.filter((layer) => selection.includes(layer.id))}
              effect={(() => {
                const selected = doc.layers.find((layer) => layer.id === selection[0]);
                if (!selected) return 'none';
                if (doc.layers.some((layer) => layer.id === `${selected.id}__fx2`)) return 'glitch';
                if (doc.layers.some((layer) => layer.id === `${selected.id}__fx1`)) return 'echo';
                return selected.type === 'text' && selected.style.shadow ? 'softShadow' : 'none';
              })()}
              canPaste={styleClipboard !== null}
              onTextStyle={(patch) =>
                history.update((current) =>
                  updateLayers(current, selection, (layer) =>
                    layer.type === 'text'
                      ? { ...layer, style: { ...layer.style, ...patch } }
                      : layer,
                  ),
                )
              }
              onShapeColor={(color) =>
                history.update((current) =>
                  updateLayers(current, selection, (layer) =>
                    layer.type === 'shape' && layer.style.fill.kind === 'solid'
                      ? { ...layer, style: { ...layer.style, fill: { kind: 'solid', color } } }
                      : layer,
                  ),
                )
              }
              onAlign={(target) =>
                history.update((current) => alignLayers(current, selection, target))
              }
              onEffect={(preset: TextEffectPreset) => {
                const id = selection[0];
                if (id) history.update((current) => applyTextEffectPreset(current, id, preset));
              }}
              onCopyStyle={() => {
                const layer = doc.layers.find((item) => item.id === selection[0]);
                const copied = layer ? copyLayerStyle(layer) : null;
                if (!copied) return;
                setStyleClipboard(copied);
                notify('success', t('styleCopied'));
              }}
              onPasteStyle={() => {
                if (!styleClipboard) return;
                history.update((current) =>
                  selection.reduce(
                    (next, id) => applyCopiedStyle(next, id, styleClipboard),
                    current,
                  ),
                );
              }}
            />
            <Canvas
              doc={doc}
              scale={scale}
              selection={selection}
              editingId={editingId}
              assets={assetUrls}
              showGrid={showGrid}
              showRulers={showRulers}
              showSafeMargin={showSafeMargin}
              showBleed={showBleed}
              resetViewSignal={viewReset}
              onFitScale={setFitScale}
              onZoomChange={(next) => setZoom(next / Math.max(fitScale, 0.08))}
              onSelectionChange={setSelection}
              onEditingChange={setEditingId}
              onUpdate={history.update}
              onCommit={history.commit}
              onDuplicateForDrag={duplicateForDrag}
              onDeleteSelection={deleteSelection}
              onDuplicateSelection={duplicateSelection}
              onReorderLayer={(id, move) =>
                history.update((current) => reorderLayer(current, id, move))
              }
            />

            <div className="zoom-bar">
              <button
                type="button"
                className="zoom-button"
                onClick={() => setZoom((current) => Math.max(0.15, current / 1.1))}
                aria-label={t('zoomOut')}
              >
                −
              </button>
              <button
                type="button"
                className="zoom-button zoom-value"
                data-testid="zoom-value"
                aria-label={t('zoomPresets')}
                aria-expanded={zoomMenu}
                onClick={() => setZoomMenu((open) => !open)}
              >
                {Math.round(scale * 100)}%
              </button>
              {zoomMenu ? (
                <div className="zoom-menu" role="menu" aria-label={t('zoomPresets')}>
                  {[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      role="menuitem"
                      className="zoom-menu__item"
                      onClick={() => applyScale(preset)}
                    >
                      {Math.round(preset * 100)}%
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    className="zoom-menu__item"
                    onClick={resetView}
                  >
                    {t('fitToScreen')}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="zoom-button"
                onClick={() => setZoom((current) => Math.min(2, current * 1.1))}
                aria-label={t('zoomIn')}
              >
                +
              </button>
              <button
                type="button"
                className="zoom-button"
                data-testid="zoom-fit"
                onClick={resetView}
              >
                {t('fitToScreen')}
              </button>
              <button
                type="button"
                className={`zoom-button${showGrid ? ' is-active' : ''}`}
                data-testid="toggle-grid"
                onClick={() => setShowGrid((current) => !current)}
                aria-pressed={showGrid}
              >
                {t('grid')}
              </button>
              <button
                type="button"
                className={`zoom-button${showRulers ? ' is-active' : ''}`}
                data-testid="toggle-rulers"
                onClick={() => setShowRulers((current) => !current)}
                aria-pressed={showRulers}
              >
                {t('rulers')}
              </button>
              <button
                type="button"
                className={`zoom-button${showSafeMargin ? ' is-active' : ''}`}
                data-testid="toggle-safe-margin"
                onClick={() => setShowSafeMargin((current) => !current)}
                aria-pressed={showSafeMargin}
              >
                {t('safeMargin')}
              </button>
              <button
                type="button"
                className={`zoom-button${showBleed ? ' is-active' : ''}`}
                data-testid="toggle-bleed"
                onClick={() => setShowBleed((current) => !current)}
                aria-pressed={showBleed}
              >
                {t('bleed')}
              </button>
            </div>
          </main>

          <Inspector
            doc={doc}
            onReplaceAllColors={(from, to) => {
              const count =
                extractDocumentColors(doc).find((entry) => entry.color === normalizeColor(from))
                  ?.count ?? 0;
              history.update((current) => replaceColorAcrossDoc(current, from, to));
              notify('success', t('colorReplaced', { count }));
            }}
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
          <ExportDialog
            doc={doc}
            assets={assets}
            name={name}
            onUnauthorized={() => setModal('account')}
            onClose={() => setModal(null)}
          />
        ) : null}

        {modal === 'account' ? (
          <AccountDialog
            user={authUser}
            onClose={() => setModal(null)}
            onSignedIn={(user) => {
              setAuthUser(user);
              setModal(null);
              notify('success', t('toastSignedIn'));
            }}
            onSignedOut={() => {
              void refreshAuth();
              notify('success', t('toastSignedOut'));
            }}
          />
        ) : null}

        {modal === 'preview' ? (
          <PreviewModal doc={doc} assets={assets} onClose={() => setModal(null)} />
        ) : null}

        {modal === 'help' ? (
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="اختصارات لوحة المفاتيح"
          >
            <div className="modal-panel">
              <header className="modal-header">
                <h2>اختصارات لوحة المفاتيح</h2>
                <IconButton icon="close" label="إغلاق الاختصارات" onClick={() => setModal(null)} />
              </header>
              <div className="modal-body">
                <ul className="shortcut-list">
                  <li>
                    <span>نسخ / لصق الطبقات</span>
                    <kbd>Ctrl/Cmd</kbd>
                    <kbd>C / V</kbd>
                  </li>
                  <li>
                    <span>تحريك اللوحة</span>
                    <kbd>Space</kbd>
                    <span>+ سحب، أو عجلة الفأرة</span>
                  </li>
                  <li>
                    <span>تحديد مستطيل</span>
                    <span>سحب في الفراغ، Shift للإضافة</span>
                  </li>
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
                  <li>
                    <span>حفظ الآن</span>
                    <kbd>Ctrl</kbd> <kbd>S</kbd>
                  </li>
                  <li>
                    <span>فتح التصدير</span>
                    <kbd>Ctrl</kbd> <kbd>E</kbd>
                  </li>
                  <li>
                    <span>لوحة الاختصارات</span>
                    <kbd>?</kbd>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </I18nContext.Provider>
  );
}
