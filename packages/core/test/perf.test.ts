import { describe, expect, it } from 'vitest';
import {
  canonicalizeDoc,
  LIMITS,
  parseDesignHtml,
  serializeDesignDoc,
  type DesignDoc,
  type Layer,
} from '../src/index';

function buildDocument(): DesignDoc {
  const layers: Layer[] = [];
  for (let index = 0; index < 200; index += 1) {
    const base = {
      id: `layer${index}`,
      name: `Layer ${index}`,
      left: (index % 20) * 50,
      top: Math.floor(index / 20) * 120,
      width: 220,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
    };
    if (index % 2 === 0) {
      layers.push({
        ...base,
        type: 'text',
        dir: 'rtl',
        content: [{ kind: 'text', text: `عنوان تجريبي رقم ${index} مع نص إضافي للقياس` }],
        style: {
          fontFamily: 'Cairo',
          fontSize: 32,
          fontWeight: 700,
          italic: false,
          underline: false,
          color: '#ffffff',
          align: 'right',
          lineHeight: 1.2,
          letterSpacing: 0,
          textTransform: 'none',
        },
      });
    } else {
      layers.push({
        ...base,
        type: 'shape',
        height: 90,
        style: {
          fill: {
            kind: 'linear',
            angle: 135,
            stops: [
              { color: '#1e293b', pos: 0 },
              { color: '#0f172a', pos: 100 },
            ],
          },
          radius: 12,
          border: { width: 2, style: 'solid', color: '#38bdf8' },
          shadow: { x: 0, y: 8, blur: 24, spread: 0, color: '#00000080' },
        },
      });
    }
  }
  return canonicalizeDoc({
    schemaVersion: 1,
    width: 1080,
    height: 1350,
    background: { kind: 'solid', color: '#0f172a' },
    layers,
  });
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

describe('parse performance at the document limit', () => {
  it('keeps p95 below 200 ms for 200 layers and exactly 200 KiB of real content', () => {
    const doc = buildDocument();
    const encode = (value: string) => new TextEncoder().encode(value).byteLength;
    const texts = doc.layers.filter((layer) => layer.type === 'text');
    const padding = LIMITS.document.maxBytes - encode(serializeDesignDoc(doc));
    texts.forEach((layer, index) => {
      layer.content.push({
        kind: 'text',
        text: 'x'.repeat(
          Math.floor(padding / texts.length) + (index < padding % texts.length ? 1 : 0),
        ),
      });
    });
    const html = serializeDesignDoc(doc);
    expect(encode(html)).toBe(LIMITS.document.maxBytes);
    // Warm up separately so module/JIT startup is not the steady-state budget.
    for (let index = 0; index < 5; index++) parseDesignHtml(html);

    const runs = 50;
    const timings: number[] = [];
    for (let index = 0; index < runs; index += 1) {
      const started = performance.now();
      const parsed = parseDesignHtml(html);
      timings.push(performance.now() - started);
      expect(parsed.doc.layers).toHaveLength(200);
    }

    const sorted = timings.slice().sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);

    console.log(
      `[perf] parseDesignHtml 200 layers / ${(encode(html) / 1024).toFixed(1)} KiB: ` +
        `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms min=${(sorted[0] ?? 0).toFixed(2)}ms max=${(sorted[sorted.length - 1] ?? 0).toFixed(2)}ms`,
    );

    expect(p95).toBeLessThan(200);
  });
});
