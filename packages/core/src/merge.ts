import { canonicalizeDoc } from './canonicalize.js';
import type { DesignDoc, Layer, Warning } from './model.js';
import { pushWarning } from './warnings.js';

export type MergeOptions = {
  /**
   * When provided, only these layer ids may be updated by the patch. Layers
   * outside the selection are preserved and produce a warning.
   */
  selectedLayerIds?: readonly string[];
  /** New layers are appended only when explicitly allowed. Default: false. */
  allowNewLayers?: boolean;
  /** Artboard size/background changes are ignored unless explicitly allowed. */
  allowArtboardChanges?: boolean;
};

export type MergeOutput = {
  doc: DesignDoc;
  warnings: Warning[];
};

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Three-way merge of an AI-produced patch document into the current document.
 *
 * The patch is treated as a set of updates, not as a full replacement:
 * - layers missing from the patch are preserved;
 * - existing layers are replaced in place, keeping z-order;
 * - new layers are appended only when allowed;
 * - artboard changes are ignored by default.
 *
 * Both inputs are canonicalized first, so a merge is deterministic and cannot
 * smuggle in non-canonical values.
 */
export function mergeDesignDoc(
  baseInput: DesignDoc,
  patchInput: DesignDoc,
  options: MergeOptions = {},
): MergeOutput {
  const base = canonicalizeDoc(baseInput);
  const patch = canonicalizeDoc(patchInput);
  const warnings: Warning[] = [];
  const selected = options.selectedLayerIds ? new Set(options.selectedLayerIds) : null;

  if (
    !options.allowArtboardChanges &&
    (base.width !== patch.width ||
      base.height !== patch.height ||
      !sameValue(base.background, patch.background))
  ) {
    pushWarning(
      warnings,
      'MERGE_ARTBOARD_CHANGE_IGNORED',
      'Artboard size and background cannot be changed by an AI patch',
      'artboard',
    );
  }

  const patchById = new Map<string, Layer>();
  for (const layer of patch.layers) {
    if (patchById.has(layer.id)) {
      pushWarning(
        warnings,
        'MERGE_DUPLICATE_ID',
        `Duplicate layer id in patch: ${layer.id}; the first occurrence wins`,
        `layers.${layer.id}`,
        layer.id,
      );
      continue;
    }
    patchById.set(layer.id, layer);
  }

  const baseIndex = new Map<string, number>();
  base.layers.forEach((layer, index) => baseIndex.set(layer.id, index));

  const merged: Layer[] = base.layers.slice();
  const appended: Layer[] = [];

  for (const [id, patchLayer] of patchById) {
    const index = baseIndex.get(id);
    if (index === undefined) {
      if (options.allowNewLayers) {
        appended.push(patchLayer);
        pushWarning(
          warnings,
          'MERGE_NEW_LAYER',
          `New layer added by patch: ${id}`,
          `layers.${id}`,
          id,
        );
      } else {
        pushWarning(
          warnings,
          'MERGE_IGNORED_UNSELECTED',
          `New layer is not allowed by this patch: ${id}`,
          `layers.${id}`,
          id,
        );
      }
      continue;
    }

    if (selected && !selected.has(id)) {
      pushWarning(
        warnings,
        'MERGE_IGNORED_UNSELECTED',
        `Layer ${id} is outside the current selection and was not updated`,
        `layers.${id}`,
        id,
      );
      continue;
    }

    const existing = merged[index];
    if (!existing) continue;
    if (existing.type !== patchLayer.type) {
      pushWarning(
        warnings,
        'MERGE_TYPE_CHANGE_IGNORED',
        `Layer ${id} cannot change type from ${existing.type} to ${patchLayer.type}`,
        `layers.${id}`,
        id,
      );
      continue;
    }
    merged[index] = patchLayer;
  }

  const doc = canonicalizeDoc({
    ...base,
    ...(options.allowArtboardChanges
      ? { width: patch.width, height: patch.height, background: patch.background }
      : {}),
    layers: [...merged, ...appended],
  });

  return { doc, warnings };
}
