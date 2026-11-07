import { z } from 'zod';
import { canonicalizeDoc } from './canonicalize.js';
import { DesignError } from './errors.js';
import { LIMITS } from './limits.js';
import { ALLOWED_FONTS, DESIGN_DOC_VERSION, type DesignDoc } from './model.js';

const number = z.number().finite();
const nonNegative = number.min(0);
const positive = number.positive();
const color = z.string().min(1);

const gradientStopSchema = z.object({
  color,
  pos: number.min(0).max(100),
});

const fillSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color }),
  z.object({
    kind: z.literal('linear'),
    angle: number,
    stops: z.array(gradientStopSchema).min(LIMITS.gradient.minStops).max(LIMITS.gradient.maxStops),
  }),
]);

const shadowSchema = z.object({
  x: number,
  y: number,
  blur: nonNegative,
  spread: number.optional(),
  color,
});

const borderSchema = z.object({
  width: positive,
  style: z.enum(['solid', 'dashed', 'dotted']),
  color,
});

const inlineNodeSchema = z.union([
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('br') }),
  z.object({
    kind: z.literal('span'),
    text: z.string(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    color: color.optional(),
  }),
]);

const textStyleSchema = z.object({
  fontFamily: z.enum(ALLOWED_FONTS),
  fontSize: positive,
  fontWeight: number.int().min(100).max(900),
  italic: z.boolean(),
  underline: z.boolean(),
  color,
  align: z.enum(['left', 'center', 'right', 'justify']),
  lineHeight: positive,
  letterSpacing: number,
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']),
  shadow: shadowSchema.optional(),
});

const layerBaseShape = {
  id: z.string().min(1).max(LIMITS.document.maxLayerIdLength),
  name: z.string().min(1).max(LIMITS.document.maxLayerNameLength),
  left: number,
  top: number,
  width: positive,
  rotation: number,
  opacity: number.min(0).max(1),
  hidden: z.boolean(),
  locked: z.boolean(),
};

const textLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal('text'),
  dir: z.enum(['ltr', 'rtl']),
  content: z.array(inlineNodeSchema).max(LIMITS.text.maxInlineNodesPerLayer),
  style: textStyleSchema,
});

const shapeLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal('shape'),
  height: positive,
  style: z.object({
    fill: fillSchema,
    border: borderSchema.optional(),
    radius: nonNegative,
    shadow: shadowSchema.optional(),
  }),
});

const imageLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal('image'),
  height: positive,
  src: z.string().regex(/^asset:[A-Za-z0-9_-]{1,64}$/),
  prompt: z.string().optional(),
  alt: z.string().optional(),
  style: z.object({
    fit: z.enum(['cover', 'contain', 'fill']),
    position: z.object({ x: number.min(0).max(100), y: number.min(0).max(100) }),
    radius: nonNegative,
    border: borderSchema.optional(),
    shadow: shadowSchema.optional(),
  }),
});

const svgTagSchema = z.enum([
  'svg',
  'g',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'title',
  'desc',
]);

export type SvgNodeInput =
  | { kind: 'element'; tag: z.infer<typeof svgTagSchema>; attrs: Record<string, string>; children: SvgNodeInput[] }
  | { kind: 'text'; text: string };

const svgNodeSchema: z.ZodType<SvgNodeInput> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal('element'),
      tag: svgTagSchema,
      attrs: z.record(z.string()),
      children: z.array(svgNodeSchema),
    }),
    z.object({ kind: z.literal('text'), text: z.string() }),
  ]),
);

const svgLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal('svg'),
  height: positive,
  viewBox: z.string().optional(),
  nodes: z.array(svgNodeSchema).max(LIMITS.svg.maxNodes),
});

const layerSchema = z.discriminatedUnion('type', [
  textLayerSchema,
  shapeLayerSchema,
  imageLayerSchema,
  svgLayerSchema,
]);

export const designDocSchema = z.object({
  schemaVersion: z.literal(DESIGN_DOC_VERSION),
  width: number.min(LIMITS.document.minArtboardSide).max(LIMITS.document.maxArtboardSide),
  height: number.min(LIMITS.document.minArtboardSide).max(LIMITS.document.maxArtboardSide),
  background: fillSchema,
  layers: z.array(layerSchema).max(LIMITS.document.maxLayers),
});

/**
 * Validates an untrusted document and returns its canonical form.
 *
 * This is the runtime boundary used by the API and by persisted snapshots.
 * Structural problems throw `INVALID_DOC`; limits are enforced by both the
 * schema and `canonicalizeDoc`.
 */
export function validateDesignDoc(input: unknown): DesignDoc {
  const result = designDocSchema.safeParse(input);
  if (!result.success) {
    throw new DesignError('INVALID_DOC', 'Design document failed validation', 'document', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return canonicalizeDoc(result.data as DesignDoc);
}

export function isDesignDoc(input: unknown): input is DesignDoc {
  return designDocSchema.safeParse(input).success;
}
