import { useEffect, useRef, useState, type ReactNode } from 'react';
import { normalizeColor } from '@poster/core';
import { Icon, type IconName } from './icons.js';

export function IconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  size = 'md',
  variant = 'ghost',
  type = 'button',
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'solid' | 'danger';
  type?: 'button' | 'submit';
}) {
  const pixels = size === 'sm' ? 16 : size === 'lg' ? 22 : 19;
  return (
    <button
      type={type}
      className={`icon-button icon-button--${variant} icon-button--${size}${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={pixels} />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  icon,
  disabled = false,
  type = 'button',
  full = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  type?: 'button' | 'submit';
  full?: boolean;
  title?: string;
}) {
  return (
    <button
      type={type}
      className={`button button--${variant}${full ? ' button--full' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon ? <Icon name={icon} size={17} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <div className={`field${wide ? ' field--wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Row({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return (
    <div className="row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  disabled = false,
  dir,
  mono = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  dir?: 'ltr' | 'rtl';
  mono?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      className={`text-input${mono ? ' text-input--mono' : ''}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      dir={dir}
      aria-label={ariaLabel}
      spellCheck={false}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  maxLength,
  dir,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  dir?: 'ltr' | 'rtl';
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <textarea
      className="text-area"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      maxLength={maxLength}
      dir={dir}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck={false}
    />
  );
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function NumberInput({
  value,
  onChange,
  min = -100_000,
  max = 100_000,
  step = 1,
  suffix,
  disabled = false,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(() => formatNumber(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(formatNumber(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatNumber(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
    setDraft(formatNumber(clamped));
  };

  return (
    <div className={`number-input${disabled ? ' is-disabled' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const parsed = Number.parseFloat(raw);
          if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(formatNumber(value));
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            const next = Math.min(max, Math.max(min, value + direction * step));
            onChange(next);
            setDraft(formatNumber(next));
          }
        }}
      />
      {suffix ? <span className="number-suffix">{suffix}</span> : null}
    </div>
  );
}

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export type SelectGroup<T extends string> = {
  label: string;
  options: SelectOption<T>[];
};

export function Select<T extends string>({
  value,
  onChange,
  options,
  groups,
  disabled = false,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options?: SelectOption<T>[];
  groups?: SelectGroup<T>[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className={`select${disabled ? ' is-disabled' : ''}`}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {groups
          ? groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))
          : (options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
      </select>
      <Icon name="chevronDown" size={14} className="select-chevron" />
    </div>
  );
}

function toHex6(value: string): string {
  const hex = value.trim();
  if (/^#[0-9a-f]{6}/i.test(hex)) return hex.slice(0, 7).toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
  }
  return '#000000';
}

function alphaSuffix(value: string): string {
  const hex = value.trim();
  return /^#[0-9a-f]{8}$/i.test(hex) ? hex.slice(7).toLowerCase() : '';
}

export function ColorInput({
  value,
  onChange,
  ariaLabel = 'Color',
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const normalized = normalizeColor(draft);
    if (normalized) {
      setDraft(normalized);
      onChange(normalized);
    } else {
      setDraft(value);
    }
  };

  return (
    <div className="color-input">
      <span className="color-swatch" style={{ background: value }}>
        <input
          type="color"
          value={toHex6(value)}
          aria-label={`${ariaLabel} picker`}
          onChange={(event) => {
            const next = `${event.target.value}${alphaSuffix(value)}`;
            setDraft(next);
            onChange(next);
          }}
        />
      </span>
      <input
        className="color-text"
        value={draft}
        aria-label={ariaLabel}
        spellCheck={false}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
}) {
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
        aria-label={ariaLabel}
      />
      <span className="slider-value">{Math.round(value)}</span>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </button>
  );
}

export type SegmentOption<T extends string> = {
  value: T;
  label?: string;
  icon?: IconName;
  title: string;
};

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segment${value === option.value ? ' is-active' : ''}`}
          onClick={() => onChange(option.value)}
          title={option.title}
          aria-pressed={value === option.value}
        >
          {option.icon ? <Icon name={option.icon} size={16} /> : null}
          {option.label ? <span>{option.label}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Section({
  title,
  icon,
  children,
  action,
  defaultOpen = true,
}: {
  title: string;
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section${open ? ' is-open' : ''}`}>
      <header className="section-header">
        <button
          type="button"
          className="section-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <Icon name="chevronDown" size={15} className="section-chevron" />
          {icon ? <Icon name={icon} size={16} /> : null}
          <span>{title}</span>
        </button>
        {action ? <div className="section-action">{action}</div> : null}
      </header>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'danger' | 'success';
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
