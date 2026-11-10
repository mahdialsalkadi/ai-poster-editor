import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { normalizeAngle, quantize, type DesignDoc, type Layer } from '@poster/core';
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
import { layersInMarquee, selectionRect, type SelectionRect } from '../editor/selection.js';
import { equalSpacingBadges, type GapBadge } from '../editor/gaps.js';
import { resizeFromHandle, type Handle } from '../editor/resize.js';
import { LayerView } from './LayerView.js';
import { SelectionOverlay, type TransformHud } from './SelectionOverlay.js';

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
  type: Layer['type'];
  startFontSize: number | null;
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
  box: { left: number; top: number; width: number; height: number };
};

type PanSession = {
  kind: 'pan';
  pointerId: number;
  startX: number;
  startY: number;
  before: DesignDoc;
  pan: { x: number; y: number };
};
type MarqueeSession = {
  kind: 'marquee';
  pointerId: number;
  startX: number;
  startY: number;
  before: DesignDoc;
  scale: number;
  origin: { left: number; top: number };
  previous: string[];
  additive: boolean;
};
type Session = MoveSession | ResizeSession | RotateSession | PanSession | MarqueeSession;

/** Snap radius in screen pixels, converted to document units per gesture. */
const SNAP_THRESHOLD = 6;
const SHIFT_STEP = 10;

/** Tick spacing that stays readable (~40px apart) at the current zoom. */
function rulerTicks(length: number, scale: number): number[] {
  const step =
    [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((candidate) => candidate * scale >= 40) ?? 1000;
  const ticks: number[] = [];
  for (let value = 0; value <= length; value += step) ticks.push(value);
  return ticks;
}

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
  showRulers?: boolean;
  showSafeMargin?: boolean;
  showBleed?: boolean;
  resetViewSignal?: number;
  onFitScale: (scale: number) => void;
  onZoomChange: (zoom: number) => void;
  onSelectionChange: (ids: string[]) => void;
  onEditingChange: (id: string | null) => void;
  onUpdate: (updater: (doc: DesignDoc) => DesignDoc, options?: UpdateOptions) => void;
  onCommit: (before: DesignDoc) => void;
  onDuplicateForDrag?: (ids: string[]) => { ids: string[]; layers: Layer[] } | null;
};

export function Canvas({
  doc,
  scale,
  selection,
  editingId,
  assets,
  showGrid,
  showRulers = false,
  showSafeMargin = false,
  showBleed = false,
  resetViewSignal = 0,
  onFitScale,
  onZoomChange,
  onSelectionChange,
  onEditingChange,
  onUpdate,
  onCommit,
  onDuplicateForDrag,
}: CanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const sessionRef = useRef<Session | null>(null);
  const [textHeights, setTextHeights] = useState<Record<string, number>>({});
  const [fontTick, setFontTick] = useState(0);
  const [guides, setGuides] = useState<SnapLine[]>([]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceRef = useRef(false);
  const [marquee, setMarquee] = useState<SelectionRect | null>(null);
  const [hud, setHud] = useState<TransformHud | null>(null);
  const [badges, setBadges] = useState<GapBadge[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' ||
        (event.target as HTMLElement | null)?.closest(
          'input, textarea, select, button, [contenteditable="true"], [role="dialog"]',
        )
      )
        return;
      event.preventDefault();
      spaceRef.current = true;
      setSpaceDown(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpaceDown(false);
      cleanupRef.current?.();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (resetViewSignal === 0) return;
    setPan({ x: 0, y: 0 });
  }, [resetViewSignal]);

  const registerRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) layerRefs.current.set(id, element);
    else layerRefs.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      // Keep the artboard visible on narrow stages instead of shrinking it to
      // a sliver: the breathing room scales with the smaller stage dimension.
      const padding = Math.min(
        104,
        Math.max(24, Math.round(Math.min(rect.width, rect.height) * 0.12)),
      );
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
      if ((event.target as HTMLElement | null)?.closest('textarea, input')) return;
      event.preventDefault();
      if (!event.ctrlKey && !event.metaKey) {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
        setPan((current) => ({
          x: current.x - event.deltaX * unit,
          y: current.y - event.deltaY * unit,
        }));
        return;
      }
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = Math.min(2, Math.max(0.08, scale * factor));
      onZoomChange(Math.round(next * 1000) / 1000);
    };
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [scale, onZoomChange]);

  const beginSession = useCallback(
    (session: Session) => {
      cleanupRef.current?.();
      sessionRef.current = session;
      setGuides([]);
      document.body.classList.add('is-dragging');

      function cleanup(revert: boolean) {
        const current = sessionRef.current;
        sessionRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyCancel);
        cleanupRef.current = null;
        document.body.classList.remove('is-dragging');
        setGuides([]);
        setMarquee(null);
        setHud(null);
        setBadges([]);
        if (!current) return;
        if (current.kind === 'pan') {
          if (revert) setPan(current.pan);
          return;
        }
        if (current.kind === 'marquee') {
          if (revert) onSelectionChange(current.previous);
          return;
        }
        if (revert) onUpdate(() => current.before, { history: false });
        else onCommit(current.before);
      }

      function onMove(event: PointerEvent) {
        const current = sessionRef.current;
        if (!current || event.pointerId !== current.pointerId) return;
        event.preventDefault();

        if (current.kind === 'pan') {
          setPan({
            x: current.pan.x + event.clientX - current.startX,
            y: current.pan.y + event.clientY - current.startY,
          });
          return;
        }
        if (current.kind === 'marquee') {
          const rect = selectionRect(
            current.startX,
            current.startY,
            (event.clientX - current.origin.left) / current.scale,
            (event.clientY - current.origin.top) / current.scale,
          );
          setMarquee(rect);
          const ids = layersInMarquee(current.before, rect, textHeights);
          onSelectionChange(current.additive ? [...new Set([...current.previous, ...ids])] : ids);
          return;
        }

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

          const bounds = movedBounds(current.starts, offsetX, offsetY);
          setGuides(nextGuides);
          setHud({ kind: 'move', ...bounds });
          setBadges(equalSpacingBadges(doc.layers, bounds, current.ids, current.threshold));
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
          const { rotation } = current.start;
          const resized = resizeFromHandle({
            handle: current.handle,
            start: current.start,
            dx,
            dy,
            type: current.type,
            ...(current.startFontSize === null ? {} : { startFontSize: current.startFontSize }),
            shiftKey: event.shiftKey,
            altKey: event.altKey,
          });
          let nextLeft = resized.left;
          let nextTop = resized.top;
          let nextW = resized.width;
          let nextH = resized.height;
          setHud({
            kind: 'resize',
            left: nextLeft,
            top: nextTop,
            width: nextW,
            height: nextH,
            ...(resized.fontSize === undefined ? {} : { fontSize: resized.fontSize }),
          });

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
                  return {
                    ...layer,
                    left: nextLeft,
                    top: nextTop,
                    width: nextW,
                    ...(resized.fontSize === undefined
                      ? {}
                      : { style: { ...layer.style, fontSize: resized.fontSize } }),
                  };
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
        setHud({ kind: 'rotate', ...current.box, rotation: next });
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
      function onKeyCancel(event: KeyboardEvent) {
        if (event.key === 'Escape') cleanup(true);
      }
      window.addEventListener('keydown', onKeyCancel);
      cleanupRef.current = () => cleanup(true);
    },
    [onCommit, onUpdate, onSelectionChange, textHeights],
  );

  const startMove = useCallback(
    (
      event: ReactPointerEvent<HTMLDivElement>,
      layer: Layer,
      ids: string[],
      sourceLayers?: readonly Layer[],
    ) => {
      const starts = new Map<string, StartBox>();
      for (const id of ids) {
        const item = (sourceLayers ?? doc.layers).find((candidate) => candidate.id === id);
        if (!item) continue;
        const height =
          'height' in item ? item.height : (textHeights[item.id] ?? estimatedLayerHeight(item));
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
      if (event.altKey) {
        const duplicated = onDuplicateForDrag?.(nextSelection);
        if (duplicated && duplicated.ids.length > 0) {
          onSelectionChange(duplicated.ids);
          startMove(event, layer, duplicated.ids, duplicated.layers);
          return;
        }
      }
      startMove(event, layer, nextSelection);
    },
    [selection, onSelectionChange, onEditingChange, startMove, onDuplicateForDrag],
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
        'height' in layer ? layer.height : (textHeights[layer.id] ?? estimatedLayerHeight(layer));
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
        type: layer.type,
        startFontSize: layer.type === 'text' ? layer.style.fontSize : null,
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
        'height' in layer ? layer.height : (textHeights[layer.id] ?? estimatedLayerHeight(layer));
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
        box: { left: layer.left, top: layer.top, width: layer.width, height },
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

  const startMarquee = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.target !== event.currentTarget) return;
      const origin = artboardRef.current?.getBoundingClientRect();
      if (!origin) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.shiftKey) onSelectionChange([]);
      onEditingChange(null);
      beginSession({
        kind: 'marquee',
        pointerId: event.pointerId,
        startX: (event.clientX - origin.left) / scale,
        startY: (event.clientY - origin.top) / scale,
        before: doc,
        scale,
        origin,
        previous: selection,
        additive: event.shiftKey,
      });
    },
    [onSelectionChange, onEditingChange, doc, scale, selection, beginSession],
  );

  const inset = Math.round(Math.min(doc.width, doc.height) * 0.07);
  const ticksX = showRulers ? rulerTicks(doc.width, scale) : [];
  const ticksY = showRulers ? rulerTicks(doc.height, scale) : [];

  return (
    <div
      className={`stage${spaceDown ? ' is-panning' : ''}`}
      ref={stageRef}
      onPointerDownCapture={(event) => {
        if (
          !spaceRef.current ||
          event.button !== 0 ||
          (event.target as HTMLElement).closest('textarea, input')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        beginSession({
          kind: 'pan',
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          before: doc,
          pan,
        });
      }}
      onPointerDown={startMarquee}
    >
      <div
        className="artboard-frame"
        style={{
          width: doc.width * scale,
          height: doc.height * scale,
          transform: `translate(${pan.x}px, ${pan.y}px)`,
        }}
        onPointerDown={startMarquee}
      >
        <div
          className="artboard"
          ref={artboardRef}
          dir="ltr"
          style={{
            width: doc.width,
            height: doc.height,
            // CSS zoom scales the layout box too, so the unscaled artboard cannot
            // push the stage into horizontal overflow and drag it off-centre.
            zoom: scale,
            background: fillToCss(doc.background),
          }}
          onPointerDown={startMarquee}
        >
          {doc.layers.map((layer) => (
            <LayerView
              key={layer.id}
              layer={layer}
              scale={scale}
              selected={selection.includes(layer.id)}
              editing={editingId === layer.id}
              assets={assets}
              onPointerDown={handleLayerPointerDown}
              onDoubleClick={handleDoubleClick}
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
          {marquee ? (
            <div className="marquee-selection" style={marquee} aria-hidden="true" />
          ) : null}
          {showGrid && scale >= 0.28 ? (
            <div
              className="canvas-grid"
              style={{ backgroundSize: '40px 40px' }}
              aria-hidden="true"
            />
          ) : null}
        </div>
        <div className="artboard-overlays" data-testid="artboard-overlays">
          {showRulers ? (
            <div className="canvas-rulers" data-testid="canvas-rulers" aria-hidden="true">
              <div className="ruler ruler--x">
                {ticksX.map((tick) => (
                  <span key={tick} className="ruler__tick" style={{ left: tick * scale }}>
                    {tick}
                  </span>
                ))}
              </div>
              <div className="ruler ruler--y">
                {ticksY.map((tick) => (
                  <span key={tick} className="ruler__tick" style={{ top: tick * scale }}>
                    {tick}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {showSafeMargin ? (
            <div
              className="safe-margin-guide"
              data-testid="safe-margin-guide"
              style={{
                left: inset * scale,
                top: inset * scale,
                width: (doc.width - inset * 2) * scale,
                height: (doc.height - inset * 2) * scale,
              }}
              aria-hidden="true"
            />
          ) : null}
          {showBleed ? (
            <div
              className="bleed-guide"
              data-testid="bleed-guide"
              style={{
                left: -14 * scale,
                top: -14 * scale,
                width: (doc.width + 28) * scale,
                height: (doc.height + 28) * scale,
              }}
              aria-hidden="true"
            />
          ) : null}
          <SelectionOverlay
            layers={doc.layers}
            selection={selection}
            scale={scale}
            textHeights={textHeights}
            editingId={editingId}
            hud={hud}
            badges={badges}
            onResizeStart={startResize}
            onRotateStart={startRotate}
          />
        </div>
      </div>
    </div>
  );
}
