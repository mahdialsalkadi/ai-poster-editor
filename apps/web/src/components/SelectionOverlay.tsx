import type { Layer } from '@poster/core';
import type { GapBadge } from '../editor/gaps.js';
import { estimatedLayerHeight } from '../editor/layers.js';
import { handlesFor, type Handle } from '../editor/resize.js';
import { Icon } from './icons.js';

export type TransformHud =
  | { kind: 'move'; left: number; top: number; width: number; height: number }
  | {
      kind: 'resize';
      left: number;
      top: number;
      width: number;
      height: number;
      fontSize?: number;
    }
  | {
      kind: 'rotate';
      left: number;
      top: number;
      width: number;
      height: number;
      rotation: number;
    };

function hudText(hud: TransformHud): string {
  if (hud.kind === 'move') return `X: ${Math.round(hud.left)} · Y: ${Math.round(hud.top)}`;
  if (hud.kind === 'resize') {
    const base = `${Math.round(hud.width)} × ${Math.round(hud.height)} px`;
    return hud.fontSize === undefined ? base : `${base} · ${Math.round(hud.fontSize)}pt`;
  }
  return `${Math.round(hud.rotation)}°`;
}

export type SelectionOverlayProps = {
  layers: readonly Layer[];
  selection: readonly string[];
  scale: number;
  textHeights: Record<string, number>;
  editingId: string | null;
  hud?: TransformHud | null;
  badges?: readonly GapBadge[];
  onResizeStart: (
    event: React.PointerEvent<HTMLButtonElement>,
    handle: Handle,
    layer: Layer,
  ) => void;
  onRotateStart: (event: React.PointerEvent<HTMLButtonElement>, layer: Layer) => void;
};

/**
 * Selection outlines, resize handles and the rotation stem live in
 * `.artboard-overlays`, a sibling of the clipped `.artboard`. Layer artwork
 * stays clipped while the chrome stays fully visible at the artboard edges.
 * The overlay is positioned in screen pixels, so handle hit areas keep their
 * size at every zoom level.
 */
export function SelectionOverlay({
  layers,
  selection,
  scale,
  textHeights,
  editingId,
  hud = null,
  badges = [],
  onResizeStart,
  onRotateStart,
}: SelectionOverlayProps) {
  const selected = layers.filter((layer) => selection.includes(layer.id) && !layer.hidden);
  if (selected.length === 0) return null;

  const single = selected.length === 1 ? selected[0]! : null;

  return (
    <>
      {selected.map((layer) => {
        const height =
          layer.type === 'text'
            ? (textHeights[layer.id] ?? estimatedLayerHeight(layer))
            : layer.height;
        const interactive = single !== null && !layer.locked && editingId !== layer.id;
        return (
          <div
            key={layer.id}
            className="overlay-box"
            data-overlay-layer={layer.id}
            style={{
              left: layer.left * scale,
              top: layer.top * scale,
              width: layer.width * scale,
              height: height * scale,
              ...(layer.rotation === 0 ? {} : { transform: `rotate(${layer.rotation}deg)` }),
            }}
          >
            <span
              className="selection-box"
              style={{ borderWidth: Math.max(1, 1.5 / scale) }}
              aria-hidden="true"
            />
            {interactive ? (
              <>
                <span
                  className="rotate-stem"
                  style={{ width: Math.max(1, 1.5 / scale) }}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="rotate-handle"
                  aria-label="Rotate layer"
                  title="Rotate layer"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onRotateStart(event, layer);
                  }}
                >
                  <Icon name="rotate" size={12} />
                </button>
                {handlesFor(layer.type).map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    className={`handle handle--${handle}`}
                    data-handle={handle}
                    aria-label={`Resize ${handle}`}
                    title={`Resize ${handle}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      onResizeStart(event, handle, layer);
                    }}
                  />
                ))}
              </>
            ) : null}
          </div>
        );
      })}
      {badges.map((badge, index) => (
        <div
          key={`${badge.axis}-${index}`}
          className={`gap-badge gap-badge--${badge.axis}`}
          data-testid="distance-badge"
          data-axis={badge.axis}
          style={{
            left: badge.axis === 'x' ? badge.left * scale : badge.left * scale,
            top: badge.top * scale,
            width: badge.axis === 'x' ? badge.width * scale : 0,
            height: badge.axis === 'y' ? badge.height * scale : 0,
          }}
          aria-hidden="true"
        >
          <span className="gap-badge__label">{badge.value} px</span>
        </div>
      ))}
      {hud ? (
        <div
          className="transform-hud"
          data-testid="transform-hud"
          role="status"
          aria-live="polite"
          style={{
            left: (hud.left + hud.width / 2) * scale,
            top: (hud.top + hud.height) * scale + 12,
          }}
        >
          {hudText(hud)}
        </div>
      ) : null}
    </>
  );
}
