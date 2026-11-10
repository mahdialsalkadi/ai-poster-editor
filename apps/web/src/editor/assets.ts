import { LIMITS } from '@poster/core';
import { readImageDimensions } from './image-header';

export type AssetEntry = {
  id: string;
  name: string;
  /** Object URL. Lives only for the current browser session. */
  url: string;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  createdAt: number;
};

export type AssetErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'TOO_LARGE'
  | 'TOO_MANY'
  | 'BAD_DIMENSIONS'
  | 'TOO_MANY_PIXELS'
  | 'DECODE_FAILED';

export class AssetError extends Error {
  override readonly name = 'AssetError';

  constructor(
    readonly code: AssetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const ALLOWED_MIME: ReadonlySet<string> = new Set(LIMITS.assets.allowedMimeTypes);

let counter = 0;

export function createAssetId(): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `img-${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
}

export function validateAssetFile(file: File, existingCount: number): AssetError | null {
  if (existingCount >= LIMITS.assets.maxPerDocument) {
    return new AssetError(
      'TOO_MANY',
      `يمكن إضافة ${LIMITS.assets.maxPerDocument} صور كحد أقصى لكل تصميم`,
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return new AssetError('UNSUPPORTED_TYPE', 'الصيغ المدعومة هي PNG وJPEG وWebP فقط');
  }
  if (file.size > LIMITS.assets.maxBytesPerAsset) {
    return new AssetError(
      'TOO_LARGE',
      `حجم الصورة يتجاوز ${Math.round(LIMITS.assets.maxBytesPerAsset / (1024 * 1024))} ميغابايت`,
    );
  }
  if (file.size === 0) {
    return new AssetError('DECODE_FAILED', 'الملف فارغ');
  }
  return null;
}

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => reject(new AssetError('DECODE_FAILED', 'تعذر قراءة الصورة'));
    image.src = url;
  });
}

/**
 * Validates a browser File and turns it into an in-memory asset. The returned
 * object URL must be revoked with `revokeAsset` when the asset is removed.
 */
export async function createAssetFromFile(
  file: File,
  existingCount: number,
  forcedId?: string,
): Promise<AssetEntry> {
  const error = validateAssetFile(file, existingCount);
  if (error) throw error;

  let headerSize: { width: number; height: number };
  try {
    headerSize = readImageDimensions(new Uint8Array(await file.arrayBuffer()), file.type);
  } catch {
    throw new AssetError('DECODE_FAILED', 'تعذر قراءة ترويسة الصورة');
  }
  if (
    headerSize.width > LIMITS.assets.maxDimension ||
    headerSize.height > LIMITS.assets.maxDimension
  ) {
    throw new AssetError(
      'BAD_DIMENSIONS',
      `أقصى بُعد مسموح للصورة هو ${LIMITS.assets.maxDimension} بكسل`,
    );
  }
  if (headerSize.width * headerSize.height > LIMITS.assets.maxPixelsPerAsset) {
    throw new AssetError('TOO_MANY_PIXELS', 'عدد بكسلات الصورة كبير جداً');
  }

  const url = URL.createObjectURL(file);
  try {
    const size = await loadImageSize(url);
    if (size.width <= 0 || size.height <= 0) {
      throw new AssetError('BAD_DIMENSIONS', 'أبعاد الصورة غير صالحة');
    }
    if (size.width > LIMITS.assets.maxDimension || size.height > LIMITS.assets.maxDimension) {
      throw new AssetError(
        'BAD_DIMENSIONS',
        `أقصى بُعد مسموح للصورة هو ${LIMITS.assets.maxDimension} بكسل`,
      );
    }
    if (size.width * size.height > LIMITS.assets.maxPixelsPerAsset) {
      throw new AssetError('TOO_MANY_PIXELS', 'عدد بكسلات الصورة كبير جداً');
    }

    return {
      id: forcedId ?? createAssetId(),
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'صورة',
      url,
      width: size.width,
      height: size.height,
      mime: file.type,
      bytes: file.size,
      createdAt: Date.now(),
    };
  } catch (cause) {
    URL.revokeObjectURL(url);
    if (cause instanceof AssetError) throw cause;
    throw new AssetError('DECODE_FAILED', 'تعذر فك ترميز الصورة');
  }
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

/**
 * Rebuilds an image the HTML importer found inlined in an exported document.
 * It goes through the same MIME, size and dimension checks as an upload.
 */
export async function createAssetFromBase64(
  base64: string,
  mimeType: string,
  id: string,
  existingCount: number,
): Promise<{ entry: AssetEntry; file: File }> {
  let bytes: ArrayBuffer;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    throw new AssetError('DECODE_FAILED', 'تعذر فك ترميز الصورة المستوردة');
  }
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const file = new File([bytes], `${id}.${extension}`, { type: mimeType });
  return { entry: await createAssetFromFile(file, existingCount, id), file };
}

export function revokeAsset(asset: AssetEntry): void {
  URL.revokeObjectURL(asset.url);
}

/** Scales an uploaded image down so it comfortably fits inside the artboard. */
export function fitAssetIntoArtboard(
  docWidth: number,
  docHeight: number,
  assetWidth: number,
  assetHeight: number,
): { width: number; height: number } {
  const maxWidth = docWidth * 0.62;
  const maxHeight = docHeight * 0.62;
  const ratio = Math.min(maxWidth / assetWidth, maxHeight / assetHeight, 1);
  return {
    width: Math.max(16, Math.round(assetWidth * ratio)),
    height: Math.max(16, Math.round(assetHeight * ratio)),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
