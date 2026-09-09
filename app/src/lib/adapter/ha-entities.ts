/* ============================================
   HA-Entity-Übersetzung (ADR-018) — die reine, framework-arme Hälfte des
   HaBackend: (1) das kompakte `subscribe_entities`-Diff-Format auf einen rohen
   Entity-Cache anwenden, (2) Roh-Entity (state + attributes) → unsere
   Value-Shapes (LightValue/ClimateValue/MediaValue, unverändert aus ADR-017).
   Ohne WebSocket-/Framework-Bezug → per Unit-Test abgesichert (ha-entities.test).
   ============================================ */

import type {
  AlarmValue, ButtonValue, CameraValue, CoverValue, FanValue, HumidifierValue, HvacMode, LightValue, LockValue,
  ClimateValue, MediaValue, MowerValue, NumberValue, PersonValue, SelectValue, SunValue, SensorValue, SwitchValue,
  VacuumValue, WaterHeaterValue,
} from './types.ts';

/* Roher HA-Entity-Zustand, wie ihn `subscribe_entities` transportiert. */
export interface RawEntity {
  state: string;
  attributes: Record<string, unknown>;
  /** `subscribe_entities.lc`: Unix-Zeit in Sekunden. Intern immer Millisekunden. */
  changedAt?: number;
}

export interface LaundryRawState {
  state: string;
  changedAt?: number;
  lastTriggered?: string;
}

/* Kompaktes Diff-Format von HA `subscribe_entities` (websocket_api):
   `a` = added (voller Zustand), `c` = changed (Delta mit `+`/`-`), `r` = removed. */
export interface EntitiesDiff {
  a?: Record<string, { s?: string; a?: Record<string, unknown>; lc?: number }>;
  c?: Record<string, {
    '+'?: { s?: string; a?: Record<string, unknown>; lc?: number };
    '-'?: { a?: string[] | Record<string, unknown> };
  }>;
  r?: Record<string, unknown> | string[];
}

/* Wendet ein Diff auf den Roh-Cache an und liefert die geänderten entity_ids
   zurück (auch entfernte — der Aufrufer prüft dann has()). `a` ersetzt voll,
   `c` merged Attribut-Deltas (`+` setzt/überschreibt, `-` entfernt Keys). */
export function applyEntitiesDiff(cache: Map<string, RawEntity>, diff: EntitiesDiff): string[] {
  const changed: string[] = [];

  if (diff.a) {
    for (const [id, e] of Object.entries(diff.a)) {
      cache.set(id, {
        state: e.s ?? '',
        attributes: { ...(e.a ?? {}) },
        ...(typeof e.lc === 'number' ? { changedAt: e.lc * 1000 } : {}),
      });
      changed.push(id);
    }
  }

  if (diff.c) {
    for (const [id, delta] of Object.entries(diff.c)) {
      const cur = cache.get(id) ?? { state: '', attributes: {} };
      let state = cur.state;
      let changedAt = cur.changedAt;
      const attributes = { ...cur.attributes };
      const plus = delta['+'];
      if (plus) {
        if (typeof plus.s === 'string') state = plus.s;
        if (typeof plus.lc === 'number') changedAt = plus.lc * 1000;
        if (plus.a) for (const [k, v] of Object.entries(plus.a)) attributes[k] = v;
      }
      const minus = delta['-'];
      if (minus?.a) {
        const keys = Array.isArray(minus.a) ? minus.a : Object.keys(minus.a);
        for (const k of keys) delete attributes[k];
      }
      cache.set(id, { state, attributes, ...(changedAt !== undefined ? { changedAt } : {}) });
      changed.push(id);
    }
  }

  if (diff.r) {
    const ids = Array.isArray(diff.r) ? diff.r : Object.keys(diff.r);
    for (const id of ids) {
      cache.delete(id);
      changed.push(id);
    }
  }

  return changed;
}

/* ── Roh-Entity → Value-Shape (ADR-018 §4) ──
   HA-Konventionen: Licht-`brightness` ist 0–255 (Attribut fehlt, wenn aus) —
   wir tragen 0–100 %. `prev*` hält den letzten sinnvollen Wert, wenn HA das
   Attribut im Aus-Zustand weglässt (Slider springt nicht auf 0). */

/* HA-color_mode-Werte, die eine echte Farbe tragen (vs. 'color_temp'/'brightness'). */
const COLOR_MODES = new Set(['hs', 'rgb', 'rgbw', 'rgbww', 'xy']);

/** Mireds → Kelvin (HA-Legacy-Attribut `color_temp`). */
export function miredToKelvin(mired: number): number {
  return Math.round(1e6 / mired);
}

/** [r,g,b] → '#rrggbb' (clamped). */
export function rgbToHex(rgb: readonly number[]): string {
  return '#' + rgb.slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('');
}

/* `prev` (letzter sinnvoller Wert) deckt HA's Auslassen der Attribute im
   Aus-Zustand ab — Helligkeit/Farbe/Temperatur springen dann nicht auf 0/schwarz.
   colorTemp/color bleiben undefined, wenn das Gerät sie nie meldet — die UI
   gated ohnehin über die statischen Fähigkeits-Flags (Light-Meta). */
export function haToLight(raw: RawEntity, prev?: Partial<LightValue>): LightValue {
  const bri = raw.attributes.brightness;
  const brightness = typeof bri === 'number'
    ? Math.round((bri / 255) * 100)
    : (prev?.brightness ?? 0);
  const v: LightValue = { on: raw.state === 'on', brightness };

  // Farbtemperatur: bevorzugt das Kelvin-Attribut, sonst Mireds umrechnen.
  const k = raw.attributes.color_temp_kelvin;
  const mired = raw.attributes.color_temp;
  if (typeof k === 'number') v.colorTemp = k;
  else if (typeof mired === 'number') v.colorTemp = miredToKelvin(mired);
  else if (prev?.colorTemp !== undefined) v.colorTemp = prev.colorTemp;

  // Farbe: nur im Farbmodus ein Hex; im 'color_temp'-Modus explizit null (Weiß).
  const mode = raw.attributes.color_mode;
  const rgb = raw.attributes.rgb_color;
  if (typeof mode === 'string' && COLOR_MODES.has(mode) && Array.isArray(rgb)) {
    v.color = rgbToHex(rgb as number[]);
  } else if (mode === 'color_temp') {
    v.color = null;
  } else if (prev?.color !== undefined) {
    v.color = prev.color;
  }
  return v;
}

const HVAC_MODES = new Set<HvacMode>(['heat', 'cool', 'off', 'heat_cool', 'auto', 'dry', 'fan_only']);

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function features(raw: RawEntity): number {
  const f = raw.attributes.supported_features;
  return typeof f === 'number' ? f : 0;
}

export function haToClimate(raw: RawEntity): ClimateValue {
  const a = raw.attributes;
  const t = a.temperature;
  const target = typeof t === 'number' ? t : 20;
  const hvac: ClimateValue['hvac'] = HVAC_MODES.has(raw.state as HvacMode) ? (raw.state as HvacMode) : 'off';
  const v: ClimateValue = { target, hvac };
  // Ist-Temperatur (read-only): nur übernehmen, wenn die Entität sie meldet —
  // sonst bleibt `current` undefined und die Anzeige greift auf den nächsten
  // Fallback zurück (roomTemperature()).
  const c = a.current_temperature;
  if (typeof c === 'number') v.current = c;
  // Zusatzmodi und Grenzen (R28): nur, was das Thermostat selbst meldet.
  const hvacModes = stringList(a.hvac_modes).filter((mode): mode is HvacMode => HVAC_MODES.has(mode as HvacMode));
  if (hvacModes.length) v.hvacModes = hvacModes;
  const fanModes = stringList(a.fan_modes);
  if (fanModes.length) { v.fanModes = fanModes; v.fanMode = typeof a.fan_mode === 'string' ? a.fan_mode : null; }
  const presetModes = stringList(a.preset_modes);
  if (presetModes.length) { v.presetModes = presetModes; v.presetMode = typeof a.preset_mode === 'string' ? a.preset_mode : null; }
  const swingModes = stringList(a.swing_modes);
  if (swingModes.length) { v.swingModes = swingModes; v.swingMode = typeof a.swing_mode === 'string' ? a.swing_mode : null; }
  const minTemp = num(a.min_temp);
  const maxTemp = num(a.max_temp);
  if (minTemp !== null && maxTemp !== null && minTemp < maxTemp) { v.minTemp = minTemp; v.maxTemp = maxTemp; }
  return v;
}

export function haToSwitch(raw: RawEntity): SwitchValue {
  return { on: raw.state === 'on', ...(raw.changedAt !== undefined ? { changedAt: raw.changedAt } : {}) };
}

/** Laundry adapters consume Home Assistant's state verbatim. The configured
 * entity ID, not the domain or a guessed state shape, selects this path. */
export function haToLaundryState(raw: RawEntity): LaundryRawState {
  const lastTriggered = raw.attributes.last_triggered;
  return {
    state: raw.state,
    ...(raw.changedAt !== undefined ? { changedAt: raw.changedAt } : {}),
    ...(typeof lastTriggered === 'string' ? { lastTriggered } : {}),
  };
}

/* cover.* (R28): open/opening/closed/closing plus Position und Neigung.
   Bitmaske CoverEntityFeature: OPEN=1, CLOSE=2, SET_POSITION=4, STOP=8,
   OPEN_TILT=16, CLOSE_TILT=32, STOP_TILT=64, SET_TILT_POSITION=128. Ohne
   Maske verrät sich die Fähigkeit über das Attribut (Oder-Fallback wie fan). */
export function haToCover(raw: RawEntity): CoverValue {
  const a = raw.attributes;
  const f = features(raw);
  const position = num(a.current_position);
  const tilt = num(a.current_tilt_position);
  const hasMask = f !== 0;
  return {
    on: raw.state === 'open' || raw.state === 'opening',
    position: position !== null ? Math.min(100, Math.max(0, Math.round(position))) : (raw.state === 'closed' || raw.state === 'closing' ? 0 : 100),
    tilt: tilt !== null ? Math.min(100, Math.max(0, Math.round(tilt))) : 0,
    moving: raw.state === 'opening' || raw.state === 'closing' ? raw.state : null,
    supportsOpen: !hasMask || (f & 1) !== 0,
    supportsClose: !hasMask || (f & 2) !== 0,
    supportsStop: (f & 8) !== 0,
    supportsPosition: (f & 4) !== 0 || position !== null,
    supportsTilt: (f & 128) !== 0 || tilt !== null,
  };
}

/* valve.* (R28): dieselbe Form wie cover, ohne Neigung. ValveEntityFeature:
   OPEN=1, CLOSE=2, SET_POSITION=4, STOP=8. */
export function haToValve(raw: RawEntity): CoverValue {
  const a = raw.attributes;
  const f = features(raw);
  const position = num(a.current_position);
  const hasMask = f !== 0;
  return {
    on: raw.state === 'open' || raw.state === 'opening',
    position: position !== null ? Math.min(100, Math.max(0, Math.round(position))) : (raw.state === 'closed' || raw.state === 'closing' ? 0 : 100),
    tilt: 0,
    moving: raw.state === 'opening' || raw.state === 'closing' ? raw.state : null,
    supportsOpen: !hasMask || (f & 1) !== 0,
    supportsClose: !hasMask || (f & 2) !== 0,
    supportsStop: (f & 8) !== 0,
    supportsPosition: (f & 4) !== 0 || position !== null,
    supportsTilt: false,
  };
}

/* vacuum.* (R28): state cleaning/returning/paused/docked/idle/error.
   VacuumEntityFeature: PAUSE=4, STOP=8, RETURN_HOME=16, FAN_SPEED=32,
   BATTERY=64, LOCATE=512, START=8192 (TURN_ON/OFF=1/2 sind veraltet). */
export function haToVacuum(raw: RawEntity): VacuumValue {
  const a = raw.attributes;
  const f = features(raw);
  const fanSpeeds = stringList(a.fan_speed_list);
  const battery = num(a.battery_level);
  const hasMask = f !== 0;
  return {
    on: raw.state === 'cleaning' || raw.state === 'returning',
    state: raw.state,
    fanSpeed: typeof a.fan_speed === 'string' ? a.fan_speed : null,
    battery: battery !== null ? Math.min(100, Math.max(0, Math.round(battery))) : null,
    fanSpeeds,
    supportsStart: !hasMask || (f & 8192) !== 0 || (f & 1) !== 0,
    supportsPause: (f & 4) !== 0,
    supportsStop: (f & 8) !== 0,
    supportsReturn: !hasMask || (f & 16) !== 0,
    supportsLocate: (f & 512) !== 0,
    supportsFanSpeed: (f & 32) !== 0 || fanSpeeds.length > 0,
  };
}

/* lock.* (R28): locked/unlocked/locking/unlocking/jammed/open.
   LockEntityFeature.OPEN=1 = Türöffner. */
export function haToLock(raw: RawEntity): LockValue {
  return {
    locked: raw.state === 'locked' || raw.state === 'locking',
    state: raw.state,
    supportsOpen: (features(raw) & 1) !== 0,
  };
}

/* humidifier.* (R28): HumidifierEntityFeature.MODES=1. */
export function haToHumidifier(raw: RawEntity): HumidifierValue {
  const a = raw.attributes;
  const modes = stringList(a.available_modes);
  const min = num(a.min_humidity) ?? 0;
  const max = num(a.max_humidity) ?? 100;
  return {
    on: raw.state === 'on',
    target: num(a.humidity) ?? 50,
    mode: typeof a.mode === 'string' ? a.mode : null,
    current: num(a.current_humidity),
    modes,
    minHumidity: min < max ? min : 0,
    maxHumidity: min < max ? max : 100,
    supportsModes: (features(raw) & 1) !== 0 || modes.length > 0,
  };
}

/* water_heater.* (R28): WaterHeaterEntityFeature TARGET_TEMPERATURE=1,
   OPERATION_MODE=2, AWAY_MODE=4, ON_OFF=8. Der state ist die Betriebsart. */
export function haToWaterHeater(raw: RawEntity): WaterHeaterValue {
  const a = raw.attributes;
  const f = features(raw);
  const modes = stringList(a.operation_list);
  const min = num(a.min_temp) ?? 30;
  const max = num(a.max_temp) ?? 70;
  const mode = typeof a.operation_mode === 'string' ? a.operation_mode : raw.state || null;
  return {
    on: raw.state !== 'off' && raw.state !== 'unavailable' && raw.state !== 'unknown',
    target: num(a.temperature) ?? 50,
    mode,
    current: num(a.current_temperature),
    modes,
    minTemp: min < max ? min : 30,
    maxTemp: min < max ? max : 70,
    supportsTarget: (f & 1) !== 0 || num(a.temperature) !== null,
    supportsModes: (f & 2) !== 0 || modes.length > 0,
    supportsOnOff: (f & 8) !== 0,
  };
}

/* lawn_mower.* (R28): mowing/docked/paused/error. LawnMowerEntityFeature
   START_MOWING=1, PAUSE=2, DOCK=4. */
export function haToMower(raw: RawEntity): MowerValue {
  const f = features(raw);
  const hasMask = f !== 0;
  return {
    on: raw.state === 'mowing',
    state: raw.state,
    supportsStart: !hasMask || (f & 1) !== 0,
    supportsPause: (f & 2) !== 0,
    supportsDock: !hasMask || (f & 4) !== 0,
  };
}

/* alarm_control_panel.* (R28): AlarmControlPanelEntityFeature ARM_HOME=1,
   ARM_AWAY=2, ARM_NIGHT=4, ARM_CUSTOM_BYPASS=16, ARM_VACATION=32. */
export function haToAlarm(raw: RawEntity): AlarmValue {
  const a = raw.attributes;
  const f = features(raw);
  return {
    state: raw.state,
    codeFormat: a.code_format === 'number' || a.code_format === 'text' ? a.code_format : null,
    codeArmRequired: a.code_arm_required !== false,
    supportsArmHome: (f & 1) !== 0,
    supportsArmAway: (f & 2) !== 0,
    supportsArmNight: (f & 4) !== 0,
    supportsArmVacation: (f & 32) !== 0,
    supportsArmCustom: (f & 16) !== 0,
  };
}

/* number.* / input_number.* (R28): Wert im state, Grenzen in den Attributen. */
export function haToNumber(raw: RawEntity): NumberValue {
  const a = raw.attributes;
  const min = num(a.min) ?? 0;
  const max = num(a.max) ?? 100;
  const step = num(a.step);
  const n = Number(raw.state);
  return {
    value: raw.state === '' || raw.state === 'unavailable' || raw.state === 'unknown' || Number.isNaN(n) ? null : n,
    min: min < max ? min : 0,
    max: min < max ? max : 100,
    step: step !== null && step > 0 ? step : 1,
    unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : null,
  };
}

/* select.* / input_select.* (R28): Option im state, Liste in `options`. */
export function haToSelect(raw: RawEntity): SelectValue {
  const options = stringList(raw.attributes.options);
  return {
    option: options.includes(raw.state) ? raw.state : null,
    options,
  };
}

/* button.* / input_button.* (R28): der state ist der Zeitstempel des letzten
   Drucks (ISO), `unknown` vor dem ersten. */
export function haToButton(raw: RawEntity): ButtonValue {
  const ts = Date.parse(raw.state);
  return { pressedAt: Number.isNaN(ts) ? null : ts };
}

/* fan.* (docs/04): Ventilatoren tragen neben an/aus bis zu vier steuerbare
   Eigenschaften. Welche davon das Gerät kann, steht in der Bitmaske
   `supported_features` (SET_SPEED=1, OSCILLATE=2, DIRECTION=4, PRESET_MODE=8).
   Integrationen, die die Maske nicht melden, verraten sich über das jeweilige
   Attribut — deshalb der Oder-Fallback. Nicht unterstützte Abschnitte bleiben
   im Overlay weg, statt einen toten Regler zu zeigen (R3, docs/23). */
const FAN_SET_SPEED = 1;
const FAN_OSCILLATE = 2;
const FAN_DIRECTION = 4;
const FAN_PRESET_MODE = 8;

export function haToFan(raw: RawEntity): FanValue {
  const a = raw.attributes;
  const features = typeof a.supported_features === 'number' ? a.supported_features : 0;
  const hasPercentage = typeof a.percentage === 'number';
  const presetModes = Array.isArray(a.preset_modes)
    ? a.preset_modes.filter((mode): mode is string => typeof mode === 'string')
    : [];
  return {
    on: raw.state === 'on',
    percentage: hasPercentage ? Math.min(100, Math.max(0, Math.round(a.percentage as number))) : 0,
    presetMode: typeof a.preset_mode === 'string' ? a.preset_mode : null,
    oscillating: a.oscillating === true,
    direction: a.direction === 'reverse' ? 'reverse' : 'forward',
    presetModes,
    supportsSpeed: (features & FAN_SET_SPEED) !== 0 || hasPercentage,
    supportsPreset: (features & FAN_PRESET_MODE) !== 0 || presetModes.length > 0,
    supportsOscillate: (features & FAN_OSCILLATE) !== 0 || typeof a.oscillating === 'boolean',
    supportsDirection: (features & FAN_DIRECTION) !== 0 || typeof a.direction === 'string',
  };
}

export function haToMedia(raw: RawEntity, prevVolume?: number): MediaValue {
  const vol = raw.attributes.volume_level;
  const dur = raw.attributes.media_duration;
  const src = raw.attributes.source;
  const title = raw.attributes.media_title;
  const artist = raw.attributes.media_artist;
  return {
    playing: raw.state === 'playing',
    volume: typeof vol === 'number' ? Math.round(vol * 100) : (prevVolume ?? 0),
    source: typeof src === 'string' ? src : null,
    available: raw.state !== 'unavailable',
    track: typeof title === 'string' ? title : null,
    artist: typeof artist === 'string' ? artist : null,
    duration: typeof dur === 'number' ? dur : 0,
  };
}

/* ── Read-only-Domänen (ADR-018): kein Overlay, plain-reaktiv. ──
   `sun.sun` trägt state `above_horizon`/`below_horizon`; Sensoren tragen den
   Messwert im state + `unit_of_measurement`. Nicht-numerisch/unavailable →
   value null (die UI zeigt dann „—" bzw. lässt den Node inaktiv). */
export function haToSun(raw: RawEntity): SunValue {
  const elevation = raw.attributes.elevation;
  return {
    day: raw.state === 'above_horizon',
    elevation: typeof elevation === 'number' && Number.isFinite(elevation) ? elevation : null,
  };
}

/* Anwesenheit (Paket 8): alles außer `home` gilt als unterwegs — Zonen wie
   `Arbeit` sind für die Begrüßung dasselbe wie `not_home`. */
export function haToPerson(raw: RawEntity): PersonValue {
  const name = raw.attributes.friendly_name;
  return {
    home: raw.state === 'home',
    name: typeof name === 'string' && name ? name : null,
  };
}

export function haToSensor(raw: RawEntity): SensorValue {
  const n = Number(raw.state);
  const value = raw.state === '' || raw.state === 'unavailable' || raw.state === 'unknown' || Number.isNaN(n)
    ? null
    : n;
  const unit = typeof raw.attributes.unit_of_measurement === 'string'
    ? raw.attributes.unit_of_measurement
    : null;
  return { value, unit };
}

export function haToCamera(raw: RawEntity): CameraValue {
  const picture = raw.attributes.entity_picture;
  return {
    available: raw.state !== 'unavailable',
    entityPicture: typeof picture === 'string' ? picture : null,
  };
}

/* Domänen-Routing über das entity_id-Präfix (ADR-018 §4). `undefined` =
   ungemappte Domäne (landet nicht im Store). Steuerbare Domänen laufen durchs
   Overlay; read-only-Domänen (sun/sensor) fließen ohne Intent durch. */
export function haToValue(entityId: string, raw: RawEntity, prev?: unknown): unknown {
  if (entityId.startsWith('light.')) {
    return haToLight(raw, prev as Partial<LightValue> | undefined);
  }
  if (entityId.startsWith('fan.')) {
    return haToFan(raw);
  }
  if (entityId.startsWith('switch.') || entityId.startsWith('input_boolean.')
      || entityId.startsWith('siren.') || entityId.startsWith('remote.')) {
    return haToSwitch(raw);
  }
  if (entityId.startsWith('valve.')) return haToValve(raw);
  if (entityId.startsWith('lock.')) return haToLock(raw);
  if (entityId.startsWith('humidifier.')) return haToHumidifier(raw);
  if (entityId.startsWith('water_heater.')) return haToWaterHeater(raw);
  if (entityId.startsWith('lawn_mower.')) return haToMower(raw);
  if (entityId.startsWith('alarm_control_panel.')) return haToAlarm(raw);
  if (entityId.startsWith('number.') || entityId.startsWith('input_number.')) return haToNumber(raw);
  if (entityId.startsWith('select.') || entityId.startsWith('input_select.')) return haToSelect(raw);
  if (entityId.startsWith('button.') || entityId.startsWith('input_button.')) return haToButton(raw);
  if (entityId.startsWith('binary_sensor.')) {
    return haToSwitch(raw); // on/off-Zustand, read-only (info-Kategorie)
  }
  if (entityId.startsWith('cover.')) {
    return haToCover(raw);
  }
  if (entityId.startsWith('vacuum.')) {
    return haToVacuum(raw);
  }
  if (entityId.startsWith('climate.')) {
    return haToClimate(raw);
  }
  if (entityId.startsWith('media_player.')) {
    return haToMedia(raw, (prev as MediaValue | undefined)?.volume);
  }
  if (entityId === 'sun.sun') {
    return haToSun(raw);
  }
  if (entityId.startsWith('person.')) {
    return haToPerson(raw);
  }
  if (entityId.startsWith('sensor.')) {
    return haToSensor(raw);
  }
  if (entityId.startsWith('camera.')) {
    return haToCamera(raw);
  }
  return undefined;
}
