const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COMMA_RE =
  /^rgba?\(\s*([+-]?\d+\.?\d*%?)\s*,\s*([+-]?\d+\.?\d*%?)\s*,\s*([+-]?\d+\.?\d*%?)(?:\s*,\s*([+-]?\d*\.?\d+%?))?\s*\)$/i;
const RGB_SPACE_RE =
  /^rgba?\(\s*([+-]?\d+\.?\d*%?)\s+([+-]?\d+\.?\d*%?)\s+([+-]?\d+\.?\d*%?)(?:\s*\/\s*([+-]?\d*\.?\d+%?))?\s*\)$/i;
const HSL_COMMA_RE =
  /^hsla?\(\s*([+-]?\d+\.?\d*(?:deg|rad|grad|turn)?)\s*,\s*([+-]?\d+\.?\d*)%\s*,\s*([+-]?\d+\.?\d*)%(?:\s*,\s*([+-]?\d*\.?\d+%?))?\s*\)$/i;
const HSL_SPACE_RE =
  /^hsla?\(\s*([+-]?\d+\.?\d*(?:deg|rad|grad|turn)?)\s+([+-]?\d+\.?\d*)%\s+([+-]?\d+\.?\d*)%(?:\s*\/\s*([+-]?\d*\.?\d+%?))?\s*\)$/i;

const NAMED_COLORS: Readonly<Record<string, string>> = {
  transparent: '#00000000',
  none: '#00000000',
  currentcolor: '#000000',
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  yellow: '#ffff00',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  teal: '#008080',
  navy: '#000080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  purple: '#800080',
  orange: '#ffa500',
  gold: '#ffd700',
  amber: '#ffbf00',
  coral: '#ff7f50',
  crimson: '#dc143c',
  pink: '#ffc0cb',
  hotpink: '#ff69b4',
  deeppink: '#ff1493',
  lightpink: '#ffb6c1',
  palevioletred: '#db7093',
  mediumvioletred: '#c71585',
  violet: '#ee82ee',
  plum: '#dda0dd',
  orchid: '#da70d6',
  mediumorchid: '#ba55d3',
  darkorchid: '#9932cc',
  darkviolet: '#9400d3',
  blueviolet: '#8a2be2',
  darkmagenta: '#8b008b',
  indigo: '#4b0082',
  slateblue: '#6a5acd',
  darkslateblue: '#483d8b',
  mediumslateblue: '#7b68ee',
  mediumpurple: '#9370db',
  rebeccapurple: '#663399',
  lavender: '#e6e6fa',
  thistle: '#d8bfd8',
  salmon: '#fa8072',
  darksalmon: '#e9967a',
  lightsalmon: '#ffa07a',
  lightcoral: '#f08080',
  indianred: '#cd5c5c',
  firebrick: '#b22222',
  darkred: '#8b0000',
  tomato: '#ff6347',
  orangered: '#ff4500',
  darkorange: '#ff8c00',
  lightyellow: '#ffffe0',
  lemonchiffon: '#fffacd',
  lightgoldenrodyellow: '#fafad2',
  papayawhip: '#ffefd5',
  moccasin: '#ffe4b5',
  peachpuff: '#ffdab9',
  palegoldenrod: '#eee8aa',
  khaki: '#f0e68c',
  darkkhaki: '#bdb76b',
  cornsilk: '#fff8dc',
  blanchedalmond: '#ffebcd',
  bisque: '#ffe4c4',
  navajowhite: '#ffdead',
  wheat: '#f5deb3',
  burlywood: '#deb887',
  tan: '#d2b48c',
  rosybrown: '#bc8f8f',
  sandybrown: '#f4a460',
  goldenrod: '#daa520',
  darkgoldenrod: '#b8860b',
  peru: '#cd853f',
  chocolate: '#d2691e',
  saddlebrown: '#8b4513',
  sienna: '#a0522d',
  brown: '#a52a2a',
  greenyellow: '#adff2f',
  chartreuse: '#7fff00',
  lawngreen: '#7cfc00',
  limegreen: '#32cd32',
  palegreen: '#98fb98',
  lightgreen: '#90ee90',
  mediumspringgreen: '#00fa9a',
  springgreen: '#00ff7f',
  mediumseagreen: '#3cb371',
  seagreen: '#2e8b57',
  forestgreen: '#228b22',
  darkgreen: '#006400',
  yellowgreen: '#9acd32',
  olivedrab: '#6b8e23',
  darkolivegreen: '#556b2f',
  mediumaquamarine: '#66cdaa',
  darkseagreen: '#8fbc8f',
  lightseagreen: '#20b2aa',
  darkcyan: '#008b8b',
  lightcyan: '#e0ffff',
  paleturquoise: '#afeeee',
  aquamarine: '#7fffd4',
  turquoise: '#40e0d0',
  mediumturquoise: '#48d1cc',
  darkturquoise: '#00ced1',
  cadetblue: '#5f9ea0',
  steelblue: '#4682b4',
  lightsteelblue: '#b0c4de',
  powderblue: '#b0e0e6',
  lightblue: '#add8e6',
  skyblue: '#87ceeb',
  lightskyblue: '#87cefa',
  deepskyblue: '#00bfff',
  dodgerblue: '#1e90ff',
  cornflowerblue: '#6495ed',
  royalblue: '#4169e1',
  mediumblue: '#0000cd',
  darkblue: '#00008b',
  midnightblue: '#191970',
  snow: '#fffafa',
  honeydew: '#f0fff0',
  mintcream: '#f5fffa',
  azure: '#f0ffff',
  aliceblue: '#f0f8ff',
  ghostwhite: '#f8f8ff',
  whitesmoke: '#f5f5f5',
  seashell: '#fff5ee',
  beige: '#f5f5dc',
  oldlace: '#fdf5e6',
  floralwhite: '#fffaf0',
  ivory: '#fffff0',
  antiquewhite: '#faebd7',
  linen: '#faf0e6',
  lavenderblush: '#fff0f5',
  mistyrose: '#ffe4e1',
  gainsboro: '#dcdcdc',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  dimgray: '#696969',
  dimgrey: '#696969',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  slategray: '#708090',
  slategrey: '#708090',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hex2(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function parseAlpha(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('%')) {
    const num = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(num)) return null;
    return clamp(num / 100, 0, 1);
  }
  const num = Number.parseFloat(trimmed);
  if (!Number.isFinite(num)) return null;
  return clamp(num, 0, 1);
}

function parseRgbChannel(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return clamp((pct / 100) * 255, 0, 255);
  }
  const num = Number.parseFloat(trimmed);
  if (!Number.isFinite(num)) return null;
  return clamp(num, 0, 255);
}

function rgbToHex(channels: [string, string, string], alphaRaw: string | undefined): string | null {
  const r = parseRgbChannel(channels[0]);
  const g = parseRgbChannel(channels[1]);
  const b = parseRgbChannel(channels[2]);
  const alpha = parseAlpha(alphaRaw);
  if (r === null || g === null || b === null || alpha === null) return null;
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  if (alpha >= 1 - 1e-6) return base;
  return `${base}${hex2(alpha * 255)}`;
}

function hueToRgb(p: number, q: number, t: number): number {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

function parseHueAngle(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  let deg: number;
  if (trimmed.endsWith('deg')) {
    deg = Number.parseFloat(trimmed.slice(0, -3));
  } else if (trimmed.endsWith('grad')) {
    deg = Number.parseFloat(trimmed.slice(0, -4)) * 0.9;
  } else if (trimmed.endsWith('rad')) {
    deg = (Number.parseFloat(trimmed.slice(0, -3)) * 180) / Math.PI;
  } else if (trimmed.endsWith('turn')) {
    deg = Number.parseFloat(trimmed.slice(0, -4)) * 360;
  } else {
    deg = Number.parseFloat(trimmed);
  }
  return Number.isFinite(deg) ? deg : null;
}

function hslToHex(parts: [string, string, string], alphaRaw: string | undefined): string | null {
  const hRaw = parseHueAngle(parts[0]);
  const sRaw = Number.parseFloat(parts[1]);
  const lRaw = Number.parseFloat(parts[2]);
  const alpha = parseAlpha(alphaRaw);
  if (hRaw === null || !Number.isFinite(sRaw) || !Number.isFinite(lRaw) || alpha === null) {
    return null;
  }
  const h = (((hRaw % 360) + 360) % 360) / 360;
  const s = clamp(sRaw / 100, 0, 1);
  const l = clamp(lRaw / 100, 0, 1);

  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = l;
    g = l;
    b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  const base = `#${hex2(r * 255)}${hex2(g * 255)}${hex2(b * 255)}`;
  if (alpha >= 1 - 1e-6) return base;
  return `${base}${hex2(alpha * 255)}`;
}

export function normalizeColor(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const named = NAMED_COLORS[trimmed];
  if (named) return named;

  const hexMatch = HEX_RE.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    if (hex.length === 3) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    if (hex.length === 4) {
      const a = `${hex[3]}${hex[3]}`;
      const rgb = `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
      return a === 'ff' ? rgb : `${rgb}${a}`;
    }
    if (hex.length === 6) {
      return `#${hex}`;
    }
    if (hex.length === 8) {
      const rgb = `#${hex.slice(0, 6)}`;
      const a = hex.slice(6, 8);
      return a === 'ff' ? rgb : `${rgb}${a}`;
    }
  }

  const rgbMatch = RGB_COMMA_RE.exec(trimmed) ?? RGB_SPACE_RE.exec(trimmed);
  if (rgbMatch) {
    return rgbToHex([rgbMatch[1]!, rgbMatch[2]!, rgbMatch[3]!], rgbMatch[4]);
  }

  const hslMatch = HSL_COMMA_RE.exec(trimmed) ?? HSL_SPACE_RE.exec(trimmed);
  if (hslMatch) {
    return hslToHex([hslMatch[1]!, hslMatch[2]!, hslMatch[3]!], hslMatch[4]);
  }

  return null;
}

export function isColor(input: string): boolean {
  return normalizeColor(input) !== null;
}