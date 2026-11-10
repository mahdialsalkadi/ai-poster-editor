export type ImageDimensions = { width: number; height: number };

const signature = (bytes: Uint8Array, offset: number, value: string): boolean =>
  [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

function invalid(): never {
  throw new Error('Invalid or unsupported image header');
}

function dimensions(width: number, height: number): ImageDimensions {
  if (width <= 0 || height <= 0) return invalid();
  return { width, height };
}

function png(bytes: Uint8Array, view: DataView): ImageDimensions {
  if (
    bytes.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
    view.getUint32(8) !== 13 ||
    !signature(bytes, 12, 'IHDR')
  )
    return invalid();
  return dimensions(view.getUint32(16), view.getUint32(20));
}

function jpeg(bytes: Uint8Array, view: DataView): ImageDimensions {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return invalid();
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return invalid();
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return invalid();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return invalid();
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return invalid();
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (length < 8) return invalid();
      return dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
    }
    offset += length;
  }
  return invalid();
}

function u24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function webp(bytes: Uint8Array, view: DataView): ImageDimensions {
  if (bytes.length < 20 || !signature(bytes, 0, 'RIFF') || !signature(bytes, 8, 'WEBP'))
    return invalid();
  const end = view.getUint32(4, true) + 8;
  if (end > bytes.length || end < 20) return invalid();
  let canvas: ImageDimensions | undefined;
  let image: ImageDimensions | undefined;
  for (let offset = 12; offset + 8 <= end;) {
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const next = start + length + (length % 2);
    if (next > end) return invalid();
    if (signature(bytes, offset, 'VP8X')) {
      if (length !== 10 || canvas || (bytes[start]! & 0x02) !== 0) return invalid();
      canvas = dimensions(u24(bytes, start + 4) + 1, u24(bytes, start + 7) + 1);
    } else if (signature(bytes, offset, 'VP8 ')) {
      if (
        image ||
        length < 10 ||
        (bytes[start]! & 1) !== 0 ||
        bytes[start + 3] !== 0x9d ||
        bytes[start + 4] !== 0x01 ||
        bytes[start + 5] !== 0x2a
      )
        return invalid();
      image = dimensions(
        view.getUint16(start + 6, true) & 0x3fff,
        view.getUint16(start + 8, true) & 0x3fff,
      );
    } else if (signature(bytes, offset, 'VP8L')) {
      if (image || length < 5 || bytes[start] !== 0x2f) return invalid();
      const bits = view.getUint32(start + 1, true);
      image = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    } else if (signature(bytes, offset, 'ANIM') || signature(bytes, offset, 'ANMF'))
      return invalid();
    offset = next;
  }
  if (!image || (canvas && (canvas.width !== image.width || canvas.height !== image.height)))
    return invalid();
  return image;
}

/** Parses bounded file bytes without asking the browser to decode the image. */
export function readImageDimensions(bytes: Uint8Array, mime: string): ImageDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') return png(bytes, view);
  if (mime === 'image/jpeg') return jpeg(bytes, view);
  if (mime === 'image/webp') return webp(bytes, view);
  return invalid();
}
