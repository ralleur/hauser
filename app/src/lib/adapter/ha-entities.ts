/* ============================================
   HA-Entity-Übersetzung (ADR-018) — die reine, framework-arme Hälfte des
   HaBackend: (1) das kompakte `subscribe_entities`-Diff-Format auf einen rohen
   Entity-Cache anwenden, (2) Roh-Entity (state + attributes) → unsere
   Value-Shapes (LightValue/ClimateValue/MediaValue, unverändert aus ADR-017).
   Ohne WebSocket-/Framework-Bezug → per Unit-Test abgesichert (ha-entities.test).
   ============================================ */

import type { CameraValue, LightValue, ClimateValue, MediaValue, SunValue, SensorValue, SwitchValue } from './types.ts';

/* Roher HA-Entity-Zustand, wie ihn `subscribe_entities` transportiert. */
export interface RawEntity {
  state: string;
  attributes: Record<string, unknown>;
  /** `subscribe_entities.lc`: Unix-Zeit in Sekunden. Intern immer Millisekunden. */
  changedAt?: number;
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

export function haToClimate(raw: RawEntity): ClimateValue {
  const t = raw.attributes.temperature;
  const target = typeof t === 'number' ? t : 20;
  const hvac: ClimateValue['hvac'] =
    raw.state === 'heat' || raw.state === 'cool' || raw.state === 'off'
      ? raw.state
      : 'off';
  const v: ClimateValue = { target, hvac };
  // Ist-Temperatur (read-only): nur übernehmen, wenn die Entität sie meldet —
  // sonst bleibt `current` undefined und die Anzeige greift auf den nächsten
  // Fallback zurück (roomTemperature()).
  const c = raw.attributes.current_temperature;
  if (typeof c === 'number') v.current = c;
  return v;
}

export function haToSwitch(raw: RawEntity): SwitchValue {
  return { on: raw.state === 'on', ...(raw.changedAt !== undefined ? { changedAt: raw.changedAt } : {}) };
}

/* cover.* trägt open/opening/closed/closing — für die Switch-Kategorie
   (Stufe 1: cover läuft als Toggle) zählt „nicht zu" als an. */
export function haToCover(raw: RawEntity): SwitchValue {
  return { on: raw.state === 'open' || raw.state === 'opening' };
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
  return { day: raw.state === 'above_horizon' };
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
  if (entityId.startsWith('switch.') || entityId.startsWith('fan.') || entityId.startsWith('input_boolean.')) {
    return haToSwitch(raw);
  }
  if (entityId.startsWith('binary_sensor.')) {
    return haToSwitch(raw); // on/off-Zustand, read-only (info-Kategorie)
  }
  if (entityId.startsWith('cover.')) {
    return haToCover(raw);
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
  if (entityId.startsWith('sensor.')) {
    return haToSensor(raw);
  }
  if (entityId.startsWith('camera.')) {
    return haToCamera(raw);
  }
  return undefined;
}
