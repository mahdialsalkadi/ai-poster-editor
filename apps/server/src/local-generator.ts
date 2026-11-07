import type { GeneratedDesignResponse, GenerateDesignRequest } from '@poster/contracts';
import { containsArabic, serializeDesignDoc, type DesignDoc } from '@poster/core';

/**
 * Deterministic local fallback used when no AI provider is configured.
 *
 * This is intentionally a small template, not a pretend LLM. It lets the
 * editor and API work end-to-end in development and gives tests a stable
 * response. The real provider adapter is added in M1.
 */
export function generateLocalDesign(input: GenerateDesignRequest): GeneratedDesignResponse {
  const started = performance.now();
  const width = input.width;
  const height = input.height;
  const arabic = input.language === 'ar' || containsArabic(input.prompt);
  const font: 'Cairo' | 'Poppins' = arabic ? 'Cairo' : 'Poppins';
  const dir: 'ltr' | 'rtl' = arabic ? 'rtl' : 'ltr';
  const headline = input.prompt.replace(/\s+/g, ' ').trim().slice(0, 120);
  const body = arabic
    ? 'صُمم هذا الملصق من وصفك. عدّل النصوص والألوان لتناسب علامتك التجارية.'
    : 'This poster was generated from your brief. Edit the text and colors to fit your brand.';

  const margin = Math.round(width * 0.08);
  const contentWidth = width - margin * 2;
  const headlineSize = Math.max(48, Math.min(110, Math.round(width / 11)));

  const doc: DesignDoc = {
    schemaVersion: 1,
    width,
    height,
    background: { kind: 'solid', color: '#0b1020' },
    layers: [
      {
        id: 'accent',
        name: 'Accent',
        type: 'shape',
        left: margin,
        top: Math.round(height * 0.09),
        width: contentWidth,
        height: 8,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        style: {
          fill: {
            kind: 'linear',
            angle: 90,
            stops: [
              { color: '#38bdf8', pos: 0 },
              { color: '#a78bfa', pos: 100 },
            ],
          },
          radius: 4,
        },
      },
      {
        id: 'headline',
        name: 'Headline',
        type: 'text',
        left: margin,
        top: Math.round(height * 0.14),
        width: contentWidth,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        dir,
        content: [{ kind: 'text', text: headline }],
        style: {
          fontFamily: font,
          fontSize: headlineSize,
          fontWeight: 700,
          italic: false,
          underline: false,
          color: '#ffffff',
          align: 'center',
          lineHeight: 1.25,
          letterSpacing: 0,
          textTransform: 'none',
        },
      },
      {
        id: 'body',
        name: 'Body',
        type: 'text',
        left: margin,
        top: Math.round(height * 0.42),
        width: contentWidth,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        dir,
        content: [{ kind: 'text', text: body }],
        style: {
          fontFamily: font,
          fontSize: Math.round(headlineSize * 0.38),
          fontWeight: 400,
          italic: false,
          underline: false,
          color: '#cbd5e1',
          align: 'center',
          lineHeight: 1.55,
          letterSpacing: 0,
          textTransform: 'none',
        },
      },
      {
        id: 'card',
        name: 'Card',
        type: 'shape',
        left: margin,
        top: Math.round(height * 0.62),
        width: contentWidth,
        height: Math.round(height * 0.2),
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        style: {
          fill: { kind: 'solid', color: '#111a33' },
          radius: 28,
          border: { width: 1, style: 'solid', color: '#1e293b' },
        },
      },
      {
        id: 'mark',
        name: 'Mark',
        type: 'svg',
        left: Math.round(width / 2 - 40),
        top: Math.round(height * 0.66),
        width: 80,
        height: 80,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        viewBox: '0 0 100 100',
        nodes: [
          {
            kind: 'element',
            tag: 'circle',
            attrs: { cx: '50', cy: '50', r: '44', fill: '#38bdf8' },
            children: [],
          },
          {
            kind: 'element',
            tag: 'path',
            attrs: {
              d: 'M28 52 L45 68 L74 34',
              fill: 'none',
              stroke: '#0b1020',
              'stroke-width': '8',
            },
            children: [],
          },
        ],
      },
      {
        id: 'footer',
        name: 'Footer',
        type: 'text',
        left: margin,
        top: height - Math.round(height * 0.1),
        width: contentWidth,
        rotation: 0,
        opacity: 0.7,
        hidden: false,
        locked: false,
        dir: 'ltr',
        content: [{ kind: 'text', text: 'AI POSTER EDITOR' }],
        style: {
          fontFamily: 'Inter',
          fontSize: 22,
          fontWeight: 500,
          italic: false,
          underline: false,
          color: '#94a3b8',
          align: 'center',
          lineHeight: 1.2,
          letterSpacing: 4,
          textTransform: 'uppercase',
        },
      },
    ],
  };

  const designHtml = serializeDesignDoc(doc);
  return {
    designHtml,
    warnings: [],
    usage: {
      model: 'local-template-v1',
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    },
  };
}
