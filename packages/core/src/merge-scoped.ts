import { canonicalizeDoc } from './canonicalize.js';
import type { DesignDoc, Layer, Warning } from './model.js';
import { parseDesignHtml } from './parse.js';
import { pushWarning } from './warnings.js';

export type ScopedMergeOutput = {
  doc: DesignDoc;
  warnings: Warning[];
};

/**
 * Merges a selection-scoped AI edit into the current document.
 *
 * Contract (spec 4.2.4):
 * - the AI output is full Design HTML and is parsed before merging;
 * - unselected layers keep their content, position and z-order;
 * - a returned layer that matches a selected id replaces it in place;
 * - a selected layer that is missing from the output is kept, never deleted;
 * - an unknown id becomes a new layer placed directly above the highest
 *   selected layer; duplicate patch ids are rejected by the parser;
 * - the artboard size and background can never change.
 */
export function mergeScopedEdit(
  baseInput: DesignDoc,
  aiOutputHtml: string,
  selectedLayerIds: readonly string[],
): ScopedMergeOutput {
  const base = canonicalizeDoc(baseInput);
  const parsed = parseDesignHtml(aiOutputHtml);
  const warnings: Warning[] = [...parsed.warnings];
  const selected = new Set(selectedLayerIds);

  if (parsed.doc.width !== base.width || parsed.doc.height !== base.height) {
    pushWarning(
      warnings,
      'MERGE_ARTBOARD_CHANGE_IGNORED',
      'A scoped edit cannot change the artboard size',
      'artboard',
    );
  }

  const layers = base.layers.slice();
  const indexById = new Map<string, number>();
  layers.forEach((layer, index) => indexById.set(layer.id, index));

  const selectedIndexes = layers
    .map((layer, index) => (selected.has(layer.id) ? index : -1))
    .filter((index) => index >= 0);
  const insertAt = selectedIndexes.length > 0 ? Math.max(...selectedIndexes) + 1 : layers.length;

  const additions: Layer[] = [];

  for (const patchLayer of parsed.doc.layers) {
    const index = indexById.get(patchLayer.id);

    if (index === undefined) {
      const id = patchLayer.id;
      additions.push({ ...patchLayer, id });
      pushWarning(warnings, 'MERGE_NEW_LAYER', `Scoped edit added layer ${id}`, `layers.${id}`, id);
      continue;
    }

    if (!selected.has(patchLayer.id)) {
      pushWarning(
        warnings,
        'MERGE_IGNORED_UNSELECTED',
        `Layer ${patchLayer.id} is outside the current selection and was not updated`,
        `layers.${patchLayer.id}`,
        patchLayer.id,
      );
      continue;
    }

    const existing = layers[index];
    if (!existing) continue;
    if (existing.type !== patchLayer.type) {
      pushWarning(
        warnings,
        'MERGE_TYPE_CHANGE_IGNORED',
        `Layer ${patchLayer.id} cannot change type from ${existing.type} to ${patchLayer.type}`,
        `layers.${patchLayer.id}`,
        patchLayer.id,
      );
      continue;
    }
    layers[index] = patchLayer;
  }

  const merged = [...layers.slice(0, insertAt), ...additions, ...layers.slice(insertAt)];

  return {
    doc: canonicalizeDoc({ ...base, layers: merged }),
    warnings,
  };
}
