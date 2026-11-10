import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssetFromFile } from './assets';
import { readImageDimensions } from './image-header';

const images = {
  'image/png':
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWNYffb9fxBmwGAAABAWFGW1HwXtAAAAAElFTkSuQmCC',
  'image/jpeg':
    '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AK+AaEP/2Q==',
  'image/webp': 'UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoCAAMAAUAmJYgCdLoAA5gA/vb579qbFVPO79CjZRL5gAAA',
} as const;

afterEach(() => vi.restoreAllMocks());

function bytes(mime: keyof typeof images): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(images[mime], 'base64'));
}

function oversize(
  mime: keyof typeof images,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const data = bytes(mime);
  const view = new DataView(data.buffer);
  if (mime === 'image/png') {
    view.setUint32(16, width);
    view.setUint32(20, height);
  } else if (mime === 'image/jpeg') {
    const index = data.findIndex((value, i) => value === 0xff && data[i + 1] === 0xc0);
    view.setUint16(index + 5, height);
    view.setUint16(index + 7, width);
  } else {
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  }
  return data;
}

describe('image header preflight', () => {
  it('reads dimensions from real PNG, JPEG and WebP files without decoding', () => {
    for (const mime of Object.keys(images) as Array<keyof typeof images>) {
      expect(readImageDimensions(bytes(mime), mime)).toEqual({ width: 2, height: 3 });
    }
    for (const encoded of [
      'UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAEAdQiirUo4CBiOh/AAA=',
      'UklGRlAAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAgICAgICAAFZQOCAiAAAAcAEAnQEqAgADAAFAJiWUAnQBQAAA/vw3gVf31Og+K+AAAA==',
    ]) {
      expect(
        readImageDimensions(Uint8Array.from(Buffer.from(encoded, 'base64')), 'image/webp'),
      ).toEqual({ width: 2, height: 3 });
    }
  });

  it('rejects oversized dimensions and pixel counts before creating a browser image', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    for (const mime of Object.keys(images) as Array<keyof typeof images>) {
      for (const [width, height, code] of [
        [8001, 1, 'BAD_DIMENSIONS'],
        [7000, 7000, 'TOO_MANY_PIXELS'],
      ] as const) {
        const file = new File([oversize(mime, width, height)], 'oversized', { type: mime });
        await expect(createAssetFromFile(file, 0)).rejects.toMatchObject({ code });
      }
    }
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('rejects truncated or MIME-mismatched headers before creating object URLs', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    for (const file of [
      new File([bytes('image/png').slice(0, 20)], 'truncated.png', { type: 'image/png' }),
      new File([bytes('image/png')], 'mismatch.jpg', { type: 'image/jpeg' }),
    ])
      await expect(createAssetFromFile(file, 0)).rejects.toMatchObject({ code: 'DECODE_FAILED' });
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('rejects misleading extended WebP canvas and animated WebP headers', () => {
    const body = bytes('image/webp');
    const data = new Uint8Array(body.length + 18);
    data.set(body.slice(0, 12));
    data.set(Buffer.from('VP8X'), 12);
    new DataView(data.buffer).setUint32(4, data.length - 8, true);
    new DataView(data.buffer).setUint32(16, 10, true);
    data[24] = 1;
    data[27] = 2;
    data.set(body.slice(12), 30);
    expect(readImageDimensions(data, 'image/webp')).toEqual({ width: 2, height: 3 });
    data[24] = 0;
    expect(() => readImageDimensions(data, 'image/webp')).toThrow();
    data[24] = 1;
    data[20] = 2;
    expect(() => readImageDimensions(data, 'image/webp')).toThrow();
  });
});
