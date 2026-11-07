import { DesignError, LIMITS } from '@poster/core';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export type PreparedAsset = {
  id: string;
  mime: 'image/png';
  width: number;
  height: number;
  bytes: Buffer;
  dataUri: string;
};

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Never trusts the declared MIME type: sniffs the real bytes, decodes with
 * sharp, checks the limits and re-encodes to PNG. Only the re-encoded buffer
 * reaches the renderer (contract §12.1).
 */
export async function prepareAsset(id: string, input: Buffer): Promise<PreparedAsset> {
  if (input.byteLength === 0) {
    throw new DesignError('INVALID_DOC', `Asset ${id} is empty`, `assets.${id}`);
  }
  if (input.byteLength > LIMITS.assets.maxBytesPerAsset) {
    throw new DesignError('LIMIT_EXCEEDED', `Asset ${id} is too large`, `assets.${id}`);
  }

  const detected = await fileTypeFromBuffer(input);
  if (!detected || !ALLOWED.has(detected.mime)) {
    throw new DesignError(
      'INVALID_DOC',
      `Asset ${id} is not a PNG, JPEG or WebP image`,
      `assets.${id}`,
    );
  }

  try {
    const { data, info } = await sharp(input, {
      failOn: 'error',
      limitInputPixels: LIMITS.assets.maxPixelsPerAsset,
    })
      .rotate()
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });

    if (info.width > LIMITS.assets.maxDimension || info.height > LIMITS.assets.maxDimension) {
      throw new DesignError(
        'LIMIT_EXCEEDED',
        `Asset ${id} exceeds ${LIMITS.assets.maxDimension}px on a side`,
        `assets.${id}`,
      );
    }
    if (info.width * info.height > LIMITS.assets.maxPixelsPerAsset) {
      throw new DesignError(
        'LIMIT_EXCEEDED',
        `Asset ${id} exceeds the pixel limit`,
        `assets.${id}`,
      );
    }

    return {
      id,
      mime: 'image/png',
      width: info.width,
      height: info.height,
      bytes: data,
      dataUri: `data:image/png;base64,${data.toString('base64')}`,
    };
  } catch (cause) {
    if (cause instanceof DesignError) throw cause;
    throw new DesignError('INVALID_DOC', `Asset ${id} could not be decoded`, `assets.${id}`);
  }
}

/** Image layers reference `asset:<id>`; anything else is not an upload. */
export function referencedAssetIds(doc: {
  layers: readonly { type: string; src?: string | undefined; hidden: boolean }[];
}): string[] {
  const ids = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.type !== 'image' || layer.hidden || !layer.src) continue;
    if (layer.src.startsWith('asset:')) ids.add(layer.src.slice('asset:'.length));
  }
  return [...ids];
}
