import { useState } from 'react';
import type { AiUsage } from '../editor/api.js';
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
}: AiPanelProps) {
  const [instruction, setInstruction] = useState('');

  return (
    <div className="ai-panel">
      <div className="ai-callout">
        <Icon name="sparkles" size={18} />
        <div>
          <strong>توليد تصميم كامل</strong>
          <p>اكتب وصفاً قصيراً. المولد المحلي الحتمي يعمل الآن، ومزوّد LLM يُضاف في المرحلة التالية.</p>
        </div>
      </div>

      <Field label="وصف التصميم" wide>
        <TextArea
          value={prompt}
          onChange={onPromptChange}
          rows={5}
          maxLength={4_000}
          placeholder="مثال: ملصق معرض فني عربي حديث بألوان داكنة وعنوان كبير"
          ariaLabel="وصف التصميم"
        />
      </Field>

      <Field label="لغة النص" wide>
        <Segmented
          value={language}
          onChange={onLanguageChange}
          ariaLabel="لغة النص"
          options={[
            { value: 'auto', label: 'تلقائي', title: 'كشف اللغة تلقائياً' },
            { value: 'ar', label: 'عربي', title: 'عربي' },
            { value: 'en', label: 'إنجليزي', title: 'إنجليزي' },
          ]}
        />
      </Field>

      <Field label="الأسلوب (اختياري)" wide hint="كلمات مثل: داكن، طباعي، برتقالي، فاخر">
        <TextInput
          value={style}
          onChange={onStyleChange}
          maxLength={200}
          placeholder="داكن، طباعي، برتقالي"
          ariaLabel="أسلوب التصميم"
        />
      </Field>

      <div className="ai-meta">
        <span>
          {width} × {height} بكسل
        </span>
        <span>حتى 60 طبقة</span>
      </div>

      <Button
        variant="primary"
        icon="sparkles"
        onClick={onGenerate}
        disabled={busy || prompt.trim().length < 3}
        full
      >
        {busy ? 'جارٍ التوليد…' : 'ولّد تصميماً'}
      </Button>
      {busy ? <Spinner size={18} /> : null}

      {lastUsage ? (
        <p className="ai-usage">
          {lastUsage.model} · {(lastUsage.latencyMs / 1000).toFixed(1)} ث ·{' '}
          {lastUsage.outputTokens} رمز
        </p>
      ) : null}

      <div className="ai-divider" />

      <div className="ai-callout ai-callout--muted">
        <Icon name="layers" size={18} />
        <div>
          <strong>تعديل التحديد فقط</strong>
          <p>
            {selectionCount > 0
              ? `الطبقات المحددة: ${selectionCount}. اطلب تغييراً محدداً ولن يلمس المساعد بقية التصميم.`
              : 'حدد طبقة أو أكثر على اللوحة ثم اطلب تغييراً عليها وحدها.'}
          </p>
        </div>
      </div>

      <Field label="تعليمات التعديل" wide>
        <TextArea
          value={instruction}
          onChange={setInstruction}
          rows={3}
          maxLength={4_000}
          placeholder="مثال: اجعل العنوان أكبر وغيّر لونه إلى البرتقالي"
          ariaLabel="تعليمات تعديل التحديد"
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
        title={
          selectionCount === 0
            ? 'حدد طبقة أولاً'
            : 'تعديل التحديد يتطلب مزود AI في M1'
        }
      >
        عدّل التحديد
      </Button>
      <p className="ai-note">تعديل التحديد يرسل فقط الطبقات المحددة إلى الخادم، مع الحفاظ على ترتيب الطبقات.</p>
    </div>
  );
}
