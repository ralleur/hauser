import sharp from 'sharp';

export const ROOM_IMAGE_TRANSFORM_POLICY_V1 = Object.freeze({
  id: 'room-image-transform-policy-v1',
  acceptedInputFormats: Object.freeze(['jpeg', 'png', 'webp', 'avif'] as const),
  maxDecodedPixels: 24_000_000,
  target: Object.freeze({ width: 3_392, height: 2_400 }),
  crop: Object.freeze({ ratioWidth: 106, ratioHeight: 75, tolerance: 0.001 }),
  resize: Object.freeze({ kernel: 'lanczos3', providerFit: 'cover', providerPosition: 'centre' }),
  jpeg: Object.freeze({
    quality: 90,
    chromaSubsampling: '4:4:4',
    progressive: false,
    trellisQuantisation: false,
    overshootDeringing: false,
    optimiseScans: false,
    optimiseCoding: true,
    quantisationTable: 0,
    mozjpeg: false,
  }),
  internalPng: Object.freeze({
    progressive: false,
    compressionLevel: 9,
    adaptiveFiltering: false,
    palette: false,
  }),
  avif: Object.freeze({
    quality: 80,
    effort: 6,
    chromaSubsampling: '4:4:4',
    lossless: false,
    bitdepth: 8,
    tune: 'auto',
  }),
  providerInputMaxBytesExclusive: 50_000_000,
  alphaBackground: Object.freeze({ r: 255, g: 255, b: 255 }),
} as const);

export type AcceptedRoomImageFormat = (typeof ROOM_IMAGE_TRANSFORM_POLICY_V1.acceptedInputFormats)[number];

export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type RoomImageTransformErrorCode =
  | 'UNSUPPORTED_IMAGE_FORMAT'
  | 'ANIMATED_IMAGE_NOT_ALLOWED'
  | 'INVALID_IMAGE_DIMENSIONS'
  | 'INVALID_CROP'
  | 'INVALID_CROP_ASPECT_RATIO'
  | 'PROVIDER_INPUT_TOO_LARGE';

export class RoomImageTransformError extends Error {
  readonly code: RoomImageTransformErrorCode;

  constructor(code: RoomImageTransformErrorCode, message: string) {
    super(message);
    this.name = 'RoomImageTransformError';
    this.code = code;
  }
}

function decoder(input: Uint8Array) {
  return sharp(input, {
    animated: false,
    failOn: 'error',
    limitInputPixels: ROOM_IMAGE_TRANSFORM_POLICY_V1.maxDecodedPixels,
    sequentialRead: true,
  });
}

function assertSingleFrame(metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>): void {
  if ((metadata.pages ?? 1) !== 1) {
    throw new RoomImageTransformError('ANIMATED_IMAGE_NOT_ALLOWED', 'Animated images are not supported');
  }
}

function assertDimensions(width: number | undefined, height: number | undefined): asserts width is number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0) {
    throw new RoomImageTransformError('INVALID_IMAGE_DIMENSIONS', 'Image dimensions are missing or invalid');
  }
}

function assertFormat(
  metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>,
  expected: AcceptedRoomImageFormat | 'png',
): void {
  const matches = expected === 'avif'
    ? metadata.format === 'heif' && metadata.mediaType === 'image/avif' && metadata.compression === 'av1'
    : metadata.format === expected;
  if (!matches) {
    throw new RoomImageTransformError(
      'UNSUPPORTED_IMAGE_FORMAT',
      `Expected ${expected}, decoded ${metadata.format ?? 'unknown'}`,
    );
  }
}

function stripAlphaAndConvertToSrgb(image: ReturnType<typeof sharp>) {
  return image
    .autoOrient()
    .flatten({ background: ROOM_IMAGE_TRANSFORM_POLICY_V1.alphaBackground })
    .toColourspace('srgb');
}

function jpegOutput(image: ReturnType<typeof sharp>) {
  return image.jpeg({ ...ROOM_IMAGE_TRANSFORM_POLICY_V1.jpeg });
}

function avifOutput(image: ReturnType<typeof sharp>) {
  return image.avif({ ...ROOM_IMAGE_TRANSFORM_POLICY_V1.avif });
}

export async function normalizeUploadedRoomImage(
  input: Uint8Array,
  expectedFormat: AcceptedRoomImageFormat,
): Promise<{ buffer: Uint8Array; width: number; height: number }> {
  const inputMetadata = await decoder(input).metadata();
  assertFormat(inputMetadata, expectedFormat);
  assertSingleFrame(inputMetadata);

  const result = await stripAlphaAndConvertToSrgb(decoder(input))
    .png({ ...ROOM_IMAGE_TRANSFORM_POLICY_V1.internalPng })
    .toBuffer({ resolveWithObject: true });

  assertDimensions(result.info.width, result.info.height);
  return { buffer: result.data, width: result.info.width, height: result.info.height };
}

function assertNormalizedCrop(crop: NormalizedCrop): void {
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (values.some((value) => !Number.isFinite(value))
    || crop.x < 0
    || crop.y < 0
    || crop.width <= 0
    || crop.height <= 0
    || crop.x + crop.width > 1
    || crop.y + crop.height > 1) {
    throw new RoomImageTransformError('INVALID_CROP', 'Crop must be finite and inside normalized image bounds');
  }
}

export function snapRoomImageCrop(
  imageWidth: number,
  imageHeight: number,
  crop: NormalizedCrop,
): PixelCrop {
  if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new RoomImageTransformError('INVALID_IMAGE_DIMENSIONS', 'Image dimensions must be positive integers');
  }
  assertNormalizedCrop(crop);

  const requestedWidth = crop.width * imageWidth;
  const requestedHeight = crop.height * imageHeight;
  const pixelRatio = requestedWidth / requestedHeight;
  const targetRatio = ROOM_IMAGE_TRANSFORM_POLICY_V1.target.width / ROOM_IMAGE_TRANSFORM_POLICY_V1.target.height;
  if (Math.abs(pixelRatio - targetRatio) > ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.tolerance) {
    throw new RoomImageTransformError('INVALID_CROP_ASPECT_RATIO', 'Crop is outside the target aspect tolerance');
  }

  const maxK = Math.min(
    Math.floor(imageWidth / ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.ratioWidth),
    Math.floor(imageHeight / ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.ratioHeight),
  );
  if (maxK < 1) {
    throw new RoomImageTransformError('INVALID_CROP', 'Image is too small for the canonical crop ratio');
  }

  let selectedK = 1;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (let k = 1; k <= maxK; k += 1) {
    const distance = Math.abs(ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.ratioWidth * k - requestedWidth)
      + Math.abs(ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.ratioHeight * k - requestedHeight);
    if (distance < selectedDistance || (distance === selectedDistance && k > selectedK)) {
      selectedK = k;
      selectedDistance = distance;
    }
  }

  const width = ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.ratioWidth * selectedK;
  const height = ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.ratioHeight * selectedK;
  const centerX = (crop.x + crop.width / 2) * imageWidth;
  const centerY = (crop.y + crop.height / 2) * imageHeight;
  const roundedLeft = Math.floor(centerX - width / 2 + 0.5);
  const roundedTop = Math.floor(centerY - height / 2 + 0.5);
  const left = Math.min(Math.max(roundedLeft, 0), imageWidth - width);
  const top = Math.min(Math.max(roundedTop, 0), imageHeight - height);

  if (left < 0 || top < 0 || left + width > imageWidth || top + height > imageHeight
    || width * ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.ratioHeight
      !== height * ROOM_IMAGE_TRANSFORM_POLICY_V1.crop.ratioWidth) {
    throw new RoomImageTransformError('INVALID_CROP', 'Canonical crop is outside image bounds');
  }

  return { left, top, width, height };
}

export async function sourceCropToProviderJpeg(
  normalizedSource: Uint8Array,
  crop: NormalizedCrop,
): Promise<Uint8Array> {
  const metadata = await decoder(normalizedSource).metadata();
  assertFormat(metadata, 'png');
  assertSingleFrame(metadata);
  assertDimensions(metadata.width, metadata.height);
  const snapped = snapRoomImageCrop(metadata.width, metadata.height!, crop);

  return jpegOutput(
    decoder(normalizedSource)
      .extract(snapped)
      .flatten({ background: ROOM_IMAGE_TRANSFORM_POLICY_V1.alphaBackground })
      .toColourspace('srgb')
      .resize(ROOM_IMAGE_TRANSFORM_POLICY_V1.target.width, ROOM_IMAGE_TRANSFORM_POLICY_V1.target.height, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      }),
  ).toBuffer();
}

/** Ganzes Foto statt des gewählten Ausschnitts für die Kompositionsphase: das
    Modell soll Rahmen und Perspektive selbst wählen. Die Zielgeometrie bleibt
    exakt 3392×2400, damit Quellvorschau und Provider-Prüfungen unverändert
    greifen; ein 4:3-Foto verliert dabei nur wenige Prozent oben und unten. */
export async function sourceFullToProviderJpeg(normalizedSource: Uint8Array): Promise<Uint8Array> {
  const metadata = await decoder(normalizedSource).metadata();
  assertFormat(metadata, 'png');
  assertSingleFrame(metadata);
  assertDimensions(metadata.width, metadata.height);

  return jpegOutput(
    decoder(normalizedSource)
      .flatten({ background: ROOM_IMAGE_TRANSFORM_POLICY_V1.alphaBackground })
      .toColourspace('srgb')
      .resize(ROOM_IMAGE_TRANSFORM_POLICY_V1.target.width, ROOM_IMAGE_TRANSFORM_POLICY_V1.target.height, {
        fit: ROOM_IMAGE_TRANSFORM_POLICY_V1.resize.providerFit,
        position: ROOM_IMAGE_TRANSFORM_POLICY_V1.resize.providerPosition,
        kernel: sharp.kernel.lanczos3,
      }),
  ).toBuffer();
}

function providerOutputGeometry(input: Uint8Array) {
  return decoder(input)
    .flatten({ background: ROOM_IMAGE_TRANSFORM_POLICY_V1.alphaBackground })
    .toColourspace('srgb')
    .resize(ROOM_IMAGE_TRANSFORM_POLICY_V1.target.width, ROOM_IMAGE_TRANSFORM_POLICY_V1.target.height, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
      withoutReduction: false,
    });
}

async function assertProviderPng(input: Uint8Array): Promise<void> {
  const metadata = await decoder(input).metadata();
  assertFormat(metadata, 'png');
  assertSingleFrame(metadata);
  assertDimensions(metadata.width, metadata.height);
}

export async function providerPngToProviderJpeg(input: Uint8Array): Promise<Uint8Array> {
  await assertProviderPng(input);
  return jpegOutput(providerOutputGeometry(input)).toBuffer();
}

export async function providerPngToFinalAvif(input: Uint8Array): Promise<Uint8Array> {
  await assertProviderPng(input);
  return avifOutput(providerOutputGeometry(input)).toBuffer();
}

export function assertProviderInputSize(input: Uint8Array): void {
  if (input.byteLength >= ROOM_IMAGE_TRANSFORM_POLICY_V1.providerInputMaxBytesExclusive) {
    throw new RoomImageTransformError('PROVIDER_INPUT_TOO_LARGE', 'Provider input must be smaller than 50,000,000 bytes');
  }
}
