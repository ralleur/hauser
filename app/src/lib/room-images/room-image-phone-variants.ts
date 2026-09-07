/* B-27 D1: Dateinamen der Phone-Ableitungen — die einzige Stelle, die Server
   und Client gemeinsam kennen müssen. Bewusst ohne `sharp`-Import: der
   Client-Resolver zieht diese Namen in den Browser-Bundle, die Ableitung
   selbst gehört zum Server. */

/** Für jede Hero-Variante, die Phone anfragt, gibt es eine Ableitung — seit
    dem Nachdimmen der Kacheln also auch `dark-off`. Ohne sie fiele die Kachel
    abends auf die Vollfassung zurück und lüde ein Vielfaches der Bytes. */
export const ROOM_IMAGE_PHONE_VARIANT_FILES = Object.freeze({
  phoneLight: 'phone-light.avif',
  phoneDark: 'phone-dark.avif',
  phoneDarkOff: 'phone-dark-off.avif',
} as const);

/** Aus welcher Final-Variante die jeweilige Phone-Ableitung entsteht. */
export const ROOM_IMAGE_PHONE_VARIANT_SOURCES = Object.freeze({
  phoneLight: 'light',
  phoneDark: 'dark',
  phoneDarkOff: 'darkOff',
} as const);

export type RoomImagePhoneVariantKey = keyof typeof ROOM_IMAGE_PHONE_VARIANT_FILES;

/** Dateiname der Phone-Ableitung zu einer Hero-Variante, oder null. */
export function roomImagePhoneVariantFile(variant: string): string | null {
  if (variant === 'light') return ROOM_IMAGE_PHONE_VARIANT_FILES.phoneLight;
  if (variant === 'dark') return ROOM_IMAGE_PHONE_VARIANT_FILES.phoneDark;
  if (variant === 'dark-off') return ROOM_IMAGE_PHONE_VARIANT_FILES.phoneDarkOff;
  return null;
}
