import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
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
import { plainToInline } from '../editor/text.js';
import { LayerView, type Handle } from './LayerView.js';

type MoveSession = {
  kind: 'move';
  pointerId: number;
  startX: number;
  startY: number;
  scale: number;
  before: DesignDoc;
  ids: string[];
  starts: Map<string, { left: number; top: number }>;
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
      document.body.classList.add('is-dragging');

      function cleanup(revert: boolean) {
        const current = sessionRef.current;
        sessionRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        document.body.classList.remove('is-dragging');
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
          const snap = event.shiftKey ? 10 : 1;
          onUpdate(
            (currentDoc) =>
              updateLayers(currentDoc, current.ids, (layer) => {
                const start = current.starts.get(layer.id);
                if (!start) return layer;
                const left = Math.round((start.left + dx) / snap) * snap;
                const top = Math.round((start.top + dy) / snap) * snap;
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
          const nextLeft = quantize(centerX - nextWidth / 2);
          const nextTop = quantize(centerY - nextHeight / 2);
          const nextW = quantize(nextWidth);
          const nextH = quantize(nextHeight);

          onUpdate(
            (currentDoc) =>
              updateLayers(currentDoc, [current.id], (layer) => {
                if (layer.type === 'text') {
                  return { ...layer, left: nextLeft, top: nextTop, width: nextW };
                }
                return { ...layer, left: nextLeft, top: nextTop, width: nextW, height: nextH };
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
      const starts = new Map<string, { left: number; top: number }>();
      for (const id of ids) {
        const item = doc.layers.find((candidate) => candidate.id === id);
        if (item) starts.set(id, { left: item.left, top: item.top });
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
      });
    },
    [beginSession, doc, scale],
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
          {showGrid && scale >= 0.28 ? (
            <div className="canvas-grid" style={{ backgroundSize: '40px 40px' }} aria-hidden="true" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
