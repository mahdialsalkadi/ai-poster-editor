import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,

  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  normalizeAngle,
  quantize,
  type DesignDoc,
  type Layer,
} from '@poster/core';
import type { UpdateOptions } from '../editor/history.js';
import { estimatedLayerHeight, replaceTextContent, updateLayers } from '../editor/layers.js';
import { fillToCss } from '../editor/render.js';
import {
  collectSnapTargets,
  snapBounds,
  snapEdge,
  type SnapLine,
  type SnapTargets,
} from '../editor/snap.js';
import { plainToInline } from '../editor/text.js';
import { LayerView, type Handle } from './LayerView.js';

type StartBox = { left: number; top: number; width: number; height: number };

type MoveSession = {
  kind: 'move';
  pointerId: number;
  startX: number;
  startY: number;
  scale: number;
  before: DesignDoc;
  ids: string[];
  starts: Map<string, StartBox>;
  targets: SnapTargets;
  threshold: number;
};

type ResizeSession = {
  kind: 'resize';
  pointerId: number;
  handle: Handle;
  startX: number;
  startY: number;
  scale: number;
  before: DesignDoc;
  id: string;
  isText: boolean;
  start: { left: number; top: number; width: number; height: number; rotation: number };
  targets: SnapTargets;
  threshold: number;
};

type RotateSession = {
  kind: 'rotate';
  pointerId: number;
  centerX: number;
  centerY: number;
  startAngle: number;
  startRotation: number;
  before: DesignDoc;
  id: string;
};

type Session = MoveSession | ResizeSession | RotateSession;

/** Snap radius in screen pixels, converted to document units per gesture. */
const SNAP_THRESHOLD = 6;
const SHIFT_STEP = 10;

function movedBounds(starts: Map<string, StartBox>, dx: number, dy: number): StartBox {
  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  starts.forEach((box) => {
    minLeft = Math.min(minLeft, box.left);
    minTop = Math.min(minTop, box.top);
    maxRight = Math.max(maxRight, box.left + box.width);
    maxBottom = Math.max(maxBottom, box.top + box.height);
  });

  if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  return {
    left: minLeft + dx,
    top: minTop + dy,
    width: maxRight - minLeft,
    height: maxBottom - minTop,
  };
}

export type CanvasProps = {
  doc: DesignDoc;
  scale: number;
  selection: string[];
  editingId: string | null;
  assets: Record<string, string>;
  showGrid: boolean;
  onFitScale: (scale: number) => void;
  onZoomChange: (zoom: number) => void;
  onSelectionChange: (ids: string[]) => void;
  onEditingChange: (id: string | null) => void;
  onUpdate: (updater: (doc: DesignDoc) => DesignDoc, options?: UpdateOptions) => void;
  onCommit: (before: DesignDoc) => void;
};

export function Canvas({
  doc,
  scale,
  selection,
  editingId,
  assets,
  showGrid,
  onFitScale,
  onZoomChange,
  onSelectionChange,
  onEditingChange,
  onUpdate,
  onCommit,
}: CanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const sessionRef = useRef<Session | null>(null);
  const [textHeights, setTextHeights] = useState<Record<string, number>>({});
  const [fontTick, setFontTick] = useState(0);
  const [guides, setGuides] = useState<SnapLine[]>([]);

  const registerRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) layerRefs.current.set(id, element);
    else layerRefs.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      const padding = 104;
      const fit = Math.min(
        (rect.width - padding) / doc.width,
        (rect.height - padding) / doc.height,
        1,
      );
      onFitScale(Math.max(0.08, Math.min(1, fit)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [doc.width, doc.height, onFitScale]);

  useLayoutEffect(() => {
    setTextHeights((previous) => {
      const next: Record<string, number> = {};
      let changed = false;
      for (const layer of doc.layers) {
        if (layer.type !== 'text' || layer.hidden) continue;
        const element = layerRefs.current.get(layer.id);
        const height = element?.offsetHeight ?? estimatedLayerHeight(layer);
        next[layer.id] = height;
        if (previous[layer.id] !== height) changed = true;
      }
      if (Object.keys(previous).length !== Object.keys(next).length) changed = true;
      return changed ? next : previous;
    });
  }, [doc, fontTick]);

  useEffect(() => {
    let active = true;
    const fonts = document.fonts;
    if (!fonts) return;
    fonts.ready
      .then(() => {
        if (active) setFontTick((value) => value + 1);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = Math.min(2, Math.max(0.08, scale * factor));
      onZoomChange(Math.round(next * 1000) / 1000);
    };
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [scale, onZoomChange]);

  const beginSession = useCallback(
    (session: Session) => {
      sessionRef.current = session;
      setGuides([]);
      document.body.classList.add('is-dragging');

      function cleanup(revert: boolean) {
        const current = sessionRef.current;
        sessionRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        document.body.classList.remove('is-dragging');
        setGuides([]);
        if (!current) return;
        if (revert) onUpdate(() => current.before, { history: false });
        else onCommit(current.before);
      }

      function onMove(event: PointerEvent) {
        const current = sessionRef.current;
        if (!current || event.pointerId !== current.pointerId) return;
        event.preventDefault();

        if (current.kind === 'move') {
          const dx = (event.clientX - current.startX) / current.scale;
          const dy = (event.clientY - current.startY) / current.scale;
          let offsetX = dx;
          let offsetY = dy;
          let nextGuides: SnapLine[] = [];

          if (event.shiftKey) {
            offsetX = Math.round(dx / SHIFT_STEP) * SHIFT_STEP;
            offsetY = Math.round(dy / SHIFT_STEP) * SHIFT_STEP;
          } else {
            const snapped = snapBounds(
              movedBounds(current.starts, dx, dy),
              current.targets,
              current.threshold,
            );
            offsetX += snapped.dx;
            offsetY += snapped.dy;
            nextGuides = snapped.guides;
          }

          setGuides(nextGuides);
          onUpdate(
            (currentDoc) =>
              updateLayers(currentDoc, current.ids, (layer) => {
                const start = current.starts.get(layer.id);
                if (!start) return layer;
                const left = quantize(start.left + offsetX);
                const top = quantize(start.top + offsetY);
                if (left === layer.left && top === layer.top) return layer;
                return { ...layer, left, top };
              }),
            { history: false },
          );
          return;
        }

        if (current.kind === 'resize') {
          const dx = (event.clientX - current.startX) / current.scale;
          const dy = (event.clientY - current.startY) / current.scale;
          const { left, top, width, height, rotation } = current.start;
          const theta = (rotation * Math.PI) / 180;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const localDx = dx * cos + dy * sin;
          const localDy = -dx * sin + dy * cos;

          let nextWidth = width;
          let nextHeight = height;
          if (current.handle.includes('e')) nextWidth = width + localDx;
          if (current.handle.includes('w')) nextWidth = width - localDx;
          if (!current.isText) {
            if (current.handle.includes('s')) nextHeight = height + localDy;
            if (current.handle.includes('n')) nextHeight = height - localDy;
          }
          nextWidth = Math.min(10_000, Math.max(1, nextWidth));
          nextHeight = Math.min(10_000, Math.max(1, nextHeight));

          const ax = current.handle.includes('w') ? 1 : current.handle.includes('e') ? 0 : 0.5;
          const ay = current.handle.includes('n') ? 1 : current.handle.includes('s') ? 0 : 0.5;
          const oldCenterX = left + width / 2;
          const oldCenterY = top + height / 2;
          const oldAnchorX = ax * width - width / 2;
          const oldAnchorY = ay * height - height / 2;
          const newAnchorX = ax * nextWidth - nextWidth / 2;
          const newAnchorY = ay * nextHeight - nextHeight / 2;
          const rotate = (x: number, y: number) => ({
            x: x * cos - y * sin,
            y: x * sin + y * cos,
          });
          const oldRotated = rotate(oldAnchorX, oldAnchorY);
          const newRotated = rotate(newAnchorX, newAnchorY);
          const centerX = oldCenterX + oldRotated.x - newRotated.x;
          const centerY = oldCenterY + oldRotated.y - newRotated.y;
          let nextLeft = quantize(centerX - nextWidth / 2);
          let nextTop = quantize(centerY - nextHeight / 2);
          let nextW = quantize(nextWidth);
          let nextH = quantize(nextHeight);

          // Snapping only applies to unrotated layers: the handles move along
          // the artboard axes, which keeps the anchored edge fixed.
          const nextGuides: SnapLine[] = [];
          if (rotation === 0) {
            if (current.handle.includes('w')) {
              const hit = snapEdge(current.targets.xs, nextLeft, current.threshold);
              if (hit !== null) {
                nextW = quantize(Math.min(10_000, Math.max(1, nextW + (nextLeft - hit))));
                nextLeft = hit;
                nextGuides.push({ axis: 'x', position: hit });
              }
            } else if (current.handle.includes('e')) {
              const hit = snapEdge(current.targets.xs, nextLeft + nextW, current.threshold);
              if (hit !== null) {
                nextW = quantize(Math.min(10_000, Math.max(1, hit - nextLeft)));
                nextGuides.push({ axis: 'x', position: hit });
              }
            }
            if (!current.isText) {
              if (current.handle.includes('n')) {
                const hit = snapEdge(current.targets.ys, nextTop, current.threshold);
                if (hit !== null) {
                  nextH = quantize(Math.min(10_000, Math.max(1, nextH + (nextTop - hit))));
                  nextTop = hit;
                  nextGuides.push({ axis: 'y', position: hit });
                }
              } else if (current.handle.includes('s')) {
                const hit = snapEdge(current.targets.ys, nextTop + nextH, current.threshold);
                if (hit !== null) {
                  nextH = quantize(Math.min(10_000, Math.max(1, hit - nextTop)));
                  nextGuides.push({ axis: 'y', position: hit });
                }
              }
            }
          }

          setGuides(nextGuides);
          onUpdate(
            (currentDoc) =>
              updateLayers(currentDoc, [current.id], (layer) => {
                if (layer.type === 'text') {
                  return { ...layer, left: nextLeft, top: nextTop, width: nextW };
                }
                return {
                  ...layer,
                  left: nextLeft,
                  top: nextTop,
                  width: nextW,
                  height: nextH,
                };
              }),
            { history: false },
          );
          return;
        }

        const angle =
          (Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX) * 180) /
          Math.PI;
        let next = normalizeAngle(current.startRotation + (angle - current.startAngle));
        if (event.shiftKey) next = normalizeAngle(Math.round(next / 15) * 15);
        onUpdate(
          (currentDoc) =>
            updateLayers(currentDoc, [current.id], (layer) => ({ ...layer, rotation: next })),
          { history: false },
        );
      }

      function onUp(event: PointerEvent) {
        const current = sessionRef.current;
        if (!current || event.pointerId !== current.pointerId) return;
        cleanup(false);
      }

      function onCancel(event: PointerEvent) {
        const current = sessionRef.current;
        if (!current || event.pointerId !== current.pointerId) return;
        cleanup(true);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [onCommit, onUpdate],
  );

  const startMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, layer: Layer, ids: string[]) => {
      const starts = new Map<string, StartBox>();
      for (const id of ids) {
        const item = doc.layers.find((candidate) => candidate.id === id);
        if (!item) continue;
        const height =
          'height' in item ? item.height : textHeights[item.id] ?? estimatedLayerHeight(item);
        starts.set(id, { left: item.left, top: item.top, width: item.width, height });
      }
      beginSession({
        kind: 'move',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scale,
        before: doc,
        ids: [...starts.keys()],
        starts,
        targets: collectSnapTargets(doc, ids),
        threshold: SNAP_THRESHOLD / scale,
      });
    },
    [beginSession, doc, scale, textHeights],
  );

  const handleLayerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, layer: Layer) => {
      if (event.button !== 0 || layer.locked) return;
      event.stopPropagation();
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (additive) {
        const next = selection.includes(layer.id)
          ? selection.filter((id) => id !== layer.id)
          : [...selection, layer.id];
        onSelectionChange(next);
        return;
      }

      let nextSelection = selection;
      if (!selection.includes(layer.id)) {
        nextSelection = [layer.id];
        onSelectionChange(nextSelection);
      }
      onEditingChange(null);
      startMove(event, layer, nextSelection);
    },
    [selection, onSelectionChange, onEditingChange, startMove],
  );

  const handleDoubleClick = useCallback(
    (event: ReactPointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>, layer: Layer) => {
      if (layer.type !== 'text') return;
      event.stopPropagation();
      onSelectionChange([layer.id]);
      onEditingChange(layer.id);
    },
    [onSelectionChange, onEditingChange],
  );

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, handle: Handle, layer: Layer) => {
      const height =
        'height' in layer
          ? layer.height
          : textHeights[layer.id] ?? estimatedLayerHeight(layer);
      beginSession({
        kind: 'resize',
        pointerId: event.pointerId,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        scale,
        before: doc,
        id: layer.id,
        isText: layer.type === 'text',
        start: {
          left: layer.left,
          top: layer.top,
          width: layer.width,
          height,
          rotation: layer.rotation,
        },
        targets: collectSnapTargets(doc, [layer.id]),
        threshold: SNAP_THRESHOLD / scale,
      });
    },
    [beginSession, doc, scale, textHeights],
  );

  const startRotate = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, layer: Layer) => {
      const rect = artboardRef.current?.getBoundingClientRect();
      if (!rect) return;
      const height =
        'height' in layer
          ? layer.height
          : textHeights[layer.id] ?? estimatedLayerHeight(layer);
      const centerX = rect.left + (layer.left + layer.width / 2) * scale;
      const centerY = rect.top + (layer.top + height / 2) * scale;
      const startAngle =
        (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI;
      beginSession({
        kind: 'rotate',
        pointerId: event.pointerId,
        centerX,
        centerY,
        startAngle,
        startRotation: layer.rotation,
        before: doc,
        id: layer.id,
      });
    },
    [beginSession, doc, scale, textHeights],
  );

  const handleTextCommit = useCallback(
    (id: string, text: string) => {
      onUpdate((currentDoc) => replaceTextContent(currentDoc, id, plainToInline(text)), {
        coalesceKey: `text-${id}`,
      });
      onEditingChange(null);
    },
    [onUpdate, onEditingChange],
  );

  const handleTextCancel = useCallback(() => {
    onEditingChange(null);
  }, [onEditingChange]);

  const clearSelection = useCallback(() => {
    onSelectionChange([]);
    onEditingChange(null);
  }, [onSelectionChange, onEditingChange]);

  return (
    <div
      className="stage"
      ref={stageRef}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) clearSelection();
      }}
    >
      <div
        className="artboard-frame"
        style={{ width: doc.width * scale, height: doc.height * scale }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) clearSelection();
        }}
      >
        <div
          className="artboard"
          ref={artboardRef}
          dir="ltr"
          style={{
            width: doc.width,
            height: doc.height,
            transform: `scale(${scale})`,
            background: fillToCss(doc.background),
          }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) clearSelection();
          }}
        >
          {doc.layers.map((layer) => (
            <LayerView
              key={layer.id}
              layer={layer}
              scale={scale}
              selected={selection.includes(layer.id)}
              showHandles={selection.length === 1 && selection[0] === layer.id}
              editing={editingId === layer.id}
              assets={assets}
              onPointerDown={handleLayerPointerDown}
              onDoubleClick={handleDoubleClick}
              onResizeStart={startResize}
              onRotateStart={startRotate}
              onTextCommit={handleTextCommit}
              onTextCancel={handleTextCancel}
              registerRef={registerRef}
            />
          ))}
          {guides.map((guide) => (
            <div
              key={`${guide.axis}-${guide.position}`}
              className={`snap-guide snap-guide--${guide.axis}`}
              style={guide.axis === 'x' ? { left: guide.position } : { top: guide.position }}
              aria-hidden="true"
            />
          ))}
          {showGrid && scale >= 0.28 ? (
            <div className="canvas-grid" style={{ backgroundSize: '40px 40px' }} aria-hidden="true" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
