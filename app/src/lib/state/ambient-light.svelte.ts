/* ============================================
   Umgebungslicht (Paket 9) — reaktiver Teil
   --------------------------------------------
   Zwei Quellen, in dieser Reihenfolge:
     1. ein Helligkeitssensor des angezeigten Raums (device_class illuminance),
     2. der `AmbientLightSensor` des Panels selbst, wo der Browser ihn erlaubt.
   Beides fehlt → gar kein Dimmen. Der Schleier ist eine reine Deckkraft;
   Layout und Bildrate bleiben unberührt.
   ============================================ */

import { appState } from './app.svelte.ts';
import { runtime } from '../adapter/runtime.svelte.ts';
import type { SensorValue } from '../adapter/types.ts';
import { dimFromLux, smoothDim } from './ambient-light.ts';

/** Dunkelster erlaubter Schleier — das Gegenstück zu „kein Schleier" (0). */
export const MAX_DIM = 0.42;

export const ambientLight = $state<{ lux: number | null; dim: number }>({ lux: null, dim: 0 });

/** Der erste Helligkeitssensor des angezeigten Raums, falls einer zugeordnet ist. */
export function roomIlluminance(roomId: string): number | null {
  const room = appState.rooms.find((entry) => entry.id === roomId);
  if (!room) return null;
  for (const device of room.lights) {
    if (device.deviceClass !== 'illuminance') continue;
    const value = runtime.merged(device.entityId) as SensorValue | undefined;
    if (value && typeof value.value === 'number') return value.value;
  }
  return null;
}

interface AmbientLightSensorLike {
  illuminance?: number;
  start(): void;
  stop(): void;
  addEventListener(type: string, listener: () => void): void;
}

function readingFrom(lux: number | null): void {
  ambientLight.lux = lux;
  ambientLight.dim = smoothDim(ambientLight.dim, dimFromLux(lux, MAX_DIM));
}

/** Startet die Messung; der Rückgabewert beendet sie wieder (Effekt-Cleanup). */
export function watchAmbientLight(roomId: () => string): () => void {
  const roomTimer = setInterval(() => {
    const lux = roomIlluminance(roomId());
    if (lux !== null) readingFrom(lux);
  }, 5000);
  readingFrom(roomIlluminance(roomId()));

  /* Der Panel-Sensor ist optional und darf abgelehnt werden — dann bleibt es
     beim Raumsensor bzw. beim ungedimmten Bild. */
  let sensor: AmbientLightSensorLike | null = null;
  const globalWithSensor = globalThis as unknown as {
    AmbientLightSensor?: new (options: { frequency: number }) => AmbientLightSensorLike;
  };
  if (globalWithSensor.AmbientLightSensor) {
    try {
      sensor = new globalWithSensor.AmbientLightSensor({ frequency: 1 });
      sensor.addEventListener('reading', () => {
        if (roomIlluminance(roomId()) !== null) return; // der Raum weiß es besser
        readingFrom(typeof sensor?.illuminance === 'number' ? sensor.illuminance : null);
      });
      sensor.addEventListener('error', () => { sensor = null; });
      sensor.start();
    } catch {
      sensor = null;
    }
  }

  return () => {
    clearInterval(roomTimer);
    try { sensor?.stop(); } catch { /* schon beendet */ }
    ambientLight.dim = 0;
    ambientLight.lux = null;
  };
}
