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
import { runtime } from '../adapter/runtime.svelte.ts';
import type { ClimateValue } from '../adapter/types.ts';
import { mergedClimate, setClimateTarget, setTarget } from './commands.ts';
import {
  centralClimateConfig,
  centralRoomDelta,
  centralRoomIncluded,
} from './climate-central-config.svelte.ts';

function climateTargets(): number[] {
  if (centralClimateConfig.customEntityId) {
    const climate = runtime.merged(centralClimateConfig.customEntityId) as ClimateValue | undefined;
    return climate ? [climate.target] : [];
  }
  return appState.rooms
    .filter((room) => centralRoomIncluded(room.id))
    .map((room) => {
      const climate = mergedClimate(room.id);
      return climate ? climate.target - centralRoomDelta(room.id) : null;
    })
    .filter((target): target is number => target !== null);
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
    if (centralClimateConfig.customEntityId) {
      setClimateTarget(centralClimateConfig.customEntityId, clamped);
      return;
    }
    for (const room of appState.rooms) {
      if (centralRoomIncluded(room.id)) setTarget(room.id, clamped + centralRoomDelta(room.id));
    }
  }

  return {
    get value() { return value; },
    get isSynced() { return synced !== null; },
    get hasClimate() { return centralClimateConfig.customEntityId !== null || climateTargets().length > 0; },
    step(delta: number) { setAll(value + delta); },
  };
})();
