import type { DesignDoc, ShapeLayer, SvgLayer, TextLayer } from '@poster/core';

const base = {
  rotation: 0,
  opacity: 1,
  hidden: false,
  locked: false,
} as const;

function textLayer(
  id: string,
  name: string,
  content: TextLayer['content'],
  style: Partial<TextLayer['style']> & Pick<TextLayer['style'], 'fontFamily' | 'fontSize'>,
  geometry: Pick<TextLayer, 'left' | 'top' | 'width'>,
  dir: 'ltr' | 'rtl',
): TextLayer {
  return {
    ...base,
    ...geometry,
    id,
    name,
    type: 'text',
    dir,
    content,
    style: {
      fontWeight: 400,
      italic: false,
      underline: false,
      color: '#ffffff',
      align: 'left',
      lineHeight: 1.3,
      letterSpacing: 0,
      textTransform: 'none',
      ...style,
    },
  };
}

function shapeLayer(
  id: string,
  name: string,
  geometry: Pick<ShapeLayer, 'left' | 'top' | 'width' | 'height'>,
  style: ShapeLayer['style'],
): ShapeLayer {
  return {
    ...base,
    ...geometry,
    id,
    name,
    type: 'shape',
    style,
  };
}

function markLayer(): SvgLayer {
  return {
    ...base,
    id: 'mark',
    name: 'Mark',
    type: 'svg',
    left: 470,
    top: 1010,
    width: 140,
    height: 140,
    viewBox: '0 0 100 100',
    nodes: [
      {
        kind: 'element',
        tag: 'circle',
        attrs: { cx: '50', cy: '50', r: '46', fill: '#38bdf8' },
        children: [],
      },
      {
        kind: 'element',
        tag: 'path',
        attrs: {
          d: 'M50 18 L58 42 L84 42 L63 57 L71 82 L50 67 L29 82 L37 57 L16 42 L42 42 Z',
          fill: '#0b1020',
        },
        children: [],
      },
    ],
  };
}

export function createMidnightDoc(): DesignDoc {
  return {
    schemaVersion: 1,
    width: 1080,
    height: 1350,
    background: { kind: 'solid', color: '#0b1020' },
    layers: [
      shapeLayer(
        'accent',
        'Accent',
        { left: 80, top: 120, width: 920, height: 8 },
        {
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
      ),
      textLayer(
        'headline',
        'Headline',
        [{ kind: 'text', text: 'معرض الفنون' }, { kind: 'br' }, { kind: 'text', text: 'الحديثة' }],
        {
          fontFamily: 'Cairo',
          fontSize: 118,
          fontWeight: 700,
          color: '#ffffff',
          align: 'center',
          lineHeight: 1.12,
        },
        { left: 80, top: 190, width: 920 },
        'rtl',
      ),
      textLayer(
        'subhead',
        'Subheading',
        [{ kind: 'text', text: 'الرياض · ١٢–٢٠ نوفمبر' }],
        {
          fontFamily: 'Tajawal',
          fontSize: 34,
          fontWeight: 500,
          color: '#93c5fd',
          align: 'center',
          letterSpacing: 0,
        },
        { left: 80, top: 520, width: 920 },
        'rtl',
      ),
      shapeLayer(
        'card',
        'Card',
        { left: 80, top: 640, width: 920, height: 300 },
        {
          fill: { kind: 'solid', color: '#111a33' },
          radius: 32,
          border: { width: 1, style: 'solid', color: '#1e293b' },
          shadow: { x: 0, y: 24, blur: 48, color: '#00000066' },
        },
      ),
      textLayer(
        'body',
        'Body',
        [
          {
            kind: 'text',
            text: 'تجربة بصرية تحتفي بالفنون المعاصرة، تجمع أعمالاً مختارة من فنانين عرب في فضاء واحد.',
          },
        ],
        {
          fontFamily: 'IBM Plex Sans Arabic',
          fontSize: 36,
          color: '#cbd5e1',
          align: 'center',
          lineHeight: 1.7,
        },
        { left: 130, top: 700, width: 820 },
        'rtl',
      ),
      markLayer(),
      textLayer(
        'footer',
        'Footer',
        [{ kind: 'text', text: 'ART RIYADH · 2026' }],
        {
          fontFamily: 'Inter',
          fontSize: 22,
          fontWeight: 500,
          color: '#64748b',
          align: 'center',
          letterSpacing: 5,
          textTransform: 'uppercase',
        },
        { left: 80, top: 1200, width: 920 },
        'ltr',
      ),
    ],
  };
}

export function createPaperDoc(): DesignDoc {
  return {
    schemaVersion: 1,
    width: 1080,
    height: 1350,
    background: { kind: 'solid', color: '#f8f5ef' },
    layers: [
      shapeLayer(
        'sun',
        'Sun',
        { left: -180, top: -160, width: 760, height: 760 },
        { fill: { kind: 'solid', color: '#fb923c' }, radius: 380 },
      ),
      textLayer(
        'headline',
        'Headline',
        [{ kind: 'text', text: 'Design' }, { kind: 'br' }, { kind: 'text', text: 'with intent.' }],
        {
          fontFamily: 'Playfair Display',
          fontSize: 112,
          fontWeight: 700,
          color: '#1c1917',
          align: 'left',
          lineHeight: 1.05,
        },
        { left: 90, top: 700, width: 900 },
        'ltr',
      ),
      textLayer(
        'body',
        'Body',
        [
          {
            kind: 'text',
            text: 'A small studio for posters, identities, and printed matter. Made slowly, on purpose.',
          },
        ],
        {
          fontFamily: 'Poppins',
          fontSize: 30,
          color: '#57534e',
          align: 'left',
          lineHeight: 1.6,
        },
        { left: 90, top: 1010, width: 720 },
        'ltr',
      ),
      shapeLayer(
        'rule',
        'Rule',
        { left: 90, top: 1180, width: 180, height: 4 },
        { fill: { kind: 'solid', color: '#1c1917' }, radius: 2 },
      ),
      textLayer(
        'footer',
        'Footer',
        [{ kind: 'text', text: 'PAPER STUDIO · EST. 2024' }],
        {
          fontFamily: 'Inter',
          fontSize: 20,
          fontWeight: 500,
          color: '#78716c',
          align: 'left',
          letterSpacing: 3,
          textTransform: 'uppercase',
        },
        { left: 90, top: 1220, width: 720 },
        'ltr',
      ),
    ],
  };
}

export function createCoffeeDoc(): DesignDoc {
  return {
    schemaVersion: 1,
    width: 1080,
    height: 1350,
    background: { kind: 'solid', color: '#f5ebe0' },
    layers: [
      shapeLayer(
        'sun',
        'Sun',
        { left: -170, top: -210, width: 620, height: 620 },
        { fill: { kind: 'solid', color: '#c2410c' }, radius: 310 },
      ),
      shapeLayer(
        'band',
        'Band',
        { left: 0, top: 1110, width: 1080, height: 240 },
        {
          fill: {
            kind: 'linear',
            angle: 90,
            stops: [
              { color: '#7c2d12', pos: 0 },
              { color: '#c2410c', pos: 100 },
            ],
          },
          radius: 0,
        },
      ),
      textLayer(
        'headline',
        'Headline',
        [{ kind: 'text', text: 'قهوة الصباح' }],
        {
          fontFamily: 'Cairo',
          fontSize: 96,
          fontWeight: 700,
          color: '#3f2a1d',
          align: 'right',
          lineHeight: 1.2,
        },
        { left: 90, top: 470, width: 900 },
        'rtl',
      ),
      textLayer(
        'subhead',
        'Subheading',
        [{ kind: 'text', text: 'تحميص يومي · الرياض' }],
        {
          fontFamily: 'Tajawal',
          fontSize: 36,
          fontWeight: 500,
          color: '#7c2d12',
          align: 'right',
          letterSpacing: 0,
        },
        { left: 90, top: 620, width: 900 },
        'rtl',
      ),
      textLayer(
        'body',
        'Body',
        [{ kind: 'text', text: 'حبوب مختارة، تحميص بطيء، وفنجان يبدأ به اليوم.' }],
        {
          fontFamily: 'IBM Plex Sans Arabic',
          fontSize: 32,
          color: '#5b4636',
          align: 'right',
          lineHeight: 1.8,
        },
        { left: 90, top: 720, width: 800 },
        'rtl',
      ),
      textLayer(
        'footer',
        'Footer',
        [{ kind: 'text', text: 'ROASTED DAILY · 2026' }],
        {
          fontFamily: 'Inter',
          fontSize: 20,
          fontWeight: 500,
          color: '#f5ebe0',
          align: 'center',
          letterSpacing: 4,
          textTransform: 'uppercase',
        },
        { left: 90, top: 1200, width: 900 },
        'ltr',
      ),
    ],
  };
}

export function createNeonDoc(): DesignDoc {
  return {
    schemaVersion: 1,
    width: 1080,
    height: 1350,
    background: { kind: 'solid', color: '#070a14' },
    layers: [
      shapeLayer(
        'glow',
        'Glow',
        { left: 70, top: 760, width: 940, height: 400 },
        {
          fill: {
            kind: 'linear',
            angle: 135,
            stops: [
              { color: '#312e81', pos: 0 },
              { color: '#0ea5e9', pos: 100 },
            ],
          },
          radius: 48,
        },
      ),
      textLayer(
        'kicker',
        'Kicker',
        [{ kind: 'text', text: 'ART DISTRICT PRESENTS' }],
        {
          fontFamily: 'Inter',
          fontSize: 22,
          fontWeight: 500,
          color: '#38bdf8',
          align: 'left',
          letterSpacing: 6,
          textTransform: 'uppercase',
        },
        { left: 80, top: 140, width: 920 },
        'ltr',
      ),
      textLayer(
        'title',
        'Title',
        [{ kind: 'text', text: 'NIGHT' }],
        {
          fontFamily: 'Bebas Neue',
          fontSize: 260,
          color: '#f8fafc',
          align: 'left',
          lineHeight: 0.95,
        },
        { left: 80, top: 220, width: 920 },
        'ltr',
      ),
      textLayer(
        'arabic',
        'Arabic title',
        [{ kind: 'text', text: 'ليلة الموسيقى' }],
        {
          fontFamily: 'Cairo',
          fontSize: 58,
          fontWeight: 700,
          color: '#38bdf8',
          align: 'right',
        },
        { left: 80, top: 520, width: 920 },
        'rtl',
      ),
      textLayer(
        'date',
        'Date',
        [{ kind: 'text', text: 'الرياض · ٢٠٢٦' }],
        {
          fontFamily: 'Tajawal',
          fontSize: 32,
          color: '#94a3b8',
          align: 'right',
        },
        { left: 80, top: 610, width: 920 },
        'rtl',
      ),
      textLayer(
        'body',
        'Body',
        [{ kind: 'text', text: 'تجربة صوتية وبصرية من الغروب إلى الفجر.' }],
        {
          fontFamily: 'IBM Plex Sans Arabic',
          fontSize: 30,
          color: '#e2e8f0',
          align: 'center',
          lineHeight: 1.7,
        },
        { left: 140, top: 880, width: 800 },
        'rtl',
      ),
      textLayer(
        'footer',
        'Footer',
        [{ kind: 'text', text: 'DOORS 20:00 · 2026' }],
        {
          fontFamily: 'Inter',
          fontSize: 20,
          fontWeight: 500,
          color: '#64748b',
          align: 'center',
          letterSpacing: 3,
          textTransform: 'uppercase',
        },
        { left: 80, top: 1220, width: 920 },
        'ltr',
      ),
    ],
  };
}

export function createBlankDoc(): DesignDoc {
  return {
    schemaVersion: 1,
    width: 1080,
    height: 1350,
    background: { kind: 'solid', color: '#ffffff' },
    layers: [],
  };
}

export function createSummitDoc(): DesignDoc {
  return {
    schemaVersion: 1,
    width: 1080,
    height: 1350,
    background: { kind: 'solid', color: '#f3f0e8' },
    layers: [
      shapeLayer(
        'panel',
        'Cobalt panel',
        { left: 80, top: 80, width: 920, height: 760 },
        { fill: { kind: 'solid', color: '#253fce' }, radius: 24 },
      ),
      textLayer(
        'kicker',
        'Series',
        [{ kind: 'text', text: 'IDEAS WORTH BUILDING' }],
        { fontFamily: 'Inter', fontSize: 24, fontWeight: 700, letterSpacing: 3 },
        { left: 130, top: 140, width: 820 },
        'ltr',
      ),
      textLayer(
        'headline',
        'Headline',
        [{ kind: 'text', text: 'Design' }, { kind: 'br' }, { kind: 'text', text: 'tomorrow.' }],
        { fontFamily: 'Poppins', fontSize: 112, fontWeight: 700, lineHeight: 1.05 },
        { left: 130, top: 290, width: 820 },
        'ltr',
      ),
      shapeLayer(
        'line',
        'Lime accent',
        { left: 130, top: 650, width: 180, height: 12 },
        { fill: { kind: 'solid', color: '#d9f577' }, radius: 6 },
      ),
      textLayer(
        'date',
        'Date',
        [{ kind: 'text', text: 'NOV 21 — 22 / 2026' }],
        { fontFamily: 'Inter', fontSize: 30, fontWeight: 700, color: '#202020' },
        { left: 80, top: 910, width: 920 },
        'ltr',
      ),
      textLayer(
        'body',
        'Description',
        [
          { kind: 'text', text: 'Two days of talks, practical workshops' },
          { kind: 'br' },
          { kind: 'text', text: 'and conversations about better design.' },
        ],
        { fontFamily: 'Inter', fontSize: 32, lineHeight: 1.5, color: '#303030' },
        { left: 80, top: 1000, width: 920 },
        'ltr',
      ),
      textLayer(
        'footer',
        'Venue',
        [{ kind: 'text', text: 'THE DESIGN SUMMIT · STUDIO HALL' }],
        { fontFamily: 'Inter', fontSize: 22, fontWeight: 700, color: '#253fce', letterSpacing: 2 },
        { left: 80, top: 1210, width: 920 },
        'ltr',
      ),
    ],
  };
}

export function createNatureDoc(): DesignDoc {
  return {
    schemaVersion: 1,
    width: 1080,
    height: 1350,
    background: { kind: 'solid', color: '#102e25' },
    layers: [
      shapeLayer(
        'sun',
        'Sun',
        { left: 650, top: 100, width: 300, height: 300 },
        { fill: { kind: 'solid', color: '#f3c96a' }, radius: 150 },
      ),
      shapeLayer(
        'hill',
        'Green horizon',
        { left: 80, top: 860, width: 920, height: 380 },
        {
          fill: {
            kind: 'linear',
            angle: 135,
            stops: [
              { color: '#416e50', pos: 0 },
              { color: '#254f3b', pos: 100 },
            ],
          },
          radius: 40,
        },
      ),
      textLayer(
        'kicker',
        'Invitation',
        [{ kind: 'text', text: 'A WEEKEND OUTSIDE' }],
        { fontFamily: 'Inter', fontSize: 24, fontWeight: 700, letterSpacing: 3, color: '#f3c96a' },
        { left: 80, top: 140, width: 540 },
        'ltr',
      ),
      textLayer(
        'headline',
        'Headline',
        [
          { kind: 'text', text: 'Make room' },
          { kind: 'br' },
          { kind: 'text', text: 'for nature.' },
        ],
        {
          fontFamily: 'Playfair Display',
          fontSize: 108,
          fontWeight: 700,
          lineHeight: 1.15,
          color: '#faf4e3',
        },
        { left: 80, top: 420, width: 920 },
        'ltr',
      ),
      textLayer(
        'body',
        'Description',
        [
          { kind: 'text', text: 'Walk the trails. Restore a habitat.' },
          { kind: 'br' },
          { kind: 'text', text: 'Meet your local conservation community.' },
        ],
        { fontFamily: 'Inter', fontSize: 30, lineHeight: 1.6, color: '#faf4e3' },
        { left: 80, top: 720, width: 920 },
        'ltr',
      ),
      textLayer(
        'date',
        'Date',
        [{ kind: 'text', text: 'SATURDAY / 28 NOVEMBER' }],
        { fontFamily: 'Inter', fontSize: 30, fontWeight: 700, color: '#ffffff' },
        { left: 130, top: 970, width: 820 },
        'ltr',
      ),
      textLayer(
        'footer',
        'Meeting point',
        [
          { kind: 'text', text: '09:00 · RIVERSIDE PARK' },
          { kind: 'br' },
          { kind: 'text', text: 'All welcome. Bring water and sturdy shoes.' },
        ],
        { fontFamily: 'Inter', fontSize: 26, lineHeight: 1.6, color: '#ffffff' },
        { left: 130, top: 1060, width: 820 },
        'ltr',
      ),
    ],
  };
}

export const TEMPLATES = [
  { id: 'midnight', name: 'Midnight Gallery', language: 'ar', doc: createMidnightDoc() },
  { id: 'paper', name: 'Paper Studio', language: 'en', doc: createPaperDoc() },
  { id: 'coffee', name: 'Coffee Mornings', language: 'ar', doc: createCoffeeDoc() },
  { id: 'neon', name: 'Neon Night', language: 'mixed', doc: createNeonDoc() },
  { id: 'summit', name: 'Design Summit', language: 'en', doc: createSummitDoc() },
  { id: 'nature', name: 'Make Room for Nature', language: 'en', doc: createNatureDoc() },
  { id: 'blank', name: 'Blank poster', language: 'none', doc: createBlankDoc() },
] as const;
