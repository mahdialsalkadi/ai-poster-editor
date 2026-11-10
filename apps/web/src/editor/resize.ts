import { LIMITS, quantize, type Layer } from '@poster/core';

/** Resize handles, ordered clockwise from the top-left corner. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const ALL_HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Text layers expose the four corners (proportional `fontSize` scaling) and the
 * two horizontal edges (width reflow with a fixed `fontSize`). Vertical edges
 * are meaningless because a text layer's height follows its content.
 */
export const TEXT_HANDLES: readonly Handle[] = ['nw', 'ne', 'se', 'sw', 'w', 'e'];

export function handlesFor(type: Layer['type']): readonly Handle[] {
  return type === 'text' ? TEXT_HANDLES : ALL_HANDLES;
}

export type ResizeStart = {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
};

export type ResizeInput = {
  handle: Handle;
  start: ResizeStart;
  dx: number;
  dy: number;
  type: Layer['type'];
  startFontSize?: number;
  shiftKey?: boolean;
  altKey?: boolean;
};

export type ResizeResult = {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize?: number;
};

const MIN_SIZE = 1;
const MAX_SIZE = 10_000;

export function isCornerHandle(handle: Handle): boolean {
  return handle.length === 2;
}

/**
 * Images and SVG artwork keep their intrinsic aspect ratio on corner drags;
 * shapes only do so while `Shift` is held. Text corners never lock geometry —
 * they scale `fontSize` instead (see `scaleTextFontSize`).
 */
export function locksAspectRatio(
  input: Pick<ResizeInput, 'handle' | 'type' | 'shiftKey'>,
): boolean {
  if (!isCornerHandle(input.handle)) return false;
  if (input.type === 'image' || input.type === 'svg') return true;
  return input.type === 'shape' && input.shiftKey === true;
}

/** Corner text drags scale the font with the box, clamped to the schema limits. */
export function scaleTextFontSize(
  startFontSize: number,
  nextWidth: number,
  startWidth: number,
): number {
  const ratio = startWidth > 0 ? nextWidth / startWidth : 1;
  return quantize(
    Math.min(LIMITS.text.maxFontSize, Math.max(LIMITS.text.minFontSize, startFontSize * ratio)),
  );
}

/**
 * Resolves one resize pointer move into canonical layer geometry. The active
 * handle anchors the opposite edge (or the centre when `Alt` is held) and the
 * pointer delta is projected into the layer's rotated local space, so resizing
 * a rotated layer still moves the handle under the pointer.
 */
export function resizeFromHandle(input: ResizeInput): ResizeResult {
  const { handle, start, dx, dy, type, shiftKey = false, altKey = false } = input;
  const theta = (start.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const localDx = dx * cos + dy * sin;
  const localDy = -dx * sin + dy * cos;
  const isText = type === 'text';

  let width = start.width;
  let height = start.height;
  if (handle.includes('e')) width += localDx;
  if (handle.includes('w')) width -= localDx;
  if (!isText) {
    if (handle.includes('s')) height += localDy;
    if (handle.includes('n')) height -= localDy;
  }
  width = Math.min(MAX_SIZE, Math.max(MIN_SIZE, width));
  height = Math.min(MAX_SIZE, Math.max(MIN_SIZE, height));

  if (locksAspectRatio({ handle, type, shiftKey }) && start.width > 0) {
    height = Math.min(MAX_SIZE, Math.max(MIN_SIZE, (start.height * width) / start.width));
  }

  const ax = altKey ? 0.5 : handle.includes('w') ? 1 : handle.includes('e') ? 0 : 0.5;
  const ay = altKey ? 0.5 : handle.includes('n') ? 1 : handle.includes('s') ? 0 : 0.5;
  const oldAnchorX = ax * start.width - start.width / 2;
  const oldAnchorY = ay * start.height - start.height / 2;
  const newAnchorX = ax * width - width / 2;
  const newAnchorY = ay * height - height / 2;
  const rotate = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const oldRotated = rotate(oldAnchorX, oldAnchorY);
  const newRotated = rotate(newAnchorX, newAnchorY);
  const centerX = start.left + start.width / 2 + oldRotated.x - newRotated.x;
  const centerY = start.top + start.height / 2 + oldRotated.y - newRotated.y;

  const result: ResizeResult = {
    left: quantize(centerX - width / 2),
    top: quantize(centerY - height / 2),
    width: quantize(width),
    height: quantize(height),
  };
  if (isText && isCornerHandle(handle) && input.startFontSize !== undefined) {
    result.fontSize = scaleTextFontSize(input.startFontSize, width, start.width);
  }
  return result;
}
