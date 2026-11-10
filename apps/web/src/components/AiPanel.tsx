import { useState } from 'react';
import { useI18n } from '../i18n.js';
import type { AiUsage } from '../editor/api.js';
import type { StoredSnapshot } from '../editor/storage.js';
import { Button, Field, Segmented, Spinner, TextArea, TextInput } from './controls.js';
import { Icon } from './icons.js';

export type AiPanelProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  language: 'auto' | 'ar' | 'en';
  onLanguageChange: (value: 'auto' | 'ar' | 'en') => void;
  style: string;
  onStyleChange: (value: string) => void;
  width: number;
  height: number;
  busy: boolean;
  onGenerate: () => void;
  selectionCount: number;
  onEdit: (instruction: string) => void;
  lastUsage: AiUsage | null;
  snapshots: StoredSnapshot[];
  onRestoreSnapshot: (id: string) => void;
};

export function AiPanel({
  prompt,
  onPromptChange,
  language,
  onLanguageChange,
  style,
  onStyleChange,
  width,
  height,
  busy,
  onGenerate,
  selectionCount,
  onEdit,
  lastUsage,
  snapshots,
  onRestoreSnapshot,
}: AiPanelProps) {
  const { t, lang } = useI18n();
  const [instruction, setInstruction] = useState('');

  return (
    <div className="ai-panel">
      <div className="ai-callout">
        <Icon name="sparkles" size={18} />
        <div>
          <strong>{t('aiGenerateTitle')}</strong>
          <p>{t('aiGenerateHint')}</p>
        </div>
      </div>

      <Field label={t('aiPromptLabel')} wide>
        <TextArea
          value={prompt}
          onChange={onPromptChange}
          rows={5}
          maxLength={4_000}
          placeholder={t('aiPromptPlaceholder')}
          ariaLabel={t('aiPromptAria')}
        />
      </Field>

      <Field label={t('aiLanguageLabel')} wide>
        <Segmented
          value={language}
          onChange={onLanguageChange}
          ariaLabel={t('aiLanguageLabel')}
          options={[
            { value: 'auto', label: t('auto'), title: t('auto') },
            { value: 'ar', label: t('arabic'), title: t('arabic') },
            { value: 'en', label: t('english'), title: t('english') },
          ]}
        />
      </Field>

      <Field label={t('aiStyleLabel')} wide hint={t('aiStyleHint')}>
        <TextInput
          value={style}
          onChange={onStyleChange}
          maxLength={200}
          placeholder={t('aiStylePlaceholder')}
          ariaLabel={t('aiStyleAria')}
        />
      </Field>

      <div className="ai-meta">
        <span>{t('pixelDimensions', { width, height })}</span>
        <span>{t('aiMaxLayers', { count: 60 })}</span>
      </div>

      <Button
        variant="primary"
        icon="sparkles"
        onClick={onGenerate}
        disabled={busy || prompt.trim().length < 3}
        full
      >
        {busy ? t('aiGenerating') : t('aiGenerate')}
      </Button>
      {busy ? <Spinner size={18} /> : null}

      {lastUsage ? (
        <p className="ai-usage">
          {lastUsage.model} · {t('aiSeconds', { value: (lastUsage.latencyMs / 1000).toFixed(1) })} ·{' '}
          {t('aiTokens', { count: lastUsage.outputTokens })}
        </p>
      ) : null}

      <div className="ai-divider" />

      <div className="ai-callout ai-callout--muted">
        <Icon name="layers" size={18} />
        <div>
          <strong>{t('aiEditTitle')}</strong>
          <p>
            {selectionCount > 0
              ? t('aiSelectionWithCount', { count: selectionCount })
              : t('aiSelectionNone')}
          </p>
        </div>
      </div>

      <Field label={t('aiInstructionLabel')} wide>
        <TextArea
          value={instruction}
          onChange={setInstruction}
          rows={3}
          maxLength={4_000}
          placeholder={t('aiInstructionPlaceholder')}
          ariaLabel={t('aiInstructionAria')}
        />
      </Field>

      <Button
        icon="sparkles"
        onClick={() => {
          if (instruction.trim().length >= 3) {
            onEdit(instruction.trim());
            setInstruction('');
          }
        }}
        disabled={busy || selectionCount === 0 || instruction.trim().length < 3}
        full
        title={selectionCount === 0 ? t('aiSelectFirst') : t('aiEditRequiresProvider')}
      >
        {t('aiEdit')}
      </Button>
      <p className="ai-note">{t('aiNote')}</p>

      {snapshots.length > 0 ? (
        <div className="ai-snapshots">
          <div className="ai-divider" />
          <strong className="ai-snapshots-title">{t('aiSnapshots')}</strong>
          <ul>
            {snapshots.slice(0, 5).map((snapshot) => (
              <li key={snapshot.id}>
                <div>
                  <time dateTime={new Date(snapshot.createdAt).toISOString()}>
                    {new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(snapshot.createdAt)}
                  </time>
                  <span title={snapshot.instruction}>{snapshot.instruction}</span>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => onRestoreSnapshot(snapshot.id)}
                  title={t('aiRestoreTitle')}
                >
                  {t('aiRestore')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
