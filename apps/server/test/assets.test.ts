import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { LIMITS } from '@poster/core';
import { prepareAsset, prepareAssets } from '../src/export/assets.js';

afterEach(() => vi.restoreAllMocks());

async function png(width = 8, height = 8): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#ff0000' } })
    .png()
    .toBuffer();
}

describe('asset security boundary', () => {
  it.each([
    Buffer.alloc(0),
    Buffer.from('not an image'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  ])('rejects empty, non-image, SVG and truncated bytes', async (bytes) => {
    await expect(prepareAsset('bad', bytes)).rejects.toMatchObject({ code: 'INVALID_DOC' });
  });
  it('rejects per-file bytes before header parsing', async () => {
    const read = vi.spyOn(sharp.prototype, 'metadata');
    await expect(
      prepareAsset('big', Buffer.alloc(LIMITS.assets.maxBytesPerAsset + 1)),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects an actual oversized side from metadata before raster decoding', async () => {
    const bytes = await png(LIMITS.assets.maxDimension + 1, 1);
    const decode = vi.spyOn(sharp.prototype, 'toBuffer');
    await expect(prepareAsset('wide', bytes)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(decode).not.toHaveBeenCalled();
  });
  it('rejects a header pixel bomb before decoding', async () => {
    const bytes = await png();
    vi.spyOn(sharp.prototype, 'metadata').mockResolvedValue({
      format: 'png',
      width: 7000,
      height: 7000,
    });
    const decode = vi.spyOn(sharp.prototype, 'toBuffer');
    await expect(prepareAsset('bomb', bytes)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(decode).not.toHaveBeenCalled();
  });
  it('preflights the aggregate budget before decoding any of the document images', async () => {
    const bytes = await png();
    vi.spyOn(sharp.prototype, 'metadata').mockResolvedValue({
      format: 'png',
      width: 6000,
      height: 5000,
    });
    const decode = vi.spyOn(sharp.prototype, 'toBuffer');
    await expect(
      prepareAssets(
        new Map([
          ['a', bytes],
          ['b', bytes],
          ['c', bytes],
        ]),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', path: 'assets' });
    expect(decode).not.toHaveBeenCalled();
  });
  it('caps the image count before even reading headers', async () => {
    const read = vi.spyOn(sharp.prototype, 'metadata');
    await expect(
      prepareAssets(new Map(Array.from({ length: 21 }, (_, i) => [`a${i}`, Buffer.alloc(1)]))),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(read).not.toHaveBeenCalled();
  });
  it('refuses animation and conflicting format metadata', async () => {
    const bytes = await png();
    vi.spyOn(sharp.prototype, 'metadata')
      .mockResolvedValueOnce({ format: 'png', width: 8, height: 8, pages: 2 })
      .mockResolvedValueOnce({ format: 'svg', width: 8, height: 8 });
    await expect(prepareAsset('animated', bytes)).rejects.toMatchObject({ code: 'INVALID_DOC' });
    await expect(prepareAsset('mismatch', bytes)).rejects.toMatchObject({ code: 'INVALID_DOC' });
  });
  it('re-encodes a PNG polyglot and strips its active trailer', async () => {
    const payload = Buffer.from('<script>polyglot_payload_sentinel</script>');
    const result = await prepareAsset('safe', Buffer.concat([await png(), payload]));
    expect(result.bytes.includes(payload)).toBe(false);
    expect((await sharp(result.bytes).metadata()).format).toBe('png');
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });
  it.each(['jpeg', 'webp'] as const)('sniffs and safely re-encodes %s', async (format) => {
    const image = sharp({
      create: { width: 8, height: 8, channels: 3, background: '#ffffff' },
    });
    const bytes = await image[format]().toBuffer();
    expect((await prepareAsset('safe', bytes)).mime).toBe('image/png');
  });
});
