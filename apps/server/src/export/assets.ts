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

type InspectedAsset = { id: string; input: Buffer; width: number; height: number };

/** Read headers only. No raster is decoded until all document headers pass. */
async function inspectAsset(id: string, input: Buffer): Promise<InspectedAsset> {
  if (input.byteLength === 0) {
    throw new DesignError('INVALID_DOC', `Asset ${id} is empty`, `assets.${id}`);
  }
  if (input.byteLength > LIMITS.assets.maxBytesPerAsset) {
    throw new DesignError('LIMIT_EXCEEDED', `Asset ${id} is too large`, `assets.${id}`);
  }

  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(input);
  } catch {
    throw new DesignError('INVALID_DOC', `Asset ${id} has truncated image headers`, `assets.${id}`);
  }
  if (!detected || !ALLOWED.has(detected.mime)) {
    throw new DesignError(
      'INVALID_DOC',
      `Asset ${id} is not a PNG, JPEG or WebP image`,
      `assets.${id}`,
    );
  }

  try {
    const info = await sharp(input, { failOn: 'error', limitInputPixels: false }).metadata();
    if (`image/${info.format}` !== detected.mime)
      throw new DesignError(
        'INVALID_DOC',
        `Asset ${id} has inconsistent image headers`,
        `assets.${id}`,
      );
    if (!info.width || !info.height || (info.pages ?? 1) !== 1) {
      throw new DesignError(
        'INVALID_DOC',
        `Asset ${id} must be a single-frame image`,
        `assets.${id}`,
      );
    }
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

    return { id, input, width: info.width, height: info.height };
  } catch (cause) {
    if (cause instanceof DesignError) throw cause;
    throw new DesignError('INVALID_DOC', `Asset ${id} has invalid image headers`, `assets.${id}`);
  }
}

async function decodeAsset(asset: InspectedAsset): Promise<PreparedAsset> {
  const { id, input } = asset;
  try {
    const { data, info } = await sharp(input, {
      failOn: 'error',
      limitInputPixels: LIMITS.assets.maxPixelsPerAsset,
    })
      .rotate()
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
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

/** Sniff, preflight every header/budget, then strip metadata/trailing payloads. */
export async function prepareAssets(
  uploaded: ReadonlyMap<string, Buffer>,
): Promise<Map<string, PreparedAsset>> {
  if (uploaded.size > LIMITS.assets.maxPerDocument)
    throw new DesignError('LIMIT_EXCEEDED', 'Too many image assets', 'assets');
  const inspected: InspectedAsset[] = [];
  let pixels = 0;
  for (const [id, bytes] of uploaded) {
    const asset = await inspectAsset(id, bytes);
    pixels += asset.width * asset.height;
    if (pixels > LIMITS.assets.maxTotalPixels)
      throw new DesignError('LIMIT_EXCEEDED', 'The images exceed the total pixel budget', 'assets');
    inspected.push(asset);
  }
  const prepared = new Map<string, PreparedAsset>();
  for (const asset of inspected) prepared.set(asset.id, await decodeAsset(asset));
  return prepared;
}

export async function prepareAsset(id: string, input: Buffer): Promise<PreparedAsset> {
  return (await prepareAssets(new Map([[id, input]]))).get(id)!;
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
