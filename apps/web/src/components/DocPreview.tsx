import type { DesignDoc } from '@poster/core';
import { fillToCss } from '../editor/render.js';
import { LayerView } from './LayerView.js';

/**
 * Small, non-interactive rendering of a document. Used for template cards and
 * the export preview. It shares LayerView with the canvas so previews cannot
 * drift from the editor.
 */
export function DocPreview({
  doc,
  width,
  assets = {},
  className,
}: {
  doc: DesignDoc;
  width: number;
  assets?: Record<string, string>;
  className?: string;
}) {
  const scale = width / doc.width;
  return (
    <div
      className={`doc-preview${className ? ` ${className}` : ''}`}
      style={{
        width,
        height: Math.round(doc.height * scale),
        background: fillToCss(doc.background),
      }}
      aria-hidden="true"
    >
      <div
        className="doc-preview-inner"
        dir="ltr"
        style={{
          width: doc.width,
          height: doc.height,
          transform: `scale(${scale})`,
        }}
      >
        {doc.layers.map((layer) => (
          <LayerView
            key={layer.id}
            layer={layer}
            scale={scale}
            selected={false}
            showHandles={false}
            editing={false}
            assets={assets}
            interactive={false}
          />
        ))}
      </div>
    </div>
  );
}
