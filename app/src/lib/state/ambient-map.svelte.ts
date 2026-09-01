/* ============================================
   Ambient-Stadtplan — reaktiver Spiegel (docs/18 §7.1)

   Dünne Schicht über `ambient-map-client.ts`: ein `$state`-Spiegel plus die
   Startpolitik. Die erste Statusabfrage läuft nach First Paint in einer
   Idle-Phase; wer sie früher braucht (Ambient-Eintritt, geöffnete
   Einstellungen), startet sie ausdrücklich sofort — gewartet wird nie.

   Der Serverauftrag läuft unabhängig von dieser Ansicht weiter. Das Polling ist
   deshalb im Client begrenzt und nicht an den Lebenszyklus einer Komponente
   gebunden.
   ============================================ */

import {
  createAmbientMapClient,
  initialAmbientMapState,
  type AmbientMapClientState,
} from './ambient-map-client.ts';

export const ambientMap = $state<AmbientMapClientState>(initialAmbientMapState());

const client = createAmbientMapClient({
  onChange: () => { Object.assign(ambientMap, client.state); },
});

let started = false;
let adminStarted = false;

function runIdle(task: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown })
    .requestIdleCallback;
  if (typeof idle === 'function') idle(task, { timeout: 2_000 });
  else setTimeout(task, 200);
}

/**
 * Startet den Statusabruf höchstens einmal je Sichtbarkeitsstufe.
 * `immediate` überspringt die Idle-Phase, blockiert aber nichts.
 * `admin` holt zusätzlich Quelle und Label für die Einstellungen.
 */
export function ensureAmbientMapStatus(
  { immediate = false, admin = false }: { immediate?: boolean; admin?: boolean } = {},
): void {
  if (started && (!admin || adminStarted)) return;
  started = true;
  if (admin) adminStarted = true;
  const task = () => { void client.refresh({ admin }); };
  if (immediate) task();
  else runIdle(task);
}

export function refreshAmbientMapStatus(admin = false): void {
  void client.refresh({ admin });
}

export function useHomeAssistantMapLocation(): void {
  void client.useHomeAssistant();
}

export function locateAmbientMapDevice(): void {
  void client.locateDevice();
}

export function submitManualMapLocation(latitude: string, longitude: string): void {
  void client.submitManual(latitude, longitude);
}

export function regenerateAmbientMap(): void {
  void client.regenerate();
}

export function stopAmbientMapPolling(): void {
  client.stop();
}
