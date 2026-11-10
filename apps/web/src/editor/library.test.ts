import { describe, expect, it } from 'vitest';
import { createBlankDoc } from '../sample.js';
import {
  ELEMENT_KINDS,
  TEXT_PRESETS,
  createElementLayer,
  createTextPreset,
  estimatedLayerHeight,
} from './layers.js';

describe('element and text library', () => {
  it('exposes 26 unique elements and 6 unique text presets', () => {
    expect(ELEMENT_KINDS).toHaveLength(26);
    expect(new Set(ELEMENT_KINDS).size).toBe(26);
    expect(TEXT_PRESETS).toHaveLength(6);
    expect(new Set(TEXT_PRESETS.map((preset) => preset.id)).size).toBe(6);
  });

  it('creates a valid, uniquely identified layer for every element', () => {
    let doc = createBlankDoc();
    const ids = new Set<string>();
    for (const kind of ELEMENT_KINDS) {
      const layer = createElementLayer(doc, kind);
      expect(layer.id.startsWith(`el-${kind}`)).toBe(true);
      expect(ids.has(layer.id)).toBe(false);
      ids.add(layer.id);
      expect(layer.width).toBeGreaterThan(0);
      expect(estimatedLayerHeight(layer)).toBeGreaterThan(0);
      if (layer.type === 'svg') expect(layer.nodes.length).toBeGreaterThan(0);
      doc = { ...doc, layers: [...doc.layers, layer] };
    }
  });

  it('creates a valid text layer for every preset', () => {
    const doc = createBlankDoc();
    for (const preset of TEXT_PRESETS) {
      const layer = createTextPreset(doc, preset);
      expect(layer.type).toBe('text');
      expect(layer.style.fontSize).toBe(preset.fontSize);
      expect(layer.content.length).toBeGreaterThan(0);
    }
  });
});
