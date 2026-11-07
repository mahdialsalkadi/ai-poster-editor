import { DesignError } from './errors.js';

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*([^)]+)\)$/i;
const HSL_RE = /^hsla?\(\s*([^)]+)\)$/i;

const NAMED_COLORS: Readonly<Record<string, string>> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hex2(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = raw.trim();
  if (!value) return 1;
  const parsed = value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 1;
  return clamp(parsed, 0, 1);
}

function parseRgbChannel(raw: string): number {
  const value = raw.trim();
  if (value.endsWith('%')) {
    const pct = Number.parseFloat(value);
    if (!Number.isFinite(pct)) throw new DesignError('INVALID_DOC', `Invalid color channel: ${raw}`);
    return clamp((pct / 100) * 255, 0, 255);
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new DesignError('INVALID_DOC', `Invalid color channel: ${raw}`);
  return clamp(parsed, 0, 255);
}

function rgbToHex(channels: string[], alphaRaw: string | undefined): string | null {
  if (channels.length !== 3) return null;
  try {
    const [r, g, b] = channels.map(parseRgbChannel) as [number, number, number];
    const alpha = parseAlpha(alphaRaw);
    const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    if (alpha >= 1) return base;
    return `${base}${hex2(alpha * 255)}`;
  } catch {
    return null;
  }
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function hslToHex(parts: string[]): string | null {
  if (parts.length !== 3) return null;
  const hueRaw = parts[0]?.trim() ?? '';
  const satRaw = parts[1]?.trim() ?? '';
  const lightRaw = parts[2]?.trim() ?? '';
  if (!hueRaw || !satRaw.endsWith('%') || !lightRaw.endsWith('%')) return null;
  const hue = Number.parseFloat(hueRaw);
  const sat = Number.parseFloat(satRaw) / 100;
  const light = Number.parseFloat(lightRaw) / 100;
  if (![hue, sat, light].every(Number.isFinite)) return null;
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = clamp(sat, 0, 1);
  const l = clamp(light, 0, 1);
  if (s === 0) {
    const channel = hex2(l * 255);
    return `#${channel}${channel}${channel}`;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgb(p, q, h + 1 / 3);
  const g = hueToRgb(p, q, h);
  const b = hueToRgb(p, q, h - 1 / 3);
  return `#${hex2(r * 255)}${hex2(g * 255)}${hex2(b * 255)}`;
}

/**
 * Normalizes a CSS color to the canonical Design HTML form:
 * lowercase `#rrggbb` for opaque colors, `#rrggbbaa` for translucent colors.
 *
 * Returns null when the value is not a supported color. Callers decide whether
 * to reject it (security-sensitive context) or drop it with a warning.
 */
export function normalizeColor(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  const named = NAMED_COLORS[value];
  if (named) return named;

  if (HEX_RE.test(value)) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    if (hex.length === 4) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex}`;
    }
    return null;
  }

  const rgbMatch = value.match(RGB_RE);
  if (rgbMatch?.[1]) {
    const body = rgbMatch[1].trim();
    const slash = body.split('/');
    const channelsPart = slash[0] ?? '';
    const alphaPart = slash[1];
    if (body.includes(',')) {
      const parts = body.split(',').map((part) => part.trim());
      const alpha = parts.length === 4 ? parts[3] : alphaPart;
      return rgbToHex(parts.slice(0, 3), alpha);
    }
    const parts = channelsPart.trim().split(/\s+/).filter(Boolean);
    return rgbToHex(parts, alphaPart);
  }

  const hslMatch = value.match(HSL_RE);
  if (hslMatch?.[1]) {
    const body = hslMatch[1].trim();
    const slash = body.split('/');
    const parts = (slash[0] ?? '').trim().split(/\s+/).filter(Boolean);
    const alpha = slash[1];
    const base = hslToHex(parts);
    if (!base) return null;
    const parsedAlpha = parseAlpha(alpha);
    return parsedAlpha >= 1 ? base : `${base}${hex2(parsedAlpha * 255)}`;
  }

  return null;
}

export function isColor(input: string): boolean {
  return normalizeColor(input) !== null;
}
