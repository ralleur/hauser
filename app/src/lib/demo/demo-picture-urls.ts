// SPDX-License-Identifier: AGPL-3.0-only
// Kept separate from the demo job engine so image resolution stays lightweight.
const pictures = new Map<string, Record<string, string>>();
export function registerDemoPicture(id: string, variants: { light: string; dark: string; darkOff: string; overcast?: string }) {
  pictures.set(id, { light: variants.light, dark: variants.dark, 'dark-off': variants.darkOff, overcast: variants.overcast ?? variants.light });
}
export function demoPictureUrl(id: string, variant: string): string | undefined {
  return pictures.get(id)?.[variant.replace('-phone.avif', '').replace('.avif', '')];
}
