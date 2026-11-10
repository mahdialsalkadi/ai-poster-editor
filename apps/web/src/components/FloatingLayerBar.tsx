import type { DesignDoc, Layer } from '@poster/core';
import { estimatedLayerHeight, updateLayers, type ReorderMove } from '../editor/layers.js';
import { useI18n } from '../i18n.js';

export type FloatingLayerBarProps = {
  doc: DesignDoc;
  selection: string[];
  scale: number;
  textHeights: Record<string, number>;
  onUpdate: (updater: (doc: DesignDoc) => DesignDoc) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onReorder: (id: string, move: ReorderMove) => void;
};

function layerHeight(layer: Layer, textHeights: Record<string, number>): number {
  if ('height' in layer) return layer.height;
  return textHeights[layer.id] ?? estimatedLayerHeight(layer);
}

/** Quick layer actions anchored under the selection, inside `.artboard-overlays`. */
export function FloatingLayerBar({
  doc,
  selection,
  scale,
  textHeights,
  onUpdate,
  onDelete,
  onDuplicate,
  onReorder,
}: FloatingLayerBarProps) {
  const { t } = useI18n();
  const layers = doc.layers.filter((layer) => selection.includes(layer.id));
  const first = layers[0];
  if (!first) return null;

  const left = Math.min(...layers.map((layer) => layer.left));
  const right = Math.max(...layers.map((layer) => layer.left + layer.width));
  const bottom = Math.max(...layers.map((layer) => layer.top + layerHeight(layer, textHeights)));
  const hidden = layers.every((layer) => layer.hidden);

  return (
    <div
      className="floating-bar"
      data-testid="floating-layer-bar"
      role="toolbar"
      aria-label={t('contextTools')}
      style={{ left: ((left + right) / 2) * scale, top: bottom * scale + 18 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="floating-bar__name">
        {layers.length > 1 ? t('multipleSelected', { count: layers.length }) : first.name}
      </span>
      <input
        className="floating-bar__opacity"
        type="range"
        min={0}
        max={100}
        value={Math.round(first.opacity * 100)}
        aria-label={t('layerOpacity')}
        data-testid="floating-opacity"
        onChange={(event) =>
          onUpdate((current) =>
            updateLayers(current, selection, (layer) => ({
              ...layer,
              opacity: Number(event.target.value) / 100,
            })),
          )
        }
      />
      <button
        type="button"
        className="floating-bar__button"
        aria-label={t('rotation')}
        onClick={() =>
          onUpdate((current) =>
            updateLayers(current, selection, (layer) => ({
              ...layer,
              rotation: (layer.rotation + 90) % 360,
            })),
          )
        }
      >
        ⟳
      </button>
      <button
        type="button"
        className="floating-bar__button"
        aria-label={hidden ? t('show') : t('hide')}
        onClick={() =>
          onUpdate((current) =>
            updateLayers(current, selection, (layer) => ({ ...layer, hidden: !hidden })),
          )
        }
      >
        {hidden ? '◌' : '◉'}
      </button>
      <button
        type="button"
        className="floating-bar__button"
        aria-label={t('front')}
        onClick={() => onReorder(first.id, 'front')}
      >
        ⇧
      </button>
      <button
        type="button"
        className="floating-bar__button"
        aria-label={t('back')}
        onClick={() => onReorder(first.id, 'back')}
      >
        ⇩
      </button>
      <button
        type="button"
        className="floating-bar__button"
        aria-label={t('duplicate')}
        data-testid="floating-duplicate"
        onClick={onDuplicate}
      >
        ⧉
      </button>
      <button
        type="button"
        className="floating-bar__button floating-bar__button--danger"
        aria-label={t('delete')}
        data-testid="floating-delete"
        onClick={onDelete}
      >
        ✕
      </button>
    </div>
  );
}
