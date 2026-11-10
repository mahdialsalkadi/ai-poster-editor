import {
  ALLOWED_FONTS,
  ARABIC_FONTS,
  A4_SIZE,
  LIMITS,
  clamp,
  requiresZeroLetterSpacing,
  type AllowedFont,
  type Border,
  type DesignDoc,
  type Fill,
  type ImageLayer,
  type Layer,
  type ObjectFit,
  type Shadow,
  type ShapeLayer,
  type SvgLayer,
  type TextAlign,
  type TextLayer,
  type TextTransform,
} from '@poster/core';
import { useI18n, type MessageKey, type Translator } from '../i18n.js';
import type { AssetEntry } from '../editor/assets.js';
import { insertStop, normalizeStops, reverseGradient } from '../editor/fills.js';
import type { UpdateOptions } from '../editor/history.js';
import {
  estimatedLayerHeight,
  replaceTextContent,
  updateLayer,
  type AlignTarget,
  type ReorderMove,
} from '../editor/layers.js';
import { fillToCss } from '../editor/render.js';
import { inlineToPlain, plainToInline } from '../editor/text.js';
import {
  Button,
  ColorInput,
  Field,
  IconButton,
  NumberInput,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  TextArea,
  TextInput,
  Toggle,
} from './controls.js';
import { Icon } from './icons.js';

export type InspectorProps = {
  doc: DesignDoc;
  selection: string[];
  assets: AssetEntry[];
  onUpdate: (updater: (doc: DesignDoc) => DesignDoc, options?: UpdateOptions) => void;
  onDelete: (ids: string[]) => void;
  onDuplicate: (ids: string[]) => void;
  onReorder: (id: string, move: ReorderMove) => void;
  onAlign: (target: AlignTarget) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onStartEditText: (id: string) => void;
  onReplaceImage: (layerId: string, asset: AssetEntry) => void;
};

function fontGroups(t: Translator) {
  return [
    {
      label: t('fontGroupArabic'),
      options: ALLOWED_FONTS.filter((font) => ARABIC_FONTS.has(font)).map((font) => ({
        value: font,
        label: font,
      })),
    },
    {
      label: t('fontGroupLatin'),
      options: ALLOWED_FONTS.filter((font) => !ARABIC_FONTS.has(font)).map((font) => ({
        value: font,
        label: font,
      })),
    },
  ];
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => ({
  value: String(weight),
  label: String(weight),
}));

const TYPE_LABEL: Record<Layer['type'], MessageKey> = {
  text: 'layerText',
  shape: 'layerShape',
  image: 'layerImage',
  svg: 'layerSvg',
};

function clampArtboard(width: number, height: number): { width: number; height: number } {
  const maxPixels = LIMITS.document.maxArtboardPixels;
  let w = clamp(
    Math.round(width),
    LIMITS.document.minArtboardSide,
    LIMITS.document.maxArtboardSide,
  );
  let h = clamp(
    Math.round(height),
    LIMITS.document.minArtboardSide,
    LIMITS.document.maxArtboardSide,
  );
  if (w * h > maxPixels) {
    const ratio = Math.sqrt(maxPixels / (w * h));
    w = Math.max(LIMITS.document.minArtboardSide, Math.floor(w * ratio));
    h = Math.max(LIMITS.document.minArtboardSide, Math.floor(h * ratio));
  }
  return { width: w, height: h };
}

function FillEditor({ fill, onChange }: { fill: Fill; onChange: (fill: Fill) => void }) {
  const { t } = useI18n();
  const updateStop = (index: number, patch: { color?: string; pos?: number }) => {
    if (fill.kind !== 'linear') return;
    const stops = fill.stops.map((stop, stopIndex) =>
      stopIndex === index ? { ...stop, ...patch } : stop,
    );
    onChange({ ...fill, stops: normalizeStops(stops) });
  };

  const removeStop = (index: number) => {
    if (fill.kind !== 'linear' || fill.stops.length <= LIMITS.gradient.minStops) return;
    onChange({ ...fill, stops: fill.stops.filter((_, stopIndex) => stopIndex !== index) });
  };

  return (
    <div className="fill-editor">
      <Segmented
        value={fill.kind}
        ariaLabel={t('fillType')}
        onChange={(kind) => {
          if (kind === fill.kind) return;
          if (kind === 'solid') {
            const color = fill.kind === 'linear' ? (fill.stops[0]?.color ?? '#ffffff') : '#ffffff';
            onChange({ kind: 'solid', color });
          } else {
            const color = fill.kind === 'solid' ? fill.color : '#ffffff';
            onChange({
              kind: 'linear',
              angle: 135,
              stops: [
                { color, pos: 0 },
                { color: '#f5a524', pos: 100 },
              ],
            });
          }
        }}
        options={[
          { value: 'solid', label: t('solid'), title: t('solidColor') },
          { value: 'linear', label: t('gradient'), title: t('linearGradient') },
        ]}
      />

      {fill.kind === 'solid' ? (
        <ColorInput value={fill.color} onChange={(color) => onChange({ kind: 'solid', color })} />
      ) : (
        <div className="gradient-editor">
          <div className="gradient-preview" style={{ background: fillToCss(fill) }} />
          <Row cols={2}>
            <Field label={t('angle')}>
              <NumberInput
                value={fill.angle}
                min={0}
                max={360}
                onChange={(angle) => onChange({ ...fill, angle })}
                suffix="°"
              />
            </Field>
            <Field label={t('colors')}>
              <span className="muted-value">
                {fill.stops.length} / {LIMITS.gradient.maxStops}
              </span>
            </Field>
          </Row>
          {fill.stops.map((stop, index) => (
            <div key={index} className="gradient-stop">
              <ColorInput
                value={stop.color}
                ariaLabel={t('stopColor', { index: index + 1 })}
                onChange={(color) => updateStop(index, { color })}
              />
              <NumberInput
                value={stop.pos}
                min={0}
                max={100}
                suffix="%"
                onChange={(pos) => updateStop(index, { pos })}
              />
              <IconButton
                icon="trash"
                label={t('deleteStop')}
                size="sm"
                disabled={fill.stops.length <= LIMITS.gradient.minStops}
                onClick={() => removeStop(index)}
              />
            </div>
          ))}
          <div className="gradient-actions">
            <Button icon="backward" onClick={() => onChange(reverseGradient(fill))}>
              {t('reverseGradient')}
            </Button>
            {fill.stops.length < LIMITS.gradient.maxStops ? (
              <Button
                icon="plus"
                onClick={() => onChange({ ...fill, stops: insertStop(fill.stops) })}
              >
                {t('addColor')}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function BorderEditor({
  value,
  onChange,
}: {
  value: Border | undefined;
  onChange: (border: Border | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sub-editor">
      <Toggle
        checked={value !== undefined}
        label={t('border')}
        onChange={(checked) =>
          onChange(checked ? { width: 2, style: 'solid', color: '#f5a524' } : undefined)
        }
      />
      {value ? (
        <>
          <Row cols={2}>
            <Field label={t('thickness')}>
              <NumberInput
                value={value.width}
                min={1}
                max={200}
                onChange={(width) => onChange({ ...value, width })}
                suffix="px"
              />
            </Field>
            <Field label={t('styleLabel')}>
              <Select
                value={value.style}
                ariaLabel={t('borderStyle')}
                onChange={(style: Border['style']) => onChange({ ...value, style })}
                options={[
                  { value: 'solid', label: t('borderSolid') },
                  { value: 'dashed', label: t('borderDashed') },
                  { value: 'dotted', label: t('borderDotted') },
                ]}
              />
            </Field>
          </Row>
          <Field label={t('borderColor')} wide>
            <ColorInput value={value.color} onChange={(color) => onChange({ ...value, color })} />
          </Field>
        </>
      ) : null}
    </div>
  );
}

function ShadowEditor({
  value,
  onChange,
}: {
  value: Shadow | undefined;
  onChange: (shadow: Shadow | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sub-editor">
      <Toggle
        checked={value !== undefined}
        label={t('shadow')}
        onChange={(checked) =>
          onChange(checked ? { x: 0, y: 18, blur: 36, color: '#00000066' } : undefined)
        }
      />
      {value ? (
        <>
          <Row cols={3}>
            <Field label={t('horizontal')}>
              <NumberInput
                value={value.x}
                min={-500}
                max={500}
                onChange={(x) => onChange({ ...value, x })}
              />
            </Field>
            <Field label={t('vertical')}>
              <NumberInput
                value={value.y}
                min={-500}
                max={500}
                onChange={(y) => onChange({ ...value, y })}
              />
            </Field>
            <Field label={t('blur')}>
              <NumberInput
                value={value.blur}
                min={0}
                max={500}
                onChange={(blur) => onChange({ ...value, blur })}
              />
            </Field>
          </Row>
          <Field label={t('shadowColor')} wide>
            <ColorInput value={value.color} onChange={(color) => onChange({ ...value, color })} />
          </Field>
        </>
      ) : null}
    </div>
  );
}

function DocumentPanel({
  doc,
  onUpdate,
}: {
  doc: DesignDoc;
  onUpdate: InspectorProps['onUpdate'];
}) {
  const { t } = useI18n();
  const setSize = (width: number, height: number) => {
    const next = clampArtboard(width, height);
    onUpdate((current) => ({ ...current, width: next.width, height: next.height }), {
      coalesceKey: 'artboard-size',
    });
  };

  return (
    <>
      <Section title={t('artboardSize')} icon="grid">
        <Row cols={2}>
          <Field label={t('width')}>
            <NumberInput
              value={doc.width}
              min={LIMITS.document.minArtboardSide}
              max={LIMITS.document.maxArtboardSide}
              suffix="px"
              onChange={(width) => setSize(width, doc.height)}
            />
          </Field>
          <Field label={t('height')}>
            <NumberInput
              value={doc.height}
              min={LIMITS.document.minArtboardSide}
              max={LIMITS.document.maxArtboardSide}
              suffix="px"
              onChange={(height) => setSize(doc.width, height)}
            />
          </Field>
        </Row>
        <div className="size-presets">
          {[
            { label: '4:5', width: 1080, height: 1350 },
            { label: t('square'), width: 1080, height: 1080 },
            { label: t('story'), width: 1080, height: 1920 },
            { label: t('landscape'), width: 1920, height: 1080 },
            { label: 'A4', ...A4_SIZE },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`chip${
                doc.width === preset.width && doc.height === preset.height ? ' is-active' : ''
              }`}
              onClick={() => setSize(preset.width, preset.height)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="panel-hint">
          {t('sizeLimit', {
            side: LIMITS.document.maxArtboardSide,
            megapixels: Math.round(LIMITS.document.maxArtboardPixels / 1_000_000),
          })}
        </p>
      </Section>

      <Section title={t('background')} icon="image">
        <FillEditor
          fill={doc.background}
          onChange={(background) => onUpdate((current) => ({ ...current, background }))}
        />
      </Section>

      <Section title={t('design')} icon="layers">
        <div className="stat-list">
          <div>
            <span>{t('layers')}</span>
            <strong>
              {doc.layers.length} / {LIMITS.document.maxLayers}
            </strong>
          </div>
          <div>
            <span>{t('size')}</span>
            <strong>
              {doc.width} × {doc.height}
            </strong>
          </div>
          <div>
            <span>{t('version')}</span>
            <strong>v{doc.schemaVersion}</strong>
          </div>
        </div>
      </Section>
    </>
  );
}

function LayerHeader({ layer, onUpdate }: { layer: Layer; onUpdate: InspectorProps['onUpdate'] }) {
  const { t } = useI18n();
  return (
    <div className="inspector-layer-head">
      <span className={`layer-type layer-type--${layer.type}`}>
        <Icon
          name={
            layer.type === 'text'
              ? 'textLayer'
              : layer.type === 'shape'
                ? 'shape'
                : layer.type === 'image'
                  ? 'image'
                  : 'svgLayer'
          }
          size={16}
        />
      </span>
      <div className="inspector-layer-title">
        <TextInput
          value={layer.name}
          maxLength={LIMITS.document.maxLayerNameLength}
          ariaLabel={t('layerName')}
          onChange={(name) =>
            onUpdate(
              (doc) => updateLayer(doc, layer.id, (item) => ({ ...item, name: name || item.name })),
              { coalesceKey: `name-${layer.id}` },
            )
          }
        />
        <span className="inspector-layer-sub">
          {t(TYPE_LABEL[layer.type])} · {layer.id}
        </span>
      </div>
      <div className="inspector-layer-flags">
        <IconButton
          icon={layer.hidden ? 'eyeOff' : 'eye'}
          label={layer.hidden ? t('showLayer') : t('hideLayer')}
          size="sm"
          active={layer.hidden}
          onClick={() =>
            onUpdate((doc) =>
              updateLayer(doc, layer.id, (item) => ({ ...item, hidden: !item.hidden })),
            )
          }
        />
        <IconButton
          icon={layer.locked ? 'lock' : 'unlock'}
          label={layer.locked ? t('unlockLayer') : t('lockLayer')}
          size="sm"
          active={layer.locked}
          onClick={() =>
            onUpdate((doc) =>
              updateLayer(doc, layer.id, (item) => ({ ...item, locked: !item.locked })),
            )
          }
        />
      </div>
    </div>
  );
}

function TransformSection({
  doc,
  layer,
  onUpdate,
}: {
  doc: DesignDoc;
  layer: Layer;
  onUpdate: InspectorProps['onUpdate'];
}) {
  const { t } = useI18n();
  const height = 'height' in layer ? layer.height : estimatedLayerHeight(layer);
  const patch = (
    values: Partial<Pick<Layer, 'left' | 'top' | 'width' | 'rotation' | 'opacity'>>,
  ) => {
    onUpdate(
      (current) =>
        updateLayer(current, layer.id, (item) => {
          if (item.locked) return item;
          return { ...item, ...values };
        }),
      { coalesceKey: `transform-${layer.id}` },
    );
  };

  const patchHeight = (nextHeight: number) => {
    onUpdate(
      (current) =>
        updateLayer(current, layer.id, (item) =>
          item.type === 'text' || item.locked ? item : { ...item, height: Math.max(1, nextHeight) },
        ),
      { coalesceKey: `size-${layer.id}` },
    );
  };

  return (
    <Section title={t('positionAndSize')} icon="fit">
      <Row cols={2}>
        <Field label="X">
          <NumberInput value={layer.left} onChange={(left) => patch({ left })} suffix="px" />
        </Field>
        <Field label="Y">
          <NumberInput value={layer.top} onChange={(top) => patch({ top })} suffix="px" />
        </Field>
      </Row>
      <Row cols={2}>
        <Field label={t('width')}>
          <NumberInput
            value={layer.width}
            min={1}
            max={10_000}
            onChange={(width) => patch({ width: Math.max(1, width) })}
            suffix="px"
          />
        </Field>
        <Field label={t('height')}>
          <NumberInput
            value={Math.round(height)}
            min={1}
            max={10_000}
            disabled={layer.type === 'text'}
            onChange={patchHeight}
            suffix="px"
          />
        </Field>
      </Row>
      <Row cols={2}>
        <Field label={t('rotation')}>
          <NumberInput
            value={layer.rotation}
            min={0}
            max={360}
            onChange={(rotation) => patch({ rotation })}
            suffix="°"
          />
        </Field>
        <Field label={t('opacity')}>
          <Slider
            value={Math.round(layer.opacity * 100)}
            min={0}
            max={100}
            ariaLabel={t('layerOpacity')}
            onChange={(value) => patch({ opacity: value / 100 })}
          />
        </Field>
      </Row>
      <div className="transform-actions">
        <Button icon="alignLeft" onClick={() => patch({ left: 0 })} title={t('alignLeftCanvas')}>
          {t('left')}
        </Button>
        <Button
          icon="alignCenter"
          onClick={() => patch({ left: Math.round((doc.width - layer.width) / 2) })}
          title={t('centerHorizontally')}
        >
          {t('center')}
        </Button>
        <Button
          icon="alignRight"
          onClick={() => patch({ left: Math.round(doc.width - layer.width) })}
          title={t('alignRightCanvas')}
        >
          {t('right')}
        </Button>
      </div>
    </Section>
  );
}

function TextSection({
  layer,
  onUpdate,
  onStartEditText,
}: {
  layer: TextLayer;
  onUpdate: InspectorProps['onUpdate'];
  onStartEditText: (id: string) => void;
}) {
  const { t } = useI18n();
  const patchStyle = (values: Partial<TextLayer['style']>) => {
    onUpdate(
      (doc) =>
        updateLayer(doc, layer.id, (item) =>
          item.type === 'text' ? { ...item, style: { ...item.style, ...values } } : item,
        ),
      { coalesceKey: `text-style-${layer.id}` },
    );
  };

  const patchLayer = (values: Partial<Pick<TextLayer, 'dir'>>) => {
    onUpdate((doc) =>
      updateLayer(doc, layer.id, (item) => (item.type === 'text' ? { ...item, ...values } : item)),
    );
  };

  return (
    <>
      <Section title={t('text')} icon="text">
        <Field label={t('content')} wide>
          <TextArea
            value={inlineToPlain(layer.content)}
            rows={4}
            maxLength={LIMITS.text.maxCodepointsPerLayer}
            dir={layer.dir}
            ariaLabel={t('textContent')}
            onChange={(value) =>
              onUpdate((doc) => replaceTextContent(doc, layer.id, plainToInline(value)), {
                coalesceKey: `text-content-${layer.id}`,
              })
            }
          />
        </Field>
        {layer.content.some((node) => node.kind === 'span') ? (
          <p className="panel-hint">{t('richTextHint')}</p>
        ) : null}
        <Button icon="text" onClick={() => onStartEditText(layer.id)} full>
          {t('editOnCanvas')}
        </Button>
      </Section>

      <Section title={t('font')} icon="textLayer">
        <Field label={t('family')} wide>
          <Select
            value={layer.style.fontFamily}
            groups={fontGroups(t)}
            ariaLabel={t('fontFamily')}
            onChange={(fontFamily: AllowedFont) => patchStyle({ fontFamily })}
          />
        </Field>
        <Row cols={2}>
          <Field label={t('fontSize')}>
            <NumberInput
              value={layer.style.fontSize}
              min={LIMITS.text.minFontSize}
              max={LIMITS.text.maxFontSize}
              suffix="px"
              onChange={(fontSize) => patchStyle({ fontSize })}
            />
          </Field>
          <Field label={t('weight')}>
            <Select
              value={String(layer.style.fontWeight)}
              options={WEIGHTS}
              ariaLabel={t('fontWeight')}
              onChange={(weight) => patchStyle({ fontWeight: Number(weight) })}
            />
          </Field>
        </Row>
        <Row cols={2}>
          <Field label={t('lineHeight')}>
            <NumberInput
              value={layer.style.lineHeight}
              min={LIMITS.text.minLineHeight}
              max={LIMITS.text.maxLineHeight}
              step={0.05}
              onChange={(lineHeight) => patchStyle({ lineHeight })}
            />
          </Field>
          <Field label={t('letterSpacing')}>
            <NumberInput
              value={layer.style.letterSpacing}
              ariaLabel={t('letterSpacing')}
              disabled={requiresZeroLetterSpacing(layer.dir, inlineToPlain(layer.content))}
              min={LIMITS.text.minLetterSpacing}
              max={LIMITS.text.maxLetterSpacing}
              step={0.5}
              onChange={(letterSpacing) => patchStyle({ letterSpacing })}
            />
          </Field>
        </Row>
        <Field label={t('alignment')} wide>
          <Segmented
            value={layer.style.align}
            ariaLabel={t('textAlignment')}
            onChange={(align: TextAlign) => patchStyle({ align })}
            options={[
              { value: 'left', icon: 'alignLeft', title: t('left') },
              { value: 'center', icon: 'alignCenter', title: t('center') },
              { value: 'right', icon: 'alignRight', title: t('right') },
              { value: 'justify', icon: 'alignJustify', title: t('justify') },
            ]}
          />
        </Field>
        <Field label={t('direction')} wide>
          <Segmented
            value={layer.dir}
            ariaLabel={t('textDirection')}
            onChange={(dir) => patchLayer({ dir })}
            options={[
              { value: 'rtl', label: 'RTL', title: t('rtlTitle') },
              { value: 'ltr', label: 'LTR', title: t('ltrTitle') },
            ]}
          />
        </Field>
        <Field label={t('textColor')} wide>
          <ColorInput value={layer.style.color} onChange={(color) => patchStyle({ color })} />
        </Field>
        <Field label={t('transform')} wide>
          <Select
            value={layer.style.textTransform}
            ariaLabel={t('textTransform')}
            onChange={(textTransform: TextTransform) => patchStyle({ textTransform })}
            options={[
              { value: 'none', label: t('none') },
              { value: 'uppercase', label: t('uppercase') },
              { value: 'lowercase', label: t('lowercase') },
              { value: 'capitalize', label: t('capitalize') },
            ]}
          />
        </Field>
        <div className="inline-toggles">
          <Toggle
            checked={layer.style.italic}
            label={t('italic')}
            onChange={(italic) => patchStyle({ italic })}
          />
          <Toggle
            checked={layer.style.underline}
            label={t('underline')}
            onChange={(underline) => patchStyle({ underline })}
          />
        </div>
        <ShadowEditor
          value={layer.style.shadow}
          onChange={(shadow) => {
            onUpdate((doc) =>
              updateLayer(doc, layer.id, (item) => {
                if (item.type !== 'text') return item;
                const { shadow: _current, ...style } = item.style;
                return { ...item, style: shadow ? { ...style, shadow } : style };
              }),
            );
          }}
        />
      </Section>
    </>
  );
}

function ShapeSection({
  layer,
  onUpdate,
}: {
  layer: ShapeLayer;
  onUpdate: InspectorProps['onUpdate'];
}) {
  const { t } = useI18n();
  const patchStyle = (updater: (style: ShapeLayer['style']) => ShapeLayer['style']) => {
    onUpdate(
      (doc) =>
        updateLayer(doc, layer.id, (item) =>
          item.type === 'shape' ? { ...item, style: updater(item.style) } : item,
        ),
      { coalesceKey: `shape-style-${layer.id}` },
    );
  };

  return (
    <Section title={t('shape')} icon="shape">
      <Field label={t('fill')} wide>
        <FillEditor
          fill={layer.style.fill}
          onChange={(fill) => patchStyle((style) => ({ ...style, fill }))}
        />
      </Field>
      <Field label={t('cornerRadius')} wide>
        <NumberInput
          value={layer.style.radius}
          min={0}
          max={5_000}
          suffix="px"
          onChange={(radius) => patchStyle((style) => ({ ...style, radius }))}
        />
      </Field>
      <BorderEditor
        value={layer.style.border}
        onChange={(border) =>
          patchStyle((style) => {
            const { border: _current, ...rest } = style;
            return border ? { ...rest, border } : rest;
          })
        }
      />
      <ShadowEditor
        value={layer.style.shadow}
        onChange={(shadow) =>
          patchStyle((style) => {
            const { shadow: _current, ...rest } = style;
            return shadow ? { ...rest, shadow } : rest;
          })
        }
      />
    </Section>
  );
}

function ImageSection({
  layer,
  assets,
  onUpdate,
  onReplaceImage,
}: {
  layer: ImageLayer;
  assets: AssetEntry[];
  onUpdate: InspectorProps['onUpdate'];
  onReplaceImage: (layerId: string, asset: AssetEntry) => void;
}) {
  const { t } = useI18n();
  const currentAssetId = layer.src.startsWith('asset:') ? layer.src.slice('asset:'.length) : '';
  const patchStyle = (values: Partial<ImageLayer['style']>) => {
    onUpdate(
      (doc) =>
        updateLayer(doc, layer.id, (item) =>
          item.type === 'image' ? { ...item, style: { ...item.style, ...values } } : item,
        ),
      { coalesceKey: `image-style-${layer.id}` },
    );
  };

  return (
    <Section title={t('image')} icon="image">
      <Field label={t('crop')} wide>
        <Segmented
          value={layer.style.fit}
          ariaLabel={t('crop')}
          onChange={(fit: ObjectFit) => patchStyle({ fit })}
          options={[
            { value: 'cover', label: t('cover'), title: t('coverTitle') },
            { value: 'contain', label: t('contain'), title: t('containTitle') },
            { value: 'fill', label: t('fillImage'), title: t('fillTitle') },
          ]}
        />
      </Field>
      <Field label={t('cornerRadius')} wide>
        <NumberInput
          value={layer.style.radius}
          min={0}
          max={5_000}
          suffix="px"
          onChange={(radius) => patchStyle({ radius })}
        />
      </Field>
      <Row cols={2}>
        <Field label={t('horizontalPosition')}>
          <Slider
            value={layer.style.position.x}
            min={0}
            max={100}
            ariaLabel={t('imageHorizontalPosition')}
            onChange={(x) => patchStyle({ position: { ...layer.style.position, x } })}
          />
        </Field>
        <Field label={t('verticalPosition')}>
          <Slider
            value={layer.style.position.y}
            min={0}
            max={100}
            ariaLabel={t('imageVerticalPosition')}
            onChange={(y) => patchStyle({ position: { ...layer.style.position, y } })}
          />
        </Field>
      </Row>
      <Field label={t('altText')} wide hint={t('altHint')}>
        <TextInput
          value={layer.alt ?? ''}
          maxLength={300}
          ariaLabel={t('imageAlt')}
          onChange={(alt) =>
            onUpdate(
              (doc) =>
                updateLayer(doc, layer.id, (item) =>
                  item.type === 'image' ? { ...item, alt } : item,
                ),
              { coalesceKey: `alt-${layer.id}` },
            )
          }
        />
      </Field>
      {assets.length > 0 ? (
        <Field label={t('replaceImage')} wide>
          <Select
            value={currentAssetId}
            ariaLabel={t('replaceImage')}
            onChange={(assetId) => {
              const asset = assets.find((item) => item.id === assetId);
              if (asset) onReplaceImage(layer.id, asset);
            }}
            options={[
              ...(currentAssetId && !assets.some((asset) => asset.id === currentAssetId)
                ? [{ value: currentAssetId, label: t('currentImageUnavailable') }]
                : []),
              ...assets.map((asset) => ({
                value: asset.id,
                label: `${asset.name} (${asset.width}×${asset.height})`,
              })),
            ]}
          />
        </Field>
      ) : (
        <p className="panel-hint">{t('addImageHint')}</p>
      )}
      <BorderEditor
        value={layer.style.border}
        onChange={(border) =>
          patchStyle(
            (() => {
              const { border: _current, ...rest } = layer.style;
              return border ? { ...rest, border } : rest;
            })(),
          )
        }
      />
      <ShadowEditor
        value={layer.style.shadow}
        onChange={(shadow) => {
          const { shadow: _current, ...rest } = layer.style;
          patchStyle(shadow ? { ...rest, shadow } : rest);
        }}
      />
    </Section>
  );
}

function SvgSection({ layer }: { layer: SvgLayer }) {
  const { t } = useI18n();
  const count = (() => {
    let total = 0;
    const walk = (nodes: SvgLayer['nodes']): void => {
      for (const node of nodes) {
        if (node.kind === 'element') {
          total += 1;
          walk(node.children);
        }
      }
    };
    walk(layer.nodes);
    return total;
  })();

  return (
    <Section title={t('svgDrawing')} icon="svgLayer">
      <div className="stat-list">
        <div>
          <span>{t('elements')}</span>
          <strong>{count}</strong>
        </div>
        <div>
          <span>viewBox</span>
          <strong className="mono">{layer.viewBox ?? t('automatic')}</strong>
        </div>
      </div>
      <p className="panel-hint">{t('svgHint')}</p>
    </Section>
  );
}

function ArrangeSection({
  selection,
  onUpdate,
  onReorder,
  onAlign,
  onDistribute,
  onDuplicate,
  onDelete,
}: {
  selection: string[];
  onUpdate: InspectorProps['onUpdate'];
  onReorder: InspectorProps['onReorder'];
  onAlign: InspectorProps['onAlign'];
  onDistribute: InspectorProps['onDistribute'];
  onDuplicate: InspectorProps['onDuplicate'];
  onDelete: InspectorProps['onDelete'];
}) {
  const { t } = useI18n();
  const single = selection.length === 1 ? selection[0] : null;

  return (
    <Section title={t('arrange')} icon="layers">
      {single ? (
        <div className="arrange-grid">
          <Button icon="front" onClick={() => onReorder(single, 'front')} title={t('frontTitle')}>
            {t('front')}
          </Button>
          <Button
            icon="forward"
            onClick={() => onReorder(single, 'forward')}
            title={t('forwardTitle')}
          >
            {t('forward')}
          </Button>
          <Button icon="back" onClick={() => onReorder(single, 'back')} title={t('backTitle')}>
            {t('back')}
          </Button>
          <Button
            icon="backward"
            onClick={() => onReorder(single, 'backward')}
            title={t('backwardTitle')}
          >
            {t('backward')}
          </Button>
        </div>
      ) : null}

      <div className="align-grid">
        <IconButton icon="alignLeft" label={t('alignLeft')} onClick={() => onAlign('left')} />
        <IconButton
          icon="alignCenter"
          label={t('alignCenterX')}
          onClick={() => onAlign('centerX')}
        />
        <IconButton icon="alignRight" label={t('alignRight')} onClick={() => onAlign('right')} />
        <IconButton icon="alignTop" label={t('alignTop')} onClick={() => onAlign('top')} />
        <IconButton
          icon="alignMiddle"
          label={t('alignCenterY')}
          onClick={() => onAlign('centerY')}
        />
        <IconButton icon="alignBottom" label={t('alignBottom')} onClick={() => onAlign('bottom')} />
      </div>

      {selection.length >= 3 ? (
        <div className="row">
          <Button icon="alignJustify" onClick={() => onDistribute('horizontal')}>
            {t('distributeHorizontal')}
          </Button>
          <Button icon="alignMiddle" onClick={() => onDistribute('vertical')}>
            {t('distributeVertical')}
          </Button>
        </div>
      ) : null}

      <div className="row">
        <Button icon="duplicate" onClick={() => onDuplicate(selection)}>
          {t('duplicate')}
        </Button>
        <Button icon="trash" variant="danger" onClick={() => onDelete(selection)}>
          {t('delete')}
        </Button>
      </div>

      <div className="nudge-hint">
        <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> {t('nudgeMove')} <kbd>Shift</kbd>{' '}
        {t('nudgeLargeStep')}
      </div>
      <Button
        icon="grid"
        full
        onClick={() =>
          onUpdate((doc) => ({
            ...doc,
            layers: doc.layers.map((layer) =>
              selection.includes(layer.id) && !layer.locked
                ? { ...layer, left: Math.round(layer.left), top: Math.round(layer.top) }
                : layer,
            ),
          }))
        }
      >
        {t('snapToPixelGrid')}
      </Button>
    </Section>
  );
}

function MultiPanel({
  selection,
  onAlign,
  onDistribute,
  onDuplicate,
  onDelete,
}: {
  selection: string[];
  onAlign: InspectorProps['onAlign'];
  onDistribute: InspectorProps['onDistribute'];
  onDuplicate: InspectorProps['onDuplicate'];
  onDelete: InspectorProps['onDelete'];
}) {
  const { t } = useI18n();
  return (
    <Section title={t('multipleSelected', { count: selection.length })} icon="layers">
      <p className="panel-hint">{t('multiHint')}</p>
      <div className="align-grid">
        <IconButton icon="alignLeft" label={t('alignLeft')} onClick={() => onAlign('left')} />
        <IconButton
          icon="alignCenter"
          label={t('alignCenterX')}
          onClick={() => onAlign('centerX')}
        />
        <IconButton icon="alignRight" label={t('alignRight')} onClick={() => onAlign('right')} />
        <IconButton icon="alignTop" label={t('alignTop')} onClick={() => onAlign('top')} />
        <IconButton
          icon="alignMiddle"
          label={t('alignCenterY')}
          onClick={() => onAlign('centerY')}
        />
        <IconButton icon="alignBottom" label={t('alignBottom')} onClick={() => onAlign('bottom')} />
      </div>
      <div className="row">
        <Button
          icon="alignJustify"
          onClick={() => onDistribute('horizontal')}
          disabled={selection.length < 3}
        >
          {t('distributeHorizontal')}
        </Button>
        <Button
          icon="alignMiddle"
          onClick={() => onDistribute('vertical')}
          disabled={selection.length < 3}
        >
          {t('distributeVertical')}
        </Button>
      </div>
      <div className="row">
        <Button icon="duplicate" onClick={() => onDuplicate(selection)}>
          {t('duplicate')}
        </Button>
        <Button icon="trash" variant="danger" onClick={() => onDelete(selection)}>
          {t('delete')}
        </Button>
      </div>
    </Section>
  );
}

export function Inspector({
  doc,
  selection,
  assets,
  onUpdate,
  onDelete,
  onDuplicate,
  onReorder,
  onAlign,
  onDistribute,
  onStartEditText,
  onReplaceImage,
}: InspectorProps) {
  const { t } = useI18n();
  const selectedLayers = doc.layers.filter((layer) => selection.includes(layer.id));
  const single = selectedLayers.length === 1 ? selectedLayers[0] : null;

  return (
    <aside className="inspector" aria-label={t('inspectorAria')}>
      <header className="inspector-header">
        <span className="panel-icon">
          <Icon name="panel" size={17} />
        </span>
        <h2>{t('inspectorTitle')}</h2>
        {selection.length > 0 ? (
          <span className="badge badge--accent">{selection.length}</span>
        ) : null}
      </header>

      <div className="inspector-body">
        {!single ? (
          selection.length > 1 ? (
            <MultiPanel
              selection={selection}
              onAlign={onAlign}
              onDistribute={onDistribute}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          ) : (
            <DocumentPanel doc={doc} onUpdate={onUpdate} />
          )
        ) : (
          <>
            <LayerHeader layer={single} onUpdate={onUpdate} />
            <TransformSection doc={doc} layer={single} onUpdate={onUpdate} />
            {single.type === 'text' ? (
              <TextSection layer={single} onUpdate={onUpdate} onStartEditText={onStartEditText} />
            ) : null}
            {single.type === 'shape' ? <ShapeSection layer={single} onUpdate={onUpdate} /> : null}
            {single.type === 'image' ? (
              <ImageSection
                layer={single}
                assets={assets}
                onUpdate={onUpdate}
                onReplaceImage={onReplaceImage}
              />
            ) : null}
            {single.type === 'svg' ? <SvgSection layer={single} /> : null}
            <ArrangeSection
              selection={selection}
              onUpdate={onUpdate}
              onReorder={onReorder}
              onAlign={onAlign}
              onDistribute={onDistribute}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          </>
        )}
      </div>
    </aside>
  );
}
