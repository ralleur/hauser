/* ============================================
   UI-Actions für steuerbare Entitäten (ADR-017): Licht + Klima laufen jetzt
   über den Adapter-Seam statt über Direkt-Mutation des Fake-States.
   Muster (docs/02): optimistischer Intent sofort sichtbar → Command via
   CommandQueue → Reconciliation über die gemergte Sicht.
   Die Komponenten lesen `mergedLight`/`mergedClimate` und rufen die Actions —
   sie kennen weder EntityStore noch Backend.
   ============================================ */

import { runtime } from '../adapter/runtime.svelte.ts';
import {
  climateEntityId,
  HOME_OFF_SCRIPT_ENTITY,
  lightEntityId,
  tempSensorEntityId,
  VACATION_MODE_ENTITY,
} from './entities.ts';
import type { LightValue, ClimateValue, MediaValue, ReconcileEvent, SwitchValue, SensorValue } from '../adapter/types.ts';
import type { Light } from './app.svelte.ts';

/* ── Lesen: gemergte Sicht (Server-State bzw. pending Intent) ──
   `undefined`, solange ein frisch eingeblendetes Nicht-Seed-Gerät noch keinen
   Wert hat (kein Seed, kein Cache, ADR-006-Abo greift erst nach der Projektion).
   Leser müssen das tolerieren — ein Wurf hier killt den gesamten Svelte-Flush. */
export function mergedLight(roomId: string, lightId: string): LightValue | undefined {
  return runtime.merged(lightEntityId(roomId, lightId)) as LightValue | undefined;
}

/* Wert-Shape hängt an der Kategorie (LightValue/SwitchValue/ClimateValue/
   SensorValue/MediaValue) — der Aufrufer castet kategoriebewusst. */
export function mergedDevice(roomId: string, device: Light): unknown {
  return runtime.merged(device.entityId ?? lightEntityId(roomId, device.id));
}

export function mergedClimate(roomId: string): ClimateValue | null {
  const eid = climateEntityId(roomId);
  if (!eid) return null;
  return runtime.merged(eid) as ClimateValue;
}

/* Live-Ist-Temperatur eines Raums (docs/07) mit expliziter Priorität:
   1. dedizierter Raum-Sensor (sensor.*), wenn gemappt UND numerisch,
   2. sonst die gemessene Thermostat-Ist-Temp (climate.current_temperature),
   3. sonst null → die UI zeigt gar keine Temperatur an (keine Mock-Werte).
   Reine Leseoperation über die gemergte Sicht; toleriert fehlende Werte. */
export function roomTemperature(roomId: string): number | null {
  const sensorId = tempSensorEntityId(roomId);
  if (sensorId) {
    const s = runtime.merged(sensorId) as SensorValue | undefined;
    if (s && typeof s.value === 'number') return s.value;
  }
  const climate = mergedClimate(roomId);
  if (climate && typeof climate.current === 'number') return climate.current;
  return null;
}

export function lightPending(roomId: string, lightId: string): boolean {
  return runtime.intentStatus(lightEntityId(roomId, lightId)) === 'pending';
}

export function climatePending(roomId: string): boolean {
  const eid = climateEntityId(roomId);
  if (!eid) return false;
  return runtime.intentStatus(eid) === 'pending';
}

/* Contradiction-Events (docs/02): das Control löst darauf Wobble (Toggle) bzw.
   Interpolation/Crossfade (Slider/Stepper) aus. */
export function lightReconcile(roomId: string, lightId: string): ReconcileEvent | null {
  return runtime.reconcileEvent(lightEntityId(roomId, lightId));
}

export function climateReconcile(roomId: string): ReconcileEvent | null {
  const eid = climateEntityId(roomId);
  if (!eid) return null;
  return runtime.reconcileEvent(eid);
}

/* ── Schreiben: optimistischer Toggle/Wert + Command (docs/02, docs/04) ── */
export function toggleLight(roomId: string, lightId: string): void {
  const entityId = lightEntityId(roomId, lightId);
  const cur = runtime.merged(entityId) as LightValue | undefined;
  const next: LightValue = { ...cur, on: !cur?.on, brightness: cur?.brightness ?? 0 };
  runtime.dispatch(
    { entityId, domain: 'light', service: next.on ? 'turn_on' : 'turn_off', data: {}, queuedAt: Date.now() },
    next,
  );
}

export function toggleDevice(roomId: string, device: Light): void {
  if (device.domain === 'light' || !device.domain) return toggleLight(roomId, device.id);
  const cur = runtime.merged(device.entityId) as SwitchValue | undefined;
  const next: SwitchValue = { on: !cur?.on };
  // cover kennt kein turn_on/off — HA-Service ist open/close (docs/04-Semantik);
  // switch/fan/input_boolean schalten in ihrer eigenen Domäne.
  const service = device.domain === 'cover'
    ? (next.on ? 'open_cover' : 'close_cover')
    : (next.on ? 'turn_on' : 'turn_off');
  runtime.dispatch(
    { entityId: device.entityId, domain: device.domain, service, data: {}, queuedAt: Date.now() },
    next,
  );
}

/* Nur beim Release (final) — der Slider-Thumb folgt während des Drags dem
   Finger (Slider-Action), erst das Loslassen dispatcht (docs/02 Slider). */
export function setBrightness(roomId: string, lightId: string, pct: number): void {
  const entityId = lightEntityId(roomId, lightId);
  runtime.dispatch(
    { entityId, domain: 'light', service: 'turn_on', data: { brightness_pct: pct }, queuedAt: Date.now() },
    { on: true, brightness: pct } satisfies LightValue,
  );
}

/* Farbtemperatur (Kelvin) — Detail-Ebene. Die Temp-Wahl verlässt den Farbmodus
   (color:null), analog zur HA-color_mode-Exklusivität (docs/04). */
export function setColorTemp(roomId: string, lightId: string, kelvin: number): void {
  const entityId = lightEntityId(roomId, lightId);
  const cur = runtime.merged(entityId) as LightValue;
  runtime.dispatch(
    { entityId, domain: 'light', service: 'turn_on', data: { color_temp_kelvin: kelvin }, queuedAt: Date.now() },
    { ...cur, on: true, colorTemp: kelvin, color: null } satisfies LightValue,
  );
}

/** '#rrggbb' → [r,g,b] für den HA-Service-Call. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

/* Farbe (Hex) — Detail-Ebene. Setzt den Farbmodus (überlagert nur on/color;
   colorTemp bleibt als letzter Wert im Server-State erhalten, docs/02). */
export function setColor(roomId: string, lightId: string, hex: string): void {
  const entityId = lightEntityId(roomId, lightId);
  runtime.dispatch(
    { entityId, domain: 'light', service: 'turn_on', data: { rgb_color: hexToRgb(hex) }, queuedAt: Date.now() },
    { on: true, color: hex } as LightValue,
  );
}

export function stepTarget(roomId: string, delta: number): void {
  const entityId = climateEntityId(roomId);
  if (!entityId) return;
  const cur = runtime.merged(entityId) as ClimateValue;
  setTarget(roomId, cur.target + delta);
}

/* Absolute Zieltemperatur (16–26 °C) — Basis für Einzel-Stepper UND die
   zentrale Synchron-Steuerung (B-13), die denselben Wert auf alle Klima-Räume
   schreibt. Gleiche optimistische Dispatch-Semantik wie stepTarget. */
export function setTarget(roomId: string, value: number): void {
  const entityId = climateEntityId(roomId);
  if (!entityId) return;
  setClimateTarget(entityId, value);
}

export function setHvac(roomId: string, mode: ClimateValue['hvac']): void {
  const entityId = climateEntityId(roomId);
  if (!entityId) return;
  setClimateHvac(entityId, mode);
}

/* ── Entity-basierte Varianten (Overlay-Kategorien temp/media): Kachel-Geräte
   adressieren ihre entity_id direkt, ohne die roomId→climateEntityId-Map des
   Raum-Seeds. Frisch eingeblendete Geräte können noch keinen Wert haben
   (merged → undefined) — die Defaults halten den Dispatch trotzdem valide. */
export function devicePending(entityId: string): boolean {
  return runtime.intentStatus(entityId) === 'pending';
}

export function deviceReconcile(entityId: string): ReconcileEvent | null {
  return runtime.reconcileEvent(entityId);
}

export function setClimateTarget(entityId: string, value: number): void {
  const cur = runtime.merged(entityId) as ClimateValue | undefined;
  const target = Math.min(26, Math.max(16, value));
  if (target === cur?.target) return;
  runtime.dispatch(
    { entityId, domain: 'climate', service: 'set_temperature', data: { temperature: target }, queuedAt: Date.now() },
    { hvac: cur?.hvac ?? 'heat', ...cur, target } satisfies ClimateValue,
  );
}

export function setClimateHvac(entityId: string, mode: ClimateValue['hvac']): void {
  const cur = runtime.merged(entityId) as ClimateValue | undefined;
  if (cur?.hvac === mode) return;
  runtime.dispatch(
    { entityId, domain: 'climate', service: 'set_hvac_mode', data: { hvac_mode: mode }, queuedAt: Date.now() },
    { target: cur?.target ?? 20, ...cur, hvac: mode } satisfies ClimateValue,
  );
}

/* Media (Stufe 1, Overlay-Kategorie media): Play/Pause + Lautstärke als
   optimistischer Teil-Patch — Metadaten (track/artist) bleiben Server-Wahrheit
   (Muster aus state/media.svelte.ts, nur ohne playerId-Mapping). */
export function toggleMediaEntity(entityId: string): void {
  const cur = runtime.merged(entityId) as MediaValue | undefined;
  runtime.dispatch(
    { entityId, domain: 'media_player', service: 'media_play_pause', data: {}, queuedAt: Date.now() },
    { playing: !cur?.playing },
  );
}

export function setMediaVolume(entityId: string, pct: number): void {
  runtime.dispatch(
    { entityId, domain: 'media_player', service: 'volume_set', data: { volume_level: pct / 100 }, queuedAt: Date.now() },
    { volume: pct },
  );
}

export function shouldConfirmHomeOff(now: Date, before: string | null): boolean {
  if (!before) return false;
  const [hours, minutes] = before.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return false;
  return now.getHours() * 60 + now.getMinutes() < hours * 60 + minutes;
}

export function turnOffHomeExceptBedroom(): void {
  runtime.dispatch(
    { entityId: HOME_OFF_SCRIPT_ENTITY, domain: 'script', service: 'turn_on', data: {}, queuedAt: Date.now() },
    { on: true } satisfies SwitchValue,
  );
}

export function vacationModeActive(): boolean {
  return Boolean((runtime.merged(VACATION_MODE_ENTITY) as SwitchValue | undefined)?.on);
}

export function toggleVacationMode(): void {
  const next = !vacationModeActive();
  runtime.dispatch(
    {
      entityId: VACATION_MODE_ENTITY,
      domain: 'switch',
      service: next ? 'turn_on' : 'turn_off',
      data: {},
      queuedAt: Date.now(),
    },
    { on: next } satisfies SwitchValue,
  );
}
