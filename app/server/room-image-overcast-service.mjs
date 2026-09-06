/* ── Trübe Bildvariante (Paket 13) ──

   Derselbe Raum bei bedecktem Himmel. Sie entsteht nachträglich aus dem
   fertigen Tagbild: ein Anbieteraufruf mit dem Overcast-Prompt, dasselbe
   Format wie die anderen Varianten, und dann als optionale Datei ins Bildset.

   Bewusst nicht Teil des Wizard-Laufs: der zählt seine Anbieteraufrufe vorab
   und lässt sie bestätigen. Eine fünfte Generierung gehört in denselben ruhigen
   Weg wie die Fenstererkennung — nachts oder auf Knopfdruck. */

/* Die Verträge kommen über runtime-env: dort werden die TypeScript-Politiken
   je nach Lauf (Quelltext oder Build) aufgelöst. */
import {
  buildRoomImagePrompt,
  finalAvifToProviderJpeg,
  providerPngToFinalAvif,
} from './runtime-env.mjs';

/** Der Spezifikationssatz, mit dem die Bildsets erzeugt wurden. */
export const OVERCAST_PROMPT_SPEC = Object.freeze({
  stylePreset: 'hauser-room-v1',
  declutter: 'none',
  tone: 'neutral',
  preserveFeatures: Object.freeze(['windows', 'doors', 'built_ins', 'signature_furniture', 'wall_art']),
});

/**
 * Erzeugt die trübe Variante eines veröffentlichten Bildsets und legt sie dazu.
 * Gibt immer ein Ergebnisobjekt zurück; geworfen wird nur bei kaputtem Store.
 */
export async function deriveOvercastVariant(assetId, {
  assetStore,
  provider,
  toProviderInput = finalAvifToProviderJpeg,
  toFinal = providerPngToFinalAvif,
  buildPrompt = () => buildRoomImagePrompt('overcast', { ...OVERCAST_PROMPT_SPEC, preserveFeatures: [...OVERCAST_PROMPT_SPEC.preserveFeatures] }),
  signal,
} = {}) {
  if (!assetStore) return { ok: false, code: 'ROOM_IMAGE_STORE_INVALID' };
  if (!provider?.available) return { ok: false, code: 'PROVIDER_CREDENTIAL_MISSING' };

  const entry = assetStore.activeEntry(assetId);
  if (!entry) return { ok: false, code: 'ASSET_NOT_FOUND' };
  if (entry.files?.overcast) return { ok: true, assetId, status: 'already' };

  let light;
  try {
    light = assetStore.variantBytes(assetId, 'light');
  } catch {
    return { ok: false, code: 'ASSET_UNREADABLE' };
  }
  if (!light) return { ok: false, code: 'ASSET_NOT_FOUND' };

  let input;
  try {
    input = await toProviderInput(light);
  } catch {
    return { ok: false, code: 'ASSET_UNREADABLE' };
  }

  let result;
  try {
    result = await provider.edit({ phase: 'overcast', prompt: buildPrompt(), input, signal });
  } catch {
    return { ok: false, code: 'PROVIDER_UNREACHABLE' };
  }
  if (!result?.image) {
    return { ok: false, code: result?.errorCode || 'PROVIDER_INVALID_RESPONSE', status: result?.status ?? null };
  }

  let avif;
  try {
    avif = await toFinal(result.image);
  } catch {
    return { ok: false, code: 'PROVIDER_INVALID_RESPONSE' };
  }

  assetStore.addOptionalVariant(assetId, 'overcast', avif);
  return { ok: true, assetId, status: 'written', byteLength: avif.byteLength };
}

/** Bildsets ohne trübe Variante — Arbeitsvorrat des nächtlichen Laufs. */
export function assetsWithoutOvercast(assetStore) {
  if (!assetStore) return [];
  return assetStore.list()
    .filter((asset) => !asset.variants?.overcast)
    .map((asset) => asset.assetId);
}
