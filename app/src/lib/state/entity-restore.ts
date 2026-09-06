/* ── Zustand zurückfahren ──
   Aus einem gemergten Wert (LightValue/SwitchValue/ClimateValue) den
   gegenläufigen Command bauen. Zwei Nutzer teilen sich das: die Rücknahme der
   Szenen-Vorschau (scene-config) und der Rückgängig-Streifen (undo.svelte).

   Bewusst ein eigenes, winziges Modul: der Streifen soll den Startpfad des
   Telefons nicht mit der gesamten Szenen-Konfiguration belasten (ADR-029). */

import type { ClimateValue, Command, LightValue, SwitchValue } from '../adapter/types.ts';

export interface SceneCommand {
  command: Command;
  /* Klima kommt seit Paket 6 dazu: der Undo-Streifen stellt auch Sollwerte
     zurück, und dafür baut buildRestoreCommand einen Klima-Patch. */
  optimistic: Partial<LightValue> | SwitchValue | Partial<ClimateValue>;
}

export function buildRestoreCommand(entityId: string, value: unknown, now = Date.now()): SceneCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const domain = entityId.slice(0, entityId.indexOf('.'));
  /* Klima kennt kein an/aus: zurück heißt Sollwert zurück (Paket 6 Undo). */
  if (domain === 'climate') {
    const climate = value as Partial<ClimateValue>;
    if (typeof climate.target !== 'number') return null;
    return {
      command: {
        entityId, domain, service: 'set_temperature',
        data: { temperature: climate.target }, queuedAt: now,
      },
      optimistic: { target: climate.target } as Partial<ClimateValue>,
    };
  }
  if (domain === 'light') {
    const light = value as Partial<LightValue>;
    if (!light.on) {
      return {
        command: { entityId, domain, service: 'turn_off', data: {}, queuedAt: now },
        optimistic: { on: false } satisfies Partial<LightValue>,
      };
    }
    const data: Record<string, unknown> = {};
    if (typeof light.brightness === 'number') data.brightness_pct = light.brightness;
    // Farbmodus hat Vorrang: die Vorschau kann das Licht auf Farbtemperatur
    // gezogen haben, dann bringt erst rgb_color die Farbe zurück.
    if (typeof light.color === 'string') data.rgb_color = hexToRgbTriple(light.color);
    else if (typeof light.colorTemp === 'number') data.color_temp_kelvin = light.colorTemp;
    return {
      command: { entityId, domain, service: 'turn_on', data, queuedAt: now },
      optimistic: { ...light, on: true } as Partial<LightValue>,
    };
  }
  const sw = value as Partial<SwitchValue>;
  return {
    command: { entityId, domain, service: sw.on ? 'turn_on' : 'turn_off', data: {}, queuedAt: now },
    optimistic: { on: !!sw.on } satisfies SwitchValue,
  };
}

function hexToRgbTriple(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}
