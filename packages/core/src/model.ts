/** The only document schema version supported by this build. */
export const DESIGN_DOC_VERSION = 1 as const;

export const ALLOWED_FONTS = [
  'Poppins',
  'Montserrat',
  'Playfair Display',
  'Bebas Neue',
  'Inter',
  'Lobster',
  'Cairo',
  'Tajawal',
  'Noto Kufi Arabic',
  'Amiri',
  'IBM Plex Sans Arabic',
] as const;

export type AllowedFont = (typeof ALLOWED_FONTS)[number];

export const ARABIC_FONTS: ReadonlySet<AllowedFont> = new Set([
  'Cairo',
  'Tajawal',
  'Noto Kufi Arabic',
  'Amiri',
  'IBM Plex Sans Arabic',
]);

export const LATIN_FONTS: ReadonlySet<AllowedFont> = new Set([
  'Poppins',
  'Montserrat',
  'Playfair Display',
  'Bebas Neue',
  'Inter',
  'Lobster',
]);

export type Color = string;

export type GradientStop = {
  color: Color;
  /** Percentage in [0, 100]. */
  pos: number;
};

export type Fill =
  { kind: 'solid'; color: Color } | { kind: 'linear'; angle: number; stops: GradientStop[] };

export type Shadow = {
  x: number;
  y: number;
  blur: number;
  /** box-shadow only. */
  spread?: number | undefined;
  color: Color;
};

export type BorderStyle = 'solid' | 'dashed' | 'dotted';

export type Border = {
  width: number;
  style: BorderStyle;
  color: Color;
};

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';
export type ObjectFit = 'cover' | 'contain' | 'fill';
export type LayerType = 'text' | 'shape' | 'image' | 'svg';

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'br' }
  | {
      kind: 'span';
      text: string;
      bold?: boolean | undefined;
      italic?: boolean | undefined;
      underline?: boolean | undefined;
      color?: Color | undefined;
    };

export type TextStyle = {
  fontFamily: AllowedFont;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  color: Color;
  align: TextAlign;
  lineHeight: number;
  letterSpacing: number;
  textTransform: TextTransform;
  shadow?: Shadow | undefined;
};

export type ShapeStyle = {
  fill: Fill;
  border?: Border | undefined;
  radius: number;
  shadow?: Shadow | undefined;
};

export type ImageStyle = {
  fit: ObjectFit;
  position: { x: number; y: number };
  radius: number;
  border?: Border | undefined;
  shadow?: Shadow | undefined;
};

export type SvgTag =
  | 'svg'
  | 'g'
  | 'defs'
  | 'linearGradient'
  | 'radialGradient'
  | 'stop'
  | 'path'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'title'
  | 'desc';

export type SvgNode =
  | {
      kind: 'element';
      tag: SvgTag;
      attrs: Record<string, string>;
      children: SvgNode[];
    }
  | { kind: 'text'; text: string };

export type LayerBase = {
  id: string;
  name: string;
  left: number;
  top: number;
  width: number;
  /** Degrees, normalized to [0, 360). */
  rotation: number;
  /** 0..1 */
  opacity: number;
  hidden: boolean;
  locked: boolean;
};

export type TextLayer = LayerBase & {
  type: 'text';
  dir: 'ltr' | 'rtl';
  content: InlineNode[];
  style: TextStyle;
};

export type ShapeLayer = LayerBase & {
  type: 'shape';
  height: number;
  style: ShapeStyle;
};

export type ImageLayer = LayerBase & {
  type: 'image';
  height: number;
  src: string;
  prompt?: string | undefined;
  alt?: string | undefined;
  style: ImageStyle;
};

export type SvgLayer = LayerBase & {
  type: 'svg';
  height: number;
  viewBox?: string | undefined;
  nodes: SvgNode[];
};

export type Layer = TextLayer | ShapeLayer | ImageLayer | SvgLayer;

export type DesignDoc = {
  schemaVersion: typeof DESIGN_DOC_VERSION;
  width: number;
  height: number;
  background: Fill;
  layers: Layer[];
};

export type ParseOutput = {
  doc: DesignDoc;
  warnings: Warning[];
};

export type WarningSeverity = 'info' | 'warning';

export type WarningCode =
  | 'UNSUPPORTED_PROPERTY'
  | 'UNSUPPORTED_VALUE'
  | 'UNSUPPORTED_COLOR'
  | 'PERCENTAGE_DROPPED'
  | 'FONT_FALLBACK'
  | 'FONT_SCRIPT_MISMATCH'
  | 'DUPLICATE_ID'
  | 'LAYER_LIMIT'
  | 'TEXT_LIMIT'
  | 'SVG_LIMIT'
  | 'GRADIENT_LIMIT'
  | 'NUMBER_CLAMPED'
  | 'COLOR_NORMALIZED'
  | 'MISSING_ATTRIBUTE'
  | 'UNKNOWN_TAG_DROPPED'
  | 'RTL_DIRECTION_INFERRED'
  | 'LEGACY_SCHEMA_DEFAULTED'
  | 'MERGE_NEW_LAYER'
  | 'MERGE_IGNORED_UNSELECTED'
  | 'MERGE_DUPLICATE_ID'
  | 'MERGE_TYPE_CHANGE_IGNORED'
  | 'MERGE_ARTBOARD_CHANGE_IGNORED'
  | 'ASSET_UNRESOLVED';

export type Warning = {
  code: WarningCode;
  message: string;
  /** A JSON-pointer-like path, e.g. `layers[2].style.fontFamily`. */
  path: string;
  layerId?: string | undefined;
  severity: WarningSeverity;
};
