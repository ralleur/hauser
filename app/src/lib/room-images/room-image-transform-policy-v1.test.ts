// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { createHash } from 'node:crypto';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  ROOM_IMAGE_TRANSFORM_POLICY_V1,
  RoomImageTransformError,
  assertProviderInputSize,
  normalizeUploadedRoomImage,
  providerPngToFinalAvif,
  providerPngToProviderJpeg,
  snapRoomImageCrop,
  sourceCropToProviderJpeg,
} from './room-image-transform-policy-v1';

const fixtureUrl = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const fixture = (name: string) => readFileSync(fixtureUrl(name));
const manifest = JSON.parse(readFileSync(fixtureUrl('golden-manifest.json'), 'utf8')) as {
  developmentPlatform: string;
  sharp: string;
  libvips: string;
  fixtures: Record<string, string>;
  goldenOutputs: Record<string, string>;
};
const sha256 = (input: Uint8Array) => createHash('sha256').update(input).digest('hex');

const expectedOrientationCorners = [
  ['red', 'green', 'blue', 'yellow'],
  ['green', 'red', 'yellow', 'blue'],
  ['yellow', 'blue', 'green', 'red'],
  ['blue', 'yellow', 'red', 'green'],
  ['red', 'blue', 'green', 'yellow'],
  ['blue', 'red', 'yellow', 'green'],
  ['yellow', 'green', 'blue', 'red'],
  ['green', 'yellow', 'red', 'blue'],
] as const;

function classify([red, green, blue]: readonly number[]): string {
  if (red > 150 && green < 100 && blue < 100) return 'red';
  if (green > 150 && red < 100 && blue < 100) return 'green';
  if (blue > 150 && red < 100 && green < 100) return 'blue';
  if (red > 150 && green > 150 && blue < 100) return 'yellow';
  return 'other';
}

async function cornerColours(input: Uint8Array): Promise<string[]> {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
  const sample = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    return classify([data[offset], data[offset + 1], data[offset + 2]]);
  };
  return [
    sample(8, 8),
    sample(info.width - 9, 8),
    sample(8, info.height - 9),
    sample(info.width - 9, info.height - 9),
  ];
}

function expectMetadataStripped(metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>): void {
  expect(metadata.orientation).toBeUndefined();
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  expect(metadata.xmp).toBeUndefined();
  expect(metadata.iptc).toBeUndefined();
}

describe('room-image-transform-policy-v1', () => {
  it('pins the locally qualified sharp/libvips platform and all fixture bytes', () => {
    // @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
    expect(process.platform).toBe('darwin');
    // @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
    expect(process.arch).toBe('arm64');
    // @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
    expect(manifest.developmentPlatform).toBe(`${process.platform}-${process.arch}`);
    expect(sharp.versions.sharp).toBe(manifest.sharp);
    expect(sharp.versions.vips).toBe(manifest.libvips);
    for (const [name, expectedHash] of Object.entries(manifest.fixtures)) {
      expect(sha256(fixture(name)), name).toBe(expectedHash);
    }
  });

  it.each(Array.from({ length: 8 }, (_, index) => index + 1))(
    'applies EXIF orientation %i before metadata stripping',
    async (orientation) => {
      const result = await normalizeUploadedRoomImage(fixture(`orientation-${orientation}.jpg`), 'jpeg');
      const rotated = orientation >= 5;
      expect([result.width, result.height]).toEqual(rotated ? [80, 120] : [120, 80]);
      expect(await cornerColours(result.buffer)).toEqual(expectedOrientationCorners[orientation - 1]);
      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.space).toBe('srgb');
      expect(metadata.hasAlpha).toBe(false);
      expectMetadataStripped(metadata);
    },
  );

  it('decodes PNG, oriented WebP and AVIF into opaque metadata-free sRGB', async () => {
    const avifInput = await sharp(fixture('neutral-alpha.png')).avif().toBuffer();
    const png = await normalizeUploadedRoomImage(fixture('neutral-alpha.png'), 'png');
    const webp = await normalizeUploadedRoomImage(fixture('neutral-oriented.webp'), 'webp');
    const avif = await normalizeUploadedRoomImage(avifInput, 'avif');
    expect([png.width, png.height]).toEqual([640, 480]);
    expect([webp.width, webp.height]).toEqual([80, 120]);
    expect([avif.width, avif.height]).toEqual([640, 480]);
    for (const output of [png.buffer, webp.buffer, avif.buffer]) {
      const metadata = await sharp(output).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.space).toBe('srgb');
      expect(metadata.hasAlpha).toBe(false);
      expect(metadata.pages ?? 1).toBe(1);
      expectMetadataStripped(metadata);
    }
  });

  it('rejects format mismatches, animation and pixel bombs at the decoder boundary', async () => {
    await expect(normalizeUploadedRoomImage(fixture('neutral-alpha.png'), 'jpeg'))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_FORMAT' });
    await expect(normalizeUploadedRoomImage(fixture('animated-two-frame.webp'), 'webp'))
      .rejects.toMatchObject({ code: 'ANIMATED_IMAGE_NOT_ALLOWED' });
    await expect(normalizeUploadedRoomImage(fixture('pixel-bomb-25mp.png'), 'png'))
      .rejects.toThrow(/pixel limit/i);
  });

  it('snaps within tolerance using reduced 106:75 geometry, larger-k tie break and clamped centre', () => {
    expect(snapRoomImageCrop(640, 480, { x: 0.1, y: 0.1, width: 0.795, height: 0.75 }))
      .toEqual({ left: 53, top: 41, width: 530, height: 375 });
    expect(snapRoomImageCrop(212, 150, { x: 0.125, y: 0.125, width: 0.75, height: 0.75 }))
      .toEqual({ left: 0, top: 0, width: 212, height: 150 });
    expect(snapRoomImageCrop(640, 480, { x: 0.9, y: 0.1, width: 0.099375, height: 0.09375 }))
      .toEqual({ left: 534, top: 33, width: 106, height: 75 });
  });

  it('rejects invalid crop bounds and aspect ratios rather than stretching', () => {
    expect(() => snapRoomImageCrop(640, 480, { x: 0, y: 0, width: 1, height: 1 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CROP_ASPECT_RATIO' }));
    expect(() => snapRoomImageCrop(640, 480, { x: 0.9, y: 0, width: 0.2, height: 0.2 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CROP' }));
  });

  it('creates deterministic metadata-free 3392x2400 JPEG with q90, 4:4:4 and no alpha', async () => {
    const normalized = await normalizeUploadedRoomImage(fixture('neutral-alpha.png'), 'png');
    const crop = { x: 0.1, y: 0.1, width: 0.795, height: 0.75 };
    const first = await sourceCropToProviderJpeg(normalized.buffer, crop);
    const second = await sourceCropToProviderJpeg(normalized.buffer, crop);
    expect(sha256(first)).toBe(sha256(second));
    expect(sha256(first)).toBe(manifest.goldenOutputs['source-provider.jpeg']);
    const metadata = await sharp(first).metadata();
    expect(metadata).toMatchObject({
      format: 'jpeg', width: 3_392, height: 2_400, space: 'srgb',
      chromaSubsampling: '4:4:4', hasAlpha: false, isProgressive: false,
    });
    expectMetadataStripped(metadata);
    expect(() => assertProviderInputSize(first)).not.toThrow();
  });

  it('center-covers provider PNG identically for next-edit JPEG and final AVIF', async () => {
    const provider = fixture('provider-portrait.png');
    const jpeg = await providerPngToProviderJpeg(provider);
    const avif = await providerPngToFinalAvif(provider);
    expect(sha256(jpeg)).toBe(manifest.goldenOutputs['provider-provider.jpeg']);
    expect(sha256(avif)).toBe(manifest.goldenOutputs['provider-final.avif']);

    const jpegMetadata = await sharp(jpeg).metadata();
    expect(jpegMetadata).toMatchObject({
      format: 'jpeg', width: 3_392, height: 2_400, space: 'srgb',
      chromaSubsampling: '4:4:4', hasAlpha: false, isProgressive: false,
    });
    expectMetadataStripped(jpegMetadata);

    const avifMetadata = await sharp(avif).metadata();
    expect(avifMetadata).toMatchObject({
      format: 'heif', width: 3_392, height: 2_400, space: 'srgb',
      hasAlpha: false, pages: 1,
    });
    // sharp/libvips 8.18.3 does not expose AVIF chroma sampling on decode;
    // the encoder setting remains explicit and the golden bytes pin its result.
    expect(avifMetadata.chromaSubsampling).toBeUndefined();
    expectMetadataStripped(avifMetadata);

    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const colourAt = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]] as const;
    };
    expect(classify(colourAt(info.width / 2, 20))).toBe('other');
    expect(classify(colourAt(info.width / 2, Math.floor(info.height / 2)))).toBe('green');
    expect(classify(colourAt(info.width / 2, info.height - 21))).toBe('other');
  });

  it('requires provider output to decode as PNG and enforces the strict byte boundary', async () => {
    await expect(providerPngToFinalAvif(fixture('orientation-1.jpg')))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_FORMAT' });
    expect(() => assertProviderInputSize(new Uint8Array(49_999_999))).not.toThrow();
    expect(() => assertProviderInputSize(new Uint8Array(50_000_000)))
      .toThrowError(expect.objectContaining({ code: 'PROVIDER_INPUT_TOO_LARGE' }));
    expect(RoomImageTransformError).toBeDefined();
    expect(ROOM_IMAGE_TRANSFORM_POLICY_V1.avif).toEqual({
      quality: 80,
      effort: 6,
      chromaSubsampling: '4:4:4',
      lossless: false,
      bitdepth: 8,
      tune: 'auto',
    });
  });
});
