/* ============================================================
   Zentrale Klimasteuerung (B-13, Vorbild Hauser Bottom-Climate)
   ------------------------------------------------------------
   Ein Sollwert für ALLE Klima-Räume synchron. Modell wie vom Nutzer
   beschrieben:
     • Zentral verstellen  → schreibt den Wert auf jeden Klima-Raum → alle
                             synchron → die zentrale Zahl ist WEISS (authoritativ).
     • Einzelraum-Override  → dieser Raum weicht ab → nicht mehr synchron →
                             die zentrale Zahl GRAUT aus (gemischter Zustand).
     • Erneut zentral       → re-synchronisiert alle → wieder WEISS.

   `isSynced` = alle Klima-Räume teilen denselben Sollwert. Die Anzeige zeigt
   im Sync-Fall genau diesen Wert, sonst den zuletzt zentral gesetzten
   Sollwert (bzw. initial den gerundeten Mittelwert) — ausgegraut.
   ============================================================ */

import { appState } from './app.svelte.ts';
import { mergedClimate, setTarget } from './commands.ts';

function climateTargets(): number[] {
  return appState.rooms
    .map((r) => mergedClimate(r.id))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => c.target);
}

export const centralClimate = (() => {
  // Zuletzt zentral gesetzter Sollwert (Fallback-Anzeige im gemischten Zustand).
  let lastSet = $state<number | null>(null);

  // Gemeinsamer Sollwert, falls alle Klima-Räume übereinstimmen, sonst null.
  const synced = $derived.by(() => {
    const t = climateTargets();
    if (t.length === 0) return null;
    return t.every((x) => x === t[0]) ? t[0] : null;
  });

  const value = $derived.by(() => {
    if (synced !== null) return synced;
    if (lastSet !== null) return lastSet;
    const t = climateTargets();
    if (t.length === 0) return 21;
    return Math.round((t.reduce((a, b) => a + b, 0) / t.length) * 2) / 2;
  });

  function setAll(v: number): void {
    const clamped = Math.min(26, Math.max(16, v));
    lastSet = clamped;
    for (const r of appState.rooms) setTarget(r.id, clamped); // setTarget ignoriert Nicht-Klima-Räume
  }

  return {
    get value() { return value; },
    get isSynced() { return synced !== null; },
    get hasClimate() { return climateTargets().length > 0; },
    step(delta: number) { setAll(value + delta); },
  };
})();
