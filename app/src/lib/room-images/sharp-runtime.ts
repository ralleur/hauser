/* ── Bildbibliothek mit Rückfallebene (Issue #18) ──

   `sharp` liefert für Linux x64 nur noch vorkompilierte Binärdateien, die
   einen Prozessor der Stufe x86-64-v2 verlangen. Auf älterer Hardware — und
   vor allem in virtuellen Maschinen, die dem Gast eine Standard-CPU ohne
   SSE4.2 vorspielen — schlägt das Laden fehl. `sharp` greift dann von selbst
   auf `@img/sharp-wasm32` zurück, sofern das Paket mitgeliefert ist; genau
   dafür steht es in den optionalen Abhängigkeiten.

   Scheitert auch das, darf der Fehler den Dienst nicht mitreißen: bis hierhin
   hing der komplette Start am Bildmodul, ein altes Gerät bekam also gar kein
   Panel statt bloß keine Raumbilder. Deshalb der Ersatz, der erst beim
   tatsächlichen Bildaufruf mit klarer Ursache abbricht. */
import type SharpFactory from 'sharp';

let loaded: typeof SharpFactory | null = null;
let reason = '';

try {
  loaded = (await import('sharp')).default;
} catch (error) {
  reason = error instanceof Error ? error.message : String(error);
  console.warn(`[hauser] sharp konnte nicht geladen werden — Raumbilder bleiben aus:\n${reason}`);
}

function unavailable(): never {
  throw new Error(`image processing unavailable: sharp could not be loaded\n${reason}`);
}

/** Wahr, wenn Bildverarbeitung zur Verfügung steht. */
export const sharpAvailable = loaded !== null;

/** Grund des Fehlschlags, leer solange `sharpAvailable` gilt. */
export const sharpUnavailableReason = reason;

export const sharp: typeof SharpFactory =
  loaded ?? (Object.assign(unavailable, { kernel: { lanczos3: 'lanczos3' } }) as unknown as typeof SharpFactory);
