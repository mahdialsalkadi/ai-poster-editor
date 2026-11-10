import { useEffect, useRef, useState } from 'react';
import { useI18n, type Lang, type Translator } from '../i18n.js';
import { Icon } from './icons.js';
import { IconButton, Spinner } from './controls.js';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

export type TopBarProps = {
  name: string;
  onNameChange: (name: string) => void;
  docWidth: number;
  docHeight: number;
  onMagicResize: (width: number, height: number) => void;
  onNewDesign: () => void;
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
  accountLabel: string;
  onAccount: () => void;
};

const RESIZE_PRESETS: [number, number][] = [
  [1080, 1080],
  [1080, 1350],
  [1080, 1920],
  [1920, 1080],
];

function saveLabel(
  state: SaveState,
  lastSavedAt: number | null,
  t: Translator,
  lang: Lang,
): string {
  if (state === 'saving') return t('saveSaving');
  if (state === 'dirty') return t('saveDirty');
  if (state === 'error') return t('saveError');
  if (lastSavedAt) {
    const time = new Date(lastSavedAt);
    return t('saveSavedAt', {
      time: time.toLocaleTimeString(lang === 'ar' ? 'ar' : 'en', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
  }
  return t('saveSaved');
}

function EditableTitle({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const { t } = useI18n();
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
        title={t('renameDesign')}
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
      aria-label={t('designName')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim() || t('untitledDesign');
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
  docWidth,
  docHeight,
  onMagicResize,
  onNewDesign,
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
  accountLabel,
  onAccount,
}: TopBarProps) {
  const { lang, setLang, t } = useI18n();
  const [menu, setMenu] = useState<'file' | 'resize' | null>(null);
  const [resizeWidth, setResizeWidth] = useState(String(docWidth));
  const [resizeHeight, setResizeHeight] = useState(String(docHeight));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [menu]);

  useEffect(() => {
    if (menu !== 'resize') return;
    setResizeWidth(String(docWidth));
    setResizeHeight(String(docHeight));
  }, [menu, docWidth, docHeight]);

  const applyResize = (width: number, height: number) => {
    onMagicResize(width, height);
    setMenu(null);
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="sparkles" size={19} />
        </span>
        <span className="brand-text">
          <strong>Poster</strong>
          <small>{t('tagline')}</small>
        </span>
      </div>

      <div className="topbar-title">
        <EditableTitle name={name} onChange={onNameChange} />
        <span className={`save-state save-state--${saveState}`}>
          {saveState === 'saving' ? <Spinner size={11} /> : <span className="save-dot" />}
          {saveLabel(saveState, lastSavedAt, t, lang)}
        </span>
      </div>

      <div className="topbar-actions">
        <div className="topbar-group topbar-menus" ref={menuRef}>
          <div className="menu-wrap">
            <button
              type="button"
              className={`menu-trigger${menu === 'file' ? ' is-active' : ''}`}
              data-testid="file-menu"
              aria-haspopup="menu"
              aria-expanded={menu === 'file'}
              onClick={() => setMenu(menu === 'file' ? null : 'file')}
            >
              {t('fileMenu')} ▾
            </button>
            {menu === 'file' ? (
              <div className="menu-panel" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    onNewDesign();
                    setMenu(null);
                  }}
                >
                  {t('fileNewDesign')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    onSave();
                    setMenu(null);
                  }}
                >
                  {t('save')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    onImport();
                    setMenu(null);
                  }}
                >
                  {t('importHtml')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    onCopyHtml();
                    setMenu(null);
                  }}
                >
                  {t('copyDesignHtml')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    onPreview();
                    setMenu(null);
                  }}
                >
                  {t('previewDesign')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    onExport();
                    setMenu(null);
                  }}
                >
                  {t('export')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    onHelp();
                    setMenu(null);
                  }}
                >
                  {t('keyboardShortcuts')}
                </button>
              </div>
            ) : null}
          </div>

          <div className="menu-wrap">
            <button
              type="button"
              className={`menu-trigger${menu === 'resize' ? ' is-active' : ''}`}
              data-testid="resize-menu"
              aria-haspopup="dialog"
              aria-expanded={menu === 'resize'}
              onClick={() => setMenu(menu === 'resize' ? null : 'resize')}
            >
              {t('resizeDoc')} ▾
            </button>
            {menu === 'resize' ? (
              <div
                className="menu-panel menu-panel--resize"
                role="dialog"
                aria-label={t('resizeDoc')}
              >
                <p className="menu-hint">{t('magicResizeHint')}</p>
                <div className="resize-presets">
                  {RESIZE_PRESETS.map(([width, height]) => (
                    <button
                      key={`${width}x${height}`}
                      type="button"
                      className="menu-item"
                      onClick={() => applyResize(width, height)}
                    >
                      {width} × {height}
                    </button>
                  ))}
                </div>
                <div className="resize-form">
                  <label>
                    {t('width')}
                    <input
                      type="number"
                      min={100}
                      max={5000}
                      data-testid="resize-width"
                      value={resizeWidth}
                      onChange={(event) => setResizeWidth(event.target.value)}
                    />
                  </label>
                  <label>
                    {t('height')}
                    <input
                      type="number"
                      min={100}
                      max={5000}
                      data-testid="resize-height"
                      value={resizeHeight}
                      onChange={(event) => setResizeHeight(event.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="menu-item menu-item--accent"
                  data-testid="resize-apply"
                  onClick={() =>
                    applyResize(Number(resizeWidth) || docWidth, Number(resizeHeight) || docHeight)
                  }
                >
                  {t('applySize')}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="lang-toggle" role="group" aria-label={t('uiLanguage')}>
          <button
            type="button"
            className={lang === 'ar' ? 'is-active' : ''}
            aria-label="العربية"
            aria-pressed={lang === 'ar'}
            onClick={() => setLang('ar')}
          >
            AR
          </button>
          <button
            type="button"
            className={lang === 'en' ? 'is-active' : ''}
            aria-label="English"
            aria-pressed={lang === 'en'}
            onClick={() => setLang('en')}
          >
            EN
          </button>
        </div>
        <div className="topbar-group">
          <IconButton icon="undo" label={t('undo')} onClick={onUndo} disabled={!canUndo} />
          <IconButton icon="redo" label={t('redo')} onClick={onRedo} disabled={!canRedo} />
        </div>
        <div className="topbar-group">
          <IconButton icon="import" label={t('importHtml')} onClick={onImport} />
          <IconButton icon="copy" label={t('copyDesignHtml')} onClick={onCopyHtml} />
          <IconButton icon="play" label={t('previewDesign')} onClick={onPreview} />
          <IconButton icon="more" label={t('keyboardShortcuts')} onClick={onHelp} />
        </div>
        <button
          type="button"
          className="button button--account"
          onClick={onAccount}
          title={t('accountTitle')}
        >
          <Icon name="user" size={16} />
          <span>{accountLabel}</span>
        </button>
        <button
          type="button"
          className={`button button--ai${aiActive ? ' is-active' : ''}`}
          onClick={onToggleAi}
          title={t('aiAssistantTitle')}
        >
          {aiBusy ? <Spinner size={15} /> : <Icon name="sparkles" size={17} />}
          <span>{t('assistant')}</span>
        </button>
        <button type="button" className="button" onClick={onSave} title={t('saveShortcut')}>
          <Icon name="save" size={16} />
          <span>{t('save')}</span>
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={onExport}
          title={t('exportShortcut')}
        >
          <Icon name="download" size={16} />
          <span>{t('export')}</span>
        </button>
      </div>
    </header>
  );
}
