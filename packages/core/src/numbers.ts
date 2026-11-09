import { DesignError } from './errors.js';

/**
 * Rounds to two decimal places, normalizes -0 to 0, and rejects non-finite
 * values. Handles the classic 1.005 case without binary floating point drift.
 */
export function quantize(value: number): number {
  if (!Number.isFinite(value)) {
    throw new DesignError('INVALID_DOC', `Number must be finite: ${String(value)}`);
  }
  const scaled = value * 100;
  const nudged = scaled + (scaled >= 0 ? 1e-9 : -1e-9);
  const rounded = Math.round(nudged) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampQuantized(value: number, min: number, max: number): number {
  return quantize(clamp(value, min, max));
}

/** Normalizes degrees into [0, 360). */
export function normalizeAngle(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  return quantize(normalized === 360 ? 0 : normalized);
}

export function parsePx(input: string): number | null {
  const trimmed = input.trim();
  if (/^-?0(?:\.0+)?$/.test(trimmed)) return 0;
  const match = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+))px$/i);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? quantize(value) : null;
}

export function parseNumber(input: string): number | null {
  const value = Number.parseFloat(input.trim());
  return Number.isFinite(value) ? quantize(value) : null;
}

/** Bare numbers are supported only on artboard data attributes, not CSS lengths. */
export function parseArtboardDimension(input: string): number | null {
  const match = /^(\d+(?:\.\d*)?|\.\d+)(?:px)?$/i.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? quantize(value) : null;
}
