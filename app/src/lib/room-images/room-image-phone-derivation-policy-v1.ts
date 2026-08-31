import sharp from 'sharp';
import { ROOM_IMAGE_TRANSFORM_POLICY_V1 } from './room-image-transform-policy-v1.ts';
import {
  ROOM_IMAGE_PHONE_VARIANT_SOURCES,
  type RoomImagePhoneVariantKey,
} from './room-image-phone-variants.ts';

/* B-27 D1: Die Phone-Ableitung ist ein reiner Downscale des Final-AVIF.
   Die Geometrie behält bewusst das kanonische Verhältnis 106:75 (1272×900 =
   106·12 × 75·12) und schneidet NICHT auf das Kachelformat vor — sonst hätte
   `--phone-room-focus` nichts mehr zu verschieben.

   Qualität 60 an den drei realen Prod-Assets gemessen: 356–535 KB Quelle →
   65–98 KB Ableitung, also innerhalb des im Plan gesetzten Korridors von
   60–120 KB und rund ein Fünftel bis Sechstel der Ausgangsgröße. */
export const ROOM_IMAGE_PHONE_DERIVATION_POLICY_V1 = Object.freeze({
  id: 'room-image-phone-derivation-policy-v1',
  target: Object.freeze({ width: 1_272, height: 900 }),
  avif: Object.freeze({
    ...ROOM_IMAGE_TRANSFORM_POLICY_V1.avif,
    quality: 60,
  }),
  expectedByteRange: Object.freeze({ min: 20_000, max: 400_000 }),
} as const);

export { ROOM_IMAGE_PHONE_VARIANT_SOURCES };

/**
 * Leitet eine Phone-Variante aus dem fertigen Final-AVIF ab. Quelle ist genau
 * die Datei, die auch ausgeliefert wird — es gibt keinen zweiten Bildweg und
 * damit keine Möglichkeit, dass Panel- und Phone-Fassung auseinanderlaufen.
 */
export async function deriveRoomImagePhoneVariant(finalAvif: Uint8Array): Promise<Uint8Array> {
  if (!(finalAvif instanceof Uint8Array) || finalAvif.byteLength < 1) {
    throw new Error('room-image phone derivation requires final AVIF bytes');
  }
  const { target, avif } = ROOM_IMAGE_PHONE_DERIVATION_POLICY_V1;
  return await sharp(finalAvif, {
    animated: false,
    failOn: 'error',
    limitInputPixels: ROOM_IMAGE_TRANSFORM_POLICY_V1.maxDecodedPixels,
    sequentialRead: true,
  })
    .resize(target.width, target.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .avif({ ...avif })
    .toBuffer();
}

/**
 * Leitet den vollständigen Phone-Satz aus den Final-Varianten ab. Der Aufrufer
 * reicht das Ergebnis unverändert in denselben atomaren Publish-Vorgang.
 */
export async function deriveRoomImagePhoneVariants(
  finals: Readonly<Record<string, Uint8Array>>,
): Promise<Record<RoomImagePhoneVariantKey, Uint8Array>> {
  const entries = Object.entries(ROOM_IMAGE_PHONE_VARIANT_SOURCES) as [RoomImagePhoneVariantKey, string][];
  const derived = await Promise.all(entries.map(async ([key, source]) => {
    const bytes = finals[source];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
      throw new Error(`room-image phone derivation is missing the ${source} final`);
    }
    return [key, await deriveRoomImagePhoneVariant(bytes)] as const;
  }));
  return Object.fromEntries(derived) as Record<RoomImagePhoneVariantKey, Uint8Array>;
}
