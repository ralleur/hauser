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
  presenceEntityIds,
  tempSensorEntityId,
  VACATION_MODE_ENTITY,
  windowEntityIds,
} from './entities.ts';
import type {
  AlarmValue, CoverValue, FanValue, LightValue, ClimateValue, LockValue, MediaValue, ReconcileEvent, SwitchValue, SensorValue,
  VacuumValue,
} from '../adapter/types.ts';
import { appState, type Light } from './app.svelte.ts';

type RoomMetric = 'temperature' | 'humidity';
let roomSensorResolver: ((roomId: string, metric: RoomMetric) => string) | null = null;

export function setRoomSensorResolver(resolver: (roomId: string, metric: RoomMetric) => string): void {
  roomSensorResolver = resolver;
}

/* Kontakte/Melder eines Raums kommen aus zwei Quellen: den Rollen `window`/
   `presence` der Haushalts-Config und der gerätelokalen Raum-Konfig. Letztere
   liegt in room-display-config, das seinerseits hierher importiert — deshalb
   derselbe Resolver-Trick wie beim Temperatursensor. */
export type RoomContactKind = 'window' | 'presence';
let roomContactResolver: ((roomId: string, kind: RoomContactKind) => readonly string[]) | null = null;

export function setRoomContactResolver(
  resolver: (roomId: string, kind: RoomContactKind) => readonly string[],
): void {
  roomContactResolver = resolver;
}

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
  // Im Raum-Overlay konfigurierter bzw. aus HA übernommener Sensor hat Vorrang.
  const configured = roomSensorResolver?.(roomId, 'temperature') ?? '';
  const sensorId = configured || tempSensorEntityId(roomId);
  if (sensorId) {
    const s = runtime.merged(sensorId) as SensorValue | undefined;
    if (s && typeof s.value === 'number') return s.value;
  }
  const climate = mergedClimate(roomId);
  if (climate && typeof climate.current === 'number') return climate.current;
  return null;
}

/* Luftfeuchte eines Raums: nur aus einem Sensor — Thermostate melden sie
   nicht verlässlich. null, wenn keiner zugeordnet ist oder er nichts liefert. */
export function roomHumidity(roomId: string): number | null {
  const sensorId = roomSensorResolver?.(roomId, 'humidity') ?? '';
  if (!sensorId) return null;
  const s = runtime.merged(sensorId) as SensorValue | undefined;
  return s && typeof s.value === 'number' ? s.value : null;
}

/* ── Fenster/Tür und Bewegung (docs/06 §5) ──
   Ein Kontakt gilt als offen, wenn sein binary_sensor `on` meldet. `known`
   bleibt false, solange kein Echo da ist — die Detail-Liste zeigt das an,
   statt „geschlossen" zu behaupten. */
export interface RoomContact {
  entityId: string;
  open: boolean;
  known: boolean;
}

/* Der Resolver kennt die Rollen der Haushalts-Config UND die Auswahl aus den
   Einstellungen — er entscheidet allein, damit ein abgewählter Sensor wirklich
   verschwindet. Ohne ihn (Tests, isolierte Runtimes) zählen die Rollen. */
function contactIds(roomId: string, kind: RoomContactKind): string[] {
  const resolved = roomContactResolver?.(roomId, kind);
  const configured = kind === 'window' ? windowEntityIds(roomId) : presenceEntityIds(roomId);
  return [...new Set(resolved ?? configured)];
}

export function roomContacts(roomId: string, kind: RoomContactKind = 'window'): RoomContact[] {
  return contactIds(roomId, kind).map((entityId) => {
    const value = runtime.merged(entityId) as SwitchValue | undefined;
    return { entityId, open: value?.on === true, known: value !== undefined };
  });
}

/* `fallback` gilt, solange dem Raum kein Kontakt zugeordnet ist — dann zählt
   weiter der Seed-Wert (Demo, Legacy-Fixtures). */
export function roomWindowOpen(roomId: string, fallback = false): boolean {
  const contacts = roomContacts(roomId, 'window');
  return contacts.length === 0 ? fallback : contacts.some((contact) => contact.open);
}

export function roomPresence(roomId: string, fallback = false): boolean {
  const contacts = roomContacts(roomId, 'presence');
  return contacts.length === 0 ? fallback : contacts.some((contact) => contact.open);
}

export function lightPending(roomId: string, lightId: string): boolean {
  return runtime.intentStatus(lightEntityId(roomId, lightId)) === 'pending';
}

export function lightUnconfirmed(roomId: string, lightId: string): boolean {
  return runtime.intentStatus(lightEntityId(roomId, lightId)) === 'unconfirmed';
}

export function climateUnconfirmed(roomId: string): boolean {
  const eid = climateEntityId(roomId);
  if (!eid) return false;
  return runtime.intentStatus(eid) === 'unconfirmed';
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
  const domain = device.domain;
  // Domänen mit eigenem Service-Satz (R28): der Tap auf die Kachel ist die
  // Hauptaktion, die Detail-Ebene kennt den Rest.
  if (domain === 'cover' || domain === 'valve') {
    const cur = runtime.merged(device.entityId) as CoverValue | undefined;
    return coverCommand(device.entityId, domain, cur?.on ? 'close' : 'open');
  }
  if (domain === 'vacuum') {
    const cur = runtime.merged(device.entityId) as VacuumValue | undefined;
    return vacuumCommand(device.entityId, cur?.on ? 'return_to_base' : 'start');
  }
  if (domain === 'lawn_mower') {
    const cur = runtime.merged(device.entityId) as { on?: boolean } | undefined;
    return mowerCommand(device.entityId, cur?.on ? 'dock' : 'start_mowing');
  }
  if (domain === 'lock') {
    const cur = runtime.merged(device.entityId) as LockValue | undefined;
    return lockCommand(device.entityId, cur?.locked ? 'unlock' : 'lock');
  }
  if (domain === 'button' || domain === 'input_button') return pressButton(device.entityId, domain);
  const cur = runtime.merged(device.entityId) as SwitchValue | undefined;
  const next: SwitchValue = { on: !cur?.on };
  runtime.dispatch(
    { entityId: device.entityId, domain, service: next.on ? 'turn_on' : 'turn_off', data: {}, queuedAt: Date.now() },
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

/* Konfidenz (Paket 6): eine Sekunde ohne State-Echo. Das Control pulsiert
   daraufhin einmal — der Wert bleibt optimistisch stehen. */
export function deviceUnconfirmed(entityId: string): boolean {
  return runtime.intentStatus(entityId) === 'unconfirmed';
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

/* Ventilator (fan-Domäne): jede Eigenschaft ist ein eigener HA-Service und
   ein eigener Teil-Patch — die supports*-Flags und presetModes bleiben
   Server-Wahrheit und werden nicht mitgeraten (ADR-017 Addendum). */
export function setFanPercentage(entityId: string, pct: number): void {
  const percentage = Math.min(100, Math.max(0, Math.round(pct)));
  runtime.dispatch(
    { entityId, domain: 'fan', service: 'set_percentage', data: { percentage }, queuedAt: Date.now() },
    { on: percentage > 0, percentage },
  );
}

export function setFanPreset(entityId: string, presetMode: string): void {
  runtime.dispatch(
    { entityId, domain: 'fan', service: 'set_preset_mode', data: { preset_mode: presetMode }, queuedAt: Date.now() },
    { on: true, presetMode },
  );
}

export function setFanOscillating(entityId: string, oscillating: boolean): void {
  runtime.dispatch(
    { entityId, domain: 'fan', service: 'oscillate', data: { oscillating }, queuedAt: Date.now() },
    { oscillating },
  );
}

export function setFanDirection(entityId: string, direction: FanValue['direction']): void {
  runtime.dispatch(
    { entityId, domain: 'fan', service: 'set_direction', data: { direction }, queuedAt: Date.now() },
    { direction },
  );
}

/* ── Klima-Zusatzmodi (R28): Lüfterstufe, Preset, Schwenken ── */
export function setClimateFanMode(entityId: string, fanMode: string): void {
  runtime.dispatch(
    { entityId, domain: 'climate', service: 'set_fan_mode', data: { fan_mode: fanMode }, queuedAt: Date.now() },
    { fanMode },
  );
}
export function setClimatePreset(entityId: string, presetMode: string): void {
  runtime.dispatch(
    { entityId, domain: 'climate', service: 'set_preset_mode', data: { preset_mode: presetMode }, queuedAt: Date.now() },
    { presetMode },
  );
}
export function setClimateSwing(entityId: string, swingMode: string): void {
  runtime.dispatch(
    { entityId, domain: 'climate', service: 'set_swing_mode', data: { swing_mode: swingMode }, queuedAt: Date.now() },
    { swingMode },
  );
}

/* ── Rollo/Jalousie und Ventil (R28) ──
   Auf/Zu/Stopp sind Fahrbefehle: optimistisch wird nur die Richtung
   angenommen, die Endlage meldet das Gerät. */
export function coverCommand(entityId: string, domain: 'cover' | 'valve', action: 'open' | 'close' | 'stop'): void {
  const noun = domain === 'cover' ? 'cover' : 'valve';
  const service = `${action}_${noun}`;
  // Nur die Richtung wird angenommen; ob das Gerät „opening" meldet oder
  // gleich „open", entscheidet es selbst — sonst bliebe der Intent hängen.
  const patch: Partial<CoverValue> = action === 'stop' ? {} : { on: action === 'open' };
  runtime.dispatch({ entityId, domain, service, data: {}, queuedAt: Date.now() }, patch);
}
export function setCoverPosition(entityId: string, domain: 'cover' | 'valve', pct: number): void {
  const position = Math.min(100, Math.max(0, Math.round(pct)));
  const service = domain === 'cover' ? 'set_cover_position' : 'set_valve_position';
  runtime.dispatch(
    { entityId, domain, service, data: { position }, queuedAt: Date.now() },
    { position, on: position > 0 },
  );
}
export function setCoverTilt(entityId: string, pct: number): void {
  const tilt_position = Math.min(100, Math.max(0, Math.round(pct)));
  runtime.dispatch(
    { entityId, domain: 'cover', service: 'set_cover_tilt_position', data: { tilt_position }, queuedAt: Date.now() },
    { tilt: tilt_position },
  );
}

/* ── Staubsauger (R28) ── */
export type VacuumAction = 'start' | 'pause' | 'stop' | 'return_to_base' | 'locate';
export function vacuumCommand(entityId: string, action: VacuumAction): void {
  const patch: Partial<VacuumValue> = action === 'start' ? { on: true, state: 'cleaning' }
    : action === 'pause' ? { state: 'paused' }
    : action === 'stop' ? { on: false }
    : action === 'return_to_base' ? { state: 'returning' }
    : {};
  runtime.dispatch({ entityId, domain: 'vacuum', service: action, data: {}, queuedAt: Date.now() }, patch);
}
export function setVacuumFanSpeed(entityId: string, fanSpeed: string): void {
  runtime.dispatch(
    { entityId, domain: 'vacuum', service: 'set_fan_speed', data: { fan_speed: fanSpeed }, queuedAt: Date.now() },
    { fanSpeed },
  );
}

/* ── Schloss (R28): `open` ist der Türöffner, kein Dauerzustand. ── */
export function lockCommand(entityId: string, action: 'lock' | 'unlock' | 'open'): void {
  const patch: Partial<LockValue> = action === 'lock' ? { locked: true }
    : action === 'unlock' ? { locked: false }
    : {};
  runtime.dispatch({ entityId, domain: 'lock', service: action, data: {}, queuedAt: Date.now() }, patch);
}

/* ── Befeuchter (R28) ── */
export function setHumidifierTarget(entityId: string, pct: number): void {
  const humidity = Math.round(pct);
  runtime.dispatch(
    { entityId, domain: 'humidifier', service: 'set_humidity', data: { humidity }, queuedAt: Date.now() },
    { target: humidity },
  );
}
export function setHumidifierMode(entityId: string, mode: string): void {
  runtime.dispatch(
    { entityId, domain: 'humidifier', service: 'set_mode', data: { mode }, queuedAt: Date.now() },
    { mode },
  );
}

/* ── Warmwasser (R28) ── */
export function setWaterHeaterTarget(entityId: string, value: number): void {
  const temperature = Math.round(value * 2) / 2;
  runtime.dispatch(
    { entityId, domain: 'water_heater', service: 'set_temperature', data: { temperature }, queuedAt: Date.now() },
    { target: temperature },
  );
}
export function setWaterHeaterMode(entityId: string, mode: string): void {
  runtime.dispatch(
    { entityId, domain: 'water_heater', service: 'set_operation_mode', data: { operation_mode: mode }, queuedAt: Date.now() },
    { mode, on: mode !== 'off' },
  );
}
export function setWaterHeaterOn(entityId: string, on: boolean): void {
  runtime.dispatch(
    { entityId, domain: 'water_heater', service: on ? 'turn_on' : 'turn_off', data: {}, queuedAt: Date.now() },
    { on },
  );
}

/* ── Mähroboter (R28) ── */
export function mowerCommand(entityId: string, action: 'start_mowing' | 'pause' | 'dock'): void {
  const patch = action === 'start_mowing' ? { on: true, state: 'mowing' }
    : action === 'pause' ? { state: 'paused' }
    : { on: false };
  runtime.dispatch({ entityId, domain: 'lawn_mower', service: action, data: {}, queuedAt: Date.now() }, patch);
}

/* ── Alarmanlage (R28): der Code geht mit, wenn das Gerät einen verlangt. ── */
export type AlarmAction = 'disarm' | 'arm_home' | 'arm_away' | 'arm_night' | 'arm_vacation' | 'arm_custom_bypass';
export function alarmCommand(entityId: string, action: AlarmAction, code: string | null): void {
  const target = action === 'disarm' ? 'disarmed' : `armed_${action.slice(4)}`;
  const patch: Partial<AlarmValue> = { state: target };
  runtime.dispatch(
    { entityId, domain: 'alarm_control_panel', service: `alarm_${action}`, data: code ? { code } : {}, queuedAt: Date.now() },
    patch,
  );
}

/* ── Zahl, Auswahl, Taster (R28) ── */
export function setNumberValue(entityId: string, domain: 'number' | 'input_number', value: number): void {
  runtime.dispatch(
    { entityId, domain, service: 'set_value', data: { value }, queuedAt: Date.now() },
    { value },
  );
}
export function selectOption(entityId: string, domain: 'select' | 'input_select', option: string): void {
  runtime.dispatch(
    { entityId, domain, service: 'select_option', data: { option }, queuedAt: Date.now() },
    { option },
  );
}
export function pressButton(entityId: string, domain: 'button' | 'input_button'): void {
  runtime.dispatch({ entityId, domain, service: 'press', data: {}, queuedAt: Date.now() }, {});
}

export function shouldConfirmHomeOff(now: Date, before: string | null): boolean {
  if (!before) return false;
  const [hours, minutes] = before.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return false;
  return now.getHours() * 60 + now.getMinutes() < hours * 60 + minutes;
}

export function turnOffHomeExceptBedroom(): void {
  if (!HOME_OFF_SCRIPT_ENTITY) return;
  runtime.dispatch(
    { entityId: HOME_OFF_SCRIPT_ENTITY, domain: 'script', service: 'turn_on', data: {}, queuedAt: Date.now() },
    { on: true } satisfies SwitchValue,
  );
}

/* Alles, was „Alles aus" trifft: die schaltbaren Geräte aller Räume. Ihr
   Schnappschuss ist der Rückweg des Undo-Streifens (Paket 6). */
export function switchableHomeEntityIds(): string[] {
  return appState.rooms.flatMap((room) => room.lights
    .filter((device) => {
      const category = device.category ?? 'light';
      return category === 'light' || category === 'switch' || category === 'fan' || category === 'humidifier';
    })
    .map((device) => device.entityId ?? lightEntityId(room.id, device.id)));
}

export function vacationModeActive(): boolean {
  if (!VACATION_MODE_ENTITY) return false;
  return Boolean((runtime.merged(VACATION_MODE_ENTITY) as SwitchValue | undefined)?.on);
}

export function toggleVacationMode(): void {
  if (!VACATION_MODE_ENTITY) return;
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
