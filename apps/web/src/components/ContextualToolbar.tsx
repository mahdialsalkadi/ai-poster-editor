import type { AlignTarget, TextEffectPreset } from '../editor/layers.js';
import type { Layer, TextLayer } from '@poster/core';
import { useI18n } from '../i18n.js';

export type ContextualToolbarProps = {
  layers: Layer[];
  effect: TextEffectPreset;
  canPaste: boolean;
  onTextStyle: (patch: Partial<TextLayer['style']>) => void;
  onShapeColor: (color: string) => void;
  onAlign: (target: AlignTarget) => void;
  onEffect: (preset: TextEffectPreset) => void;
  onCopyStyle: () => void;
  onPasteStyle: () => void;
};

const EFFECTS: TextEffectPreset[] = [
  'none',
  'softShadow',
  'lift',
  'neon',
  'echo',
  'splice',
  'glitch',
];

const EFFECT_KEYS = {
  none: 'effectNone',
  softShadow: 'effectSoftShadow',
  lift: 'effectLift',
  neon: 'effectNeon',
  echo: 'effectEcho',
  splice: 'effectSplice',
  glitch: 'effectGlitch',
} as const;

export function ContextualToolbar({
  layers,
  effect,
  canPaste,
  onTextStyle,
  onShapeColor,
  onAlign,
  onEffect,
  onCopyStyle,
  onPasteStyle,
}: ContextualToolbarProps) {
  const { t } = useI18n();
  if (layers.length === 0) return null;

  const text = layers.find((layer) => layer.type === 'text') as TextLayer | undefined;
  const shape = layers.find((layer) => layer.type === 'shape');
  const solid =
    shape && shape.type === 'shape' && shape.style.fill.kind === 'solid'
      ? shape.style.fill.color
      : '#000000';
  const front = layers[0];
  if (!front) return null;

  return (
    <div
      className="context-toolbar"
      data-testid="context-toolbar"
      role="toolbar"
      aria-label={t('contextTools')}
    >
      <span className="context-type">
        {layers.length > 1 ? t('multipleSelected', { count: layers.length }) : front.name}
      </span>

      {text ? (
        <>
          <div className="context-group" role="group" aria-label={t('fontSize')}>
            <button
              type="button"
              className="context-button"
              aria-label={t('fontSize')}
              onClick={() => onTextStyle({ fontSize: Math.max(8, text.style.fontSize - 2) })}
            >
              −
            </button>
            <span className="context-value" data-testid="context-font-size">
              {Math.round(text.style.fontSize)}
            </span>
            <button
              type="button"
              className="context-button"
              aria-label={t('fontSize')}
              onClick={() => onTextStyle({ fontSize: Math.min(400, text.style.fontSize + 2) })}
            >
              +
            </button>
          </div>
          <input
            type="color"
            className="context-color"
            value={text.style.color}
            aria-label={t('textColor')}
            onChange={(event) => onTextStyle({ color: event.target.value })}
          />
          <select
            className="context-select"
            data-testid="text-effect"
            aria-label={t('textEffects')}
            value={effect}
            onChange={(event) => onEffect(event.target.value as TextEffectPreset)}
          >
            {EFFECTS.map((preset) => (
              <option key={preset} value={preset}>
                {t(EFFECT_KEYS[preset])}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {shape ? (
        <input
          type="color"
          className="context-color"
          value={solid}
          aria-label={t('fill')}
          onChange={(event) => onShapeColor(event.target.value)}
        />
      ) : null}

      <div className="context-group" role="group" aria-label={t('alignment')}>
        <button
          type="button"
          className="context-button"
          aria-label={t('alignLeft')}
          onClick={() => onAlign('left')}
        >
          ⇤
        </button>
        <button
          type="button"
          className="context-button"
          aria-label={t('alignCenterX')}
          onClick={() => onAlign('centerX')}
        >
          ↔
        </button>
        <button
          type="button"
          className="context-button"
          aria-label={t('alignRight')}
          onClick={() => onAlign('right')}
        >
          ⇥
        </button>
      </div>

      <div className="context-group context-group--end" role="group" aria-label={t('copyStyle')}>
        <button
          type="button"
          className="context-button context-button--wide"
          data-testid="copy-style"
          onClick={onCopyStyle}
        >
          {t('copyStyle')}
        </button>
        <button
          type="button"
          className="context-button context-button--wide"
          data-testid="paste-style"
          disabled={!canPaste}
          onClick={onPasteStyle}
        >
          {t('pasteStyle')}
        </button>
      </div>
    </div>
  );
}
