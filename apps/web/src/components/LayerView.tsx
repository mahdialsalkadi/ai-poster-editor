import {
  Fragment,
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  LIMITS,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type SvgLayer,
  type SvgNode,
  type TextLayer,
} from '@poster/core';
import { inlineToPlain, textCodepointLength } from '../editor/text.js';
import { scopeSvgNodes, svgAttrToProps } from '../editor/svg.js';
import { borderToCss, fillToCss, fontFamilyCss, shadowToCss } from '../editor/render.js';
import { Icon } from './icons.js';

export type LayerViewProps = {
  layer: Layer;
  scale: number;
  selected: boolean;
  editing: boolean;
  assets: Record<string, string>;
  interactive?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, layer: Layer) => void;
  onDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>, layer: Layer) => void;
  onTextCommit?: (id: string, text: string) => void;
  onTextCancel?: () => void;
  registerRef?: (id: string, element: HTMLDivElement | null) => void;
};

function textContentStyle(layer: TextLayer): CSSProperties {
  return {
    fontFamily: fontFamilyCss(layer.style.fontFamily),
    fontSize: layer.style.fontSize,
    fontWeight: layer.style.fontWeight,
    fontStyle: layer.style.italic ? 'italic' : 'normal',
    textDecoration: layer.style.underline ? 'underline' : 'none',
    color: layer.style.color,
    textAlign: layer.style.align,
    lineHeight: layer.style.lineHeight,
    letterSpacing: layer.style.letterSpacing,
    textTransform: layer.style.textTransform,
    direction: layer.dir,
    width: '100%',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    ...(layer.style.shadow ? { textShadow: shadowToCss(layer.style.shadow, false) } : {}),
  };
}

function TextContent({ layer }: { layer: TextLayer }) {
  return (
    <div className="text-content" style={textContentStyle(layer)} dir={layer.dir}>
      {layer.content.map((node, index) => {
        if (node.kind === 'br') return <br key={index} />;
        if (node.kind === 'span') {
          return (
            <span
              key={index}
              style={{
                ...(node.bold ? { fontWeight: 700 } : {}),
                ...(node.italic ? { fontStyle: 'italic' } : {}),
                ...(node.underline ? { textDecoration: 'underline' } : {}),
                ...(node.color ? { color: node.color } : {}),
              }}
            >
              {node.text}
            </span>
          );
        }
        return <Fragment key={index}>{node.text}</Fragment>;
      })}
    </div>
  );
}

function ShapeContent({ layer }: { layer: ShapeLayer }) {
  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    background: fillToCss(layer.style.fill),
    borderRadius: layer.style.radius,
    boxSizing: 'border-box',
    ...(layer.style.border ? { border: borderToCss(layer.style.border) } : {}),
    ...(layer.style.shadow ? { boxShadow: shadowToCss(layer.style.shadow) } : {}),
  };
  return <div className="shape-content" style={style} />;
}

function ImageContent({
  layer,
  assets,
  scale,
}: {
  layer: ImageLayer;
  assets: Record<string, string>;
  scale: number;
}) {
  const assetId = layer.src.startsWith('asset:') ? layer.src.slice('asset:'.length) : '';
  const url = assets[assetId];
  const frameStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    borderRadius: layer.style.radius,
    background: '#0f141a',
    boxSizing: 'border-box',
    ...(layer.style.border ? { border: borderToCss(layer.style.border) } : {}),
    ...(layer.style.shadow ? { boxShadow: shadowToCss(layer.style.shadow) } : {}),
  };

  return (
    <div className="image-content" style={frameStyle}>
      {url ? (
        <img
          src={url}
          alt={layer.alt ?? ''}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: layer.style.fit,
            objectPosition: `${layer.style.position.x}% ${layer.style.position.y}%`,
            display: 'block',
          }}
        />
      ) : (
        <div
          className="image-placeholder"
          style={{ fontSize: Math.max(12 / scale, layer.width * 0.028) }}
        >
          <Icon name="image" size={Math.max(18 / scale, layer.width * 0.08)} />
          <span>{assetId || 'asset'}</span>
          <small>asset:{assetId}</small>
        </div>
      )}
    </div>
  );
}

function renderSvgNode(node: SvgNode, key: number): ReactNode {
  if (node.kind === 'text') return <Fragment key={key}>{node.text}</Fragment>;
  return createElement(
    node.tag,
    { key, ...svgAttrToProps(node.attrs) },
    node.children.length > 0
      ? node.children.map((child, index) => renderSvgNode(child, index))
      : undefined,
  );
}

function SvgContent({ layer }: { layer: SvgLayer }) {
  const viewBox = layer.viewBox ?? `0 0 ${layer.width} ${layer.height}`;
  const nodes = scopeSvgNodes(layer.nodes, `${layer.id}--`);
  return (
    <svg
      className="svg-content"
      viewBox={viewBox}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {nodes.map((node, index) => renderSvgNode(node, index))}
    </svg>
  );
}

function InlineTextEditor({
  layer,
  scale,
  onCommit,
  onCancel,
}: {
  layer: TextLayer;
  scale: number;
  onCommit: (id: string, text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() => inlineToPlain(layer.content));
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

  const commit = () => {
    if (cancelled.current) return;
    // Empty text would leave an invisible layer that still takes space.
    // Treat clearing the field as a cancel and keep the previous content.
    if (text.trim().length === 0) {
      onCancel();
      return;
    }
    onCommit(layer.id, text);
  };

  return (
    <textarea
      ref={ref}
      className="inline-text-editor"
      value={text}
      dir={layer.dir}
      aria-label="Edit text"
      spellCheck={false}
      onChange={(event) => {
        const next = event.target.value;
        if (textCodepointLength(next) <= LIMITS.text.maxCodepointsPerLayer) setText(next);
      }}
      onBlur={commit}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancelled.current = true;
          onCancel();
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          commit();
        }
      }}
      style={{
        ...textContentStyle(layer),
        height: 'auto',
        minHeight: `${layer.style.fontSize * layer.style.lineHeight}px`,
        padding: 0,
        margin: 0,
        border: `solid var(--accent)`,
        borderWidth: Math.max(1, 2 / scale),
        borderRadius: Math.max(1, 3 / scale),
        background: 'rgba(8, 11, 15, 0.55)',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        boxSizing: 'border-box',
        caretColor: 'var(--accent)',
      }}
    />
  );
}

export function LayerView({
  layer,
  scale,
  selected,
  editing,
  assets,
  interactive = true,
  onPointerDown,
  onDoubleClick,
  onTextCommit,
  onTextCancel,
  registerRef,
}: LayerViewProps) {
  if (layer.hidden) return null;

  const hasHeight = layer.type !== 'text';
  const wrapperStyle: CSSProperties = {
    left: layer.left,
    top: layer.top,
    width: layer.width,
    ...(hasHeight ? { height: layer.height } : {}),
    opacity: layer.opacity,
    ...(layer.rotation === 0 ? {} : { transform: `rotate(${layer.rotation}deg)` }),
    pointerEvents: interactive && !layer.locked ? undefined : 'none',
  };

  return (
    <div
      ref={(element) => registerRef?.(layer.id, element)}
      className={`layer layer--${layer.type}${selected ? ' is-selected' : ''}${layer.locked ? ' is-locked' : ''}${editing ? ' is-editing' : ''}`}
      style={wrapperStyle}
      data-layer-id={layer.id}
      onPointerDown={
        interactive
          ? (event) => {
              if (layer.locked) return;
              onPointerDown?.(event, layer);
            }
          : undefined
      }
      onDoubleClick={
        interactive
          ? (event) => {
              if (layer.locked) return;
              onDoubleClick?.(event, layer);
            }
          : undefined
      }
    >
      {layer.type === 'text' ? (
        editing && onTextCommit && onTextCancel ? (
          <InlineTextEditor
            layer={layer}
            scale={scale}
            onCommit={onTextCommit}
            onCancel={onTextCancel}
          />
        ) : (
          <TextContent layer={layer} />
        )
      ) : layer.type === 'shape' ? (
        <ShapeContent layer={layer} />
      ) : layer.type === 'image' ? (
        <ImageContent layer={layer} assets={assets} scale={scale} />
      ) : (
        <SvgContent layer={layer} />
      )}

      {interactive && !selected ? (
        <span
          className="layer-hover"
          style={{ borderWidth: Math.max(1, 1 / scale) }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
