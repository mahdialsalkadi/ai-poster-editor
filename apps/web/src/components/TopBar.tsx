import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.js';
import { IconButton, Spinner } from './controls.js';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

export type TopBarProps = {
  name: string;
  onNameChange: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  saveState: SaveState;
  lastSavedAt: number | null;
  onSave: () => void;
  onImport: () => void;
  onCopyHtml: () => void;
  onExport: () => void;
  onPreview: () => void;
  onHelp: () => void;
  onToggleAi: () => void;
  aiActive: boolean;
  aiBusy: boolean;
};

function saveLabel(state: SaveState, lastSavedAt: number | null): string {
  if (state === 'saving') return 'جارٍ الحفظ…';
  if (state === 'dirty') return 'تغييرات غير محفوظة';
  if (state === 'error') return 'تعذر الحفظ';
  if (lastSavedAt) {
    const time = new Date(lastSavedAt);
    return `محفوظ ${time.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return 'محفوظ';
}

function EditableTitle({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className="doc-title"
        onClick={() => setEditing(true)}
        title="إعادة تسمية التصميم"
      >
        <span>{name}</span>
        <Icon name="more" size={16} />
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      className="doc-title-input"
      value={draft}
      maxLength={80}
      aria-label="اسم التصميم"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim() || 'ملصق بدون عنوان';
        onChange(next);
        setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(name);
          setEditing(false);
        }
      }}
    />
  );
}

export function TopBar({
  name,
  onNameChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  saveState,
  lastSavedAt,
  onSave,
  onImport,
  onCopyHtml,
  onExport,
  onPreview,
  onHelp,
  onToggleAi,
  aiActive,
  aiBusy,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="sparkles" size={19} />
        </span>
        <span className="brand-text">
          <strong>Poster</strong>
          <small>استوديو الذكاء الاصطناعي</small>
        </span>
      </div>

      <div className="topbar-title">
        <EditableTitle name={name} onChange={onNameChange} />
        <span className={`save-state save-state--${saveState}`}>
          {saveState === 'saving' ? <Spinner size={11} /> : <span className="save-dot" />}
          {saveLabel(saveState, lastSavedAt)}
        </span>
      </div>

      <div className="topbar-actions">
        <div className="topbar-group">
          <IconButton icon="undo" label="تراجع" onClick={onUndo} disabled={!canUndo} />
          <IconButton icon="redo" label="إعادة" onClick={onRedo} disabled={!canRedo} />
        </div>
        <div className="topbar-group">
          <IconButton icon="import" label="استيراد HTML" onClick={onImport} />
          <IconButton icon="copy" label="نسخ Design HTML" onClick={onCopyHtml} />
          <IconButton icon="play" label="معاينة التصميم" onClick={onPreview} />
          <IconButton icon="more" label="اختصارات لوحة المفاتيح" onClick={onHelp} />
        </div>
        <button
          type="button"
          className={`button button--ai${aiActive ? ' is-active' : ''}`}
          onClick={onToggleAi}
          title="مساعد التصميم بالذكاء الاصطناعي"
        >
          {aiBusy ? <Spinner size={15} /> : <Icon name="sparkles" size={17} />}
          <span>المساعد</span>
        </button>
        <button type="button" className="button" onClick={onSave} title="حفظ (Ctrl+S)">
          <Icon name="save" size={16} />
          <span>حفظ</span>
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={onExport}
          title="تصدير PNG أو JPG أو PDF أو HTML (Ctrl+E)"
        >
          <Icon name="download" size={16} />
          <span>تصدير</span>
        </button>
      </div>
    </header>
  );
}
