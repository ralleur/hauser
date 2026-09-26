/* Das Stresshaus: ein Home Assistant, wie es draußen wirklich vorkommt — und
   ein bisschen schlimmer. Jede Zeile hier ist ein Fall, an dem ein Haushalt
   da draußen Hauser zum Stolpern bringen kann: gleiche Namen in zwei Domains
   (Schalter als Licht, Apple TV als media_player und remote), doppelte
   Optionslisten, „unavailable" ohne Attribute, Werte außerhalb jedes Bereichs,
   Serientermine mit gleicher uid, Bereiche mit Umlaut-Zwillingen.

   Zwei Abnehmer: der Invariantentest (`stresshaus.test.ts`) schickt die Daten
   durch Einrichtung und Projektion, der Crawler (`scripts/stresshaus/`) spielt
   sie als Home Assistant aus und klickt die echte App durch. Nur löschbare
   TypeScript-Syntax, damit Node die Datei ohne Build lädt.

   Neue Stolperfallen aus Meldungen gehören hier hinein — ein Fall, der einmal
   einen Nutzer getroffen hat, soll nie wieder durchrutschen. */

export interface HostileState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: { id: string; parent_id: null; user_id: null };
}

export interface HostileRegistryEntry {
  entity_id: string;
  id: string;
  unique_id: string;
  platform: string;
  area_id: string | null;
  device_id: string | null;
  name: string | null;
  original_name: string | null;
  icon: string | null;
  disabled_by: string | null;
  hidden_by: string | null;
  entity_category: string | null;
  has_entity_name: boolean;
}

export interface HostileCalendarEvent {
  start: string;
  end: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  uid?: string | null;
  recurrence_id?: string | null;
  rrule?: string | null;
}

export interface HostileTodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  due?: string;
  description?: string | null;
}

export interface HostileHome {
  config: Record<string, unknown>;
  areas: { area_id: string; name: string; aliases: string[]; floor_id: string | null; icon: string | null; picture: string | null }[];
  devices: { id: string; area_id: string | null; name: string; name_by_user: string | null; manufacturer: string | null; model: string | null }[];
  entities: HostileRegistryEntry[];
  states: HostileState[];
  calendarEvents: Record<string, HostileCalendarEvent[]>;
  /* Kalender, deren Abruf scheitert — Hauser muss die übrigen trotzdem zeigen. */
  failingCalendars: string[];
  todoItems: Record<string, HostileTodoItem[]>;
  forecasts: Record<string, { daily: Record<string, unknown>[]; hourly: Record<string, unknown>[] }>;
  /* Antwort auf `energy/get_prefs`: das Energie-Dashboard, aus dem Hauser die
     Zähler für Woche, Monat und Gesamt nimmt. */
  energyPrefs: Record<string, unknown>;
}

interface RegistryOverrides {
  area_id?: string | null;
  device_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  hidden_by?: string | null;
  disabled_by?: string | null;
  entity_category?: string | null;
}

interface AddOptions {
  /* YAML-Entität: im Zustand, aber ohne Registry-Eintrag. */
  noRegistry?: boolean;
  /* Deaktiviert: in der Registry, aber ohne Zustand. */
  noState?: boolean;
}

const LONG_NAME = 'Ein außerordentlich langer Name, der auf keine Kachel passt und trotzdem irgendwo stehen muss, ohne das Layout zu sprengen — wirklich sehr lang';

function isoDay(base: Date, offsetDays: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function at(base: Date, offsetDays: number, hour: number, minute = 0): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function hostileHome(now: Date = new Date()): HostileHome {
  const changed = new Date(now.getTime() - 3_600_000).toISOString();
  const states: HostileState[] = [];
  const entities: HostileRegistryEntry[] = [];
  let context = 0;

  function add(
    entityId: string,
    state: string,
    attributes: Record<string, unknown>,
    registry: RegistryOverrides = {},
    options: AddOptions = {},
  ): void {
    if (!options.noState) {
      states.push({
        entity_id: entityId,
        state,
        attributes,
        last_changed: changed,
        last_updated: changed,
        context: { id: `ctx${++context}`, parent_id: null, user_id: null },
      });
    }
    if (!options.noRegistry) {
      entities.push({
        entity_id: entityId,
        id: `reg-${entityId}`,
        unique_id: `uid-${entityId}`,
        platform: 'stresshaus',
        area_id: registry.area_id ?? null,
        device_id: registry.device_id ?? null,
        name: registry.name ?? null,
        original_name: registry.original_name === undefined
          ? (typeof attributes.friendly_name === 'string' ? attributes.friendly_name : null)
          : registry.original_name,
        icon: null,
        disabled_by: registry.disabled_by ?? null,
        hidden_by: registry.hidden_by ?? null,
        entity_category: registry.entity_category ?? null,
        has_entity_name: false,
      });
    }
  }

  const areas = [
    ['wohnzimmer', 'Wohnzimmer'],
    // Umlaut-Zwillinge: beide werden nach der Umschrift „kueche".
    ['kuche', 'Küche'],
    ['kueche', 'Kueche'],
    // Gleicher Name bis auf Groß- und Kleinschreibung.
    ['bad', 'Bad'],
    ['bad_2', 'bad'],
    ['buro', 'Büro 🖥️'],
    ['flur', 'Flur'],
    ['flur_2', 'Flur '],
    ['lang', LONG_NAME],
    ['garage', 'Garage'],
    ['wintergarten', 'Wintergarten'],
    ['kinderzimmer', 'Kinderzimmer'],
    ['schlafzimmer', 'Schlafzimmer'],
    ['dachboden', '<b>Dachboden</b>'],
    ['keller', 'Keller'],
    ['technik', 'غرفة التقنية'],
    // Die anderen fünf Sprachen: Ł zerfällt in keiner Umschrift, und jeder
    // dieser Buchstaben muss in Hausers eigener Schrift stehen (R48).
    ['lazienka', 'Łazienka'],
    ['cozinha', 'Cozinha da Avó'],
    ['chambre', 'Chambre d’enfant'],
    ['soggiorno', 'Soggiorno però'],
    ['strasse', 'Straßenseite'],
  ].map(([area_id, name]) => ({ area_id, name, aliases: [], floor_id: null, icon: null, picture: null }));

  const devices = [
    { id: 'dev_appletv', area_id: 'wohnzimmer', name: 'Apple TV', name_by_user: null, manufacturer: 'Apple', model: 'Apple TV 4K' },
    { id: 'dev_wintergarten', area_id: 'wintergarten', name: 'Tür Wintergarten', name_by_user: null, manufacturer: null, model: null },
    { id: 'dev_waermepumpe', area_id: 'wintergarten', name: 'Wärmepumpe', name_by_user: null, manufacturer: null, model: null },
    // Gerät in einem gelöschten Bereich.
    { id: 'dev_verwaist', area_id: 'geloescht', name: 'Verwaist', name_by_user: null, manufacturer: null, model: null },
    { id: 'dev_bad', area_id: 'bad', name: 'Thermostat Bad', name_by_user: 'Heizung', manufacturer: 'Tado', model: null },
  ];

  /* ── Wohnzimmer ── */
  add('light.wohnzimmer_decke', 'on', {
    friendly_name: 'Decke', brightness: 128, color_mode: 'color_temp',
    supported_color_modes: ['color_temp', 'hs'], color_temp_kelvin: 3000, min_color_temp_kelvin: 2202,
    max_color_temp_kelvin: 6535, hs_color: [30, 50], supported_features: 44,
  }, { area_id: 'wohnzimmer' });
  add('light.wohnzimmer_stehlampe', 'on', {
    friendly_name: 'Stehlampe', brightness: null, color_mode: 'onoff', supported_color_modes: ['onoff'],
  }, { area_id: 'wohnzimmer' });
  add('light.wohnzimmer_strip', 'on', {
    friendly_name: 'LED-Streifen', brightness: 255, color_mode: 'xy', supported_color_modes: ['xy'],
    xy_color: [0.3, 0.3], effect_list: ['Regenbogen', 'Regenbogen', 'Kerze'], effect: 'Kerze', supported_features: 4,
  }, { area_id: 'wohnzimmer' });
  // HA-Lichtgruppe mit einem Mitglied, das es nicht gibt.
  add('light.wohnzimmer_gruppe', 'on', {
    friendly_name: 'Alle Lichter', brightness: 200, color_mode: 'brightness', supported_color_modes: ['brightness'],
    entity_id: ['light.wohnzimmer_decke', 'light.wohnzimmer_stehlampe', 'light.gibt_es_nicht'],
  }, { area_id: 'wohnzimmer' });
  // Gleicher Objektname in drei Domains, alle sichtbar im selben Raum.
  add('light.wohnzimmer', 'off', { friendly_name: 'Wohnzimmer', supported_color_modes: ['brightness'], brightness: null }, { area_id: 'wohnzimmer' });
  add('switch.wohnzimmer', 'on', { friendly_name: 'Wohnzimmer' }, { area_id: 'wohnzimmer' });
  add('climate.wohnzimmer', 'heat', {
    friendly_name: 'Wohnzimmer', hvac_modes: ['off', 'heat'], current_temperature: 21.4, temperature: 21,
    min_temp: 7, max_temp: 35, target_temp_step: 0.5, supported_features: 385,
  }, { area_id: 'wohnzimmer' });
  add('sensor.wohnzimmer', '21.4', {
    friendly_name: 'Wohnzimmer', unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement',
  }, { area_id: 'wohnzimmer' });
  // Apple TV: media_player und remote teilen sich den Objektnamen.
  add('media_player.apple_tv', 'playing', {
    friendly_name: 'Apple TV', source_list: ['Netflix', 'Netflix', 'YouTube', 'ARD Mediathek'], source: 'Netflix',
    sound_mode_list: ['Stereo', 'Stereo'], media_title: '🎬 Der Film mit dem sehr langen Titel, der nie aufhört und immer weitergeht',
    media_duration: null, media_position: 12, media_content_type: 'video',
    entity_picture: '/api/media_player_proxy/media_player.apple_tv?token=kaputt', supported_features: 250_000,
  }, { area_id: 'wohnzimmer', device_id: 'dev_appletv' });
  add('remote.apple_tv', 'on', {
    friendly_name: 'Apple TV', activity_list: ['TV', 'TV'], current_activity: 'TV', supported_features: 4,
  }, { device_id: 'dev_appletv' });
  add('media_player.fernseher', 'unavailable', { friendly_name: 'Fernseher', supported_features: 0, restored: true }, { area_id: 'wohnzimmer' });
  add('sensor.wohnzimmer_feuchte', 'unknown', {
    friendly_name: 'Luftfeuchte', unit_of_measurement: '%', device_class: 'humidity', state_class: 'measurement',
  }, { area_id: 'wohnzimmer' });
  add('binary_sensor.wohnzimmer_fenster', 'unavailable', { friendly_name: 'Fenster', device_class: 'window' }, { area_id: 'wohnzimmer' });
  add('binary_sensor.wohnzimmer_praesenz', 'on', { friendly_name: 'Anwesenheit', device_class: 'occupancy' }, { area_id: 'wohnzimmer' });
  add('camera.wohnzimmer', 'idle', { friendly_name: 'Kamera', supported_features: 2 }, { area_id: 'wohnzimmer' });
  // Zweite Kamera im selben Raum, gerade weg: das geteilte Bild (wie die iOS-App) muss sie tragen.
  add('camera.wohnzimmer_tuer', 'unavailable', { friendly_name: 'Kamera', supported_features: 2 }, { area_id: 'wohnzimmer' });

  /* ── Küche und ihr Umlaut-Zwilling ── */
  add('light.kuche', 'unavailable', { friendly_name: 'Küche', restored: true, supported_features: 0 }, { area_id: 'kuche' });
  add('light.kueche', 'unknown', { friendly_name: 'Küche', supported_color_modes: ['brightness'] }, { area_id: 'kueche' });
  add('light.kueche_insel', 'on', { friendly_name: 'Insel', brightness: 300, color_mode: 'brightness', supported_color_modes: ['brightness'] }, { area_id: 'kueche' });
  add('switch.kuche_kaffee', 'on', { friendly_name: 'Kaffeemaschine' }, { area_id: 'kuche' });
  // Melder weg: die Kachel zeigt keinen grünen Anwesenheitspunkt, statt „jemand da" zu raten.
  add('binary_sensor.kueche_bewegung', 'unavailable', { friendly_name: 'Bewegung', device_class: 'motion' }, { area_id: 'kueche' });
  add('sensor.kuche_temperatur', 'abc', { friendly_name: 'Temperatur', unit_of_measurement: '°C', device_class: 'temperature' }, { area_id: 'kuche' });
  add('sensor.kuche_leistung', '1e308', { friendly_name: 'Leistung', unit_of_measurement: 'W', device_class: 'power', state_class: 'measurement' }, { area_id: 'kuche' });
  add('sensor.netz_bezug_wh', '8123456', { friendly_name: 'Netzbezug', unit_of_measurement: 'Wh', device_class: 'energy', state_class: 'total_increasing' }, { area_id: null });
  add('sensor.netz_einspeisung', 'unavailable', { friendly_name: 'Einspeisung', unit_of_measurement: 'kWh', device_class: 'energy', state_class: 'total_increasing' }, { area_id: null });
  add('sensor.pv_ertrag', '4321.5', { friendly_name: 'PV Ertrag', unit_of_measurement: 'kWh', device_class: 'energy', state_class: 'total_increasing' }, { area_id: null });
  add('sensor.kuche_energie', '-5', { friendly_name: 'Energie', unit_of_measurement: 'kWh', device_class: 'energy', state_class: 'total_increasing' }, { area_id: 'kuche' });
  add('select.kuche_modus', 'Auto', { friendly_name: 'Modus', options: [] }, { area_id: 'kuche' });
  add('input_select.kuche_programm', 'Pizza', { friendly_name: 'Programm', options: ['Pizza', 'Pizza', 'Brot'] }, { area_id: 'kuche' });
  add('number.kuche_timer', '5', { friendly_name: 'Timer', min: 10, max: 0, step: 0, mode: 'slider' }, { area_id: 'kuche' });
  add('input_number.kuche_ziel', 'unknown', { friendly_name: 'Zieltemperatur', min: 0, max: 100, step: 0.5, mode: 'box' }, { area_id: 'kuche' });
  add('button.kuche_reset', 'unknown', { friendly_name: 'Zurücksetzen' }, { area_id: 'kuche' });
  add('input_button.kuche_klingel', changed, { friendly_name: 'Klingel' }, { area_id: 'kuche' });
  add('water_heater.kuche_boiler', 'eco', {
    friendly_name: 'Boiler', operation_list: ['eco', 'eco', 'performance'], operation_mode: 'eco',
    temperature: null, current_temperature: null, min_temp: 30, max_temp: 60, supported_features: 3,
  }, { area_id: 'kuche' });

  /* ── Bad: alles doppelt, was doppelt sein kann ── */
  add('climate.bad', 'heat_cool', {
    friendly_name: 'Bad', hvac_modes: ['off', 'heat', 'heat_cool', 'heat'], preset_modes: ['eco', 'comfort', 'eco'],
    preset_mode: 'eco', fan_modes: ['auto', 'auto'], fan_mode: 'auto', swing_modes: ['on', 'on'], swing_mode: 'on',
    target_temp_low: 19, target_temp_high: 23, temperature: null, current_temperature: null,
    hvac_action: 'heating', min_temp: 7, max_temp: 35, supported_features: 443,
  }, { area_id: 'bad', device_id: 'dev_bad' });
  add('sensor.bad', '22.1', { friendly_name: 'Bad', unit_of_measurement: '°C', device_class: 'temperature' }, { area_id: 'bad' });
  add('humidifier.bad', 'on', {
    friendly_name: 'Luftbefeuchter', available_modes: ['normal', 'normal', 'eco'], mode: 'normal',
    humidity: null, current_humidity: 55, min_humidity: 30, max_humidity: 80, supported_features: 1,
  }, { area_id: 'bad' });
  add('fan.bad_luefter', 'on', {
    friendly_name: 'Lüfter', percentage: null, percentage_step: 0, preset_modes: ['auto', 'auto'], preset_mode: null,
    oscillating: null, direction: 'forward', supported_features: 63,
  }, { area_id: 'bad' });
  add('valve.bad_wasser', 'opening', { friendly_name: 'Wasser', current_position: null, reports_position: true, supported_features: 15 }, { area_id: 'bad' });
  add('light.bad_spiegel', 'on', {
    friendly_name: 'Spiegel', brightness: 1, color_mode: 'rgbww', supported_color_modes: ['rgbww'], rgbww_color: [255, 0, 0, 0, 0],
  }, { area_id: 'bad_2' });

  /* ── Büro: Schalter als Licht, ausgeblendetes Original ── */
  add('light.1_og_buro', 'on', { friendly_name: '1. OG Büro', brightness: 77, color_mode: 'brightness', supported_color_modes: ['brightness'] }, { area_id: 'buro' });
  add('switch.buro_steckdose', 'on', { friendly_name: 'Steckdose' }, { area_id: 'buro', hidden_by: 'integration' });
  add('light.buro_steckdose', 'on', { friendly_name: 'Steckdose', color_mode: 'onoff', supported_color_modes: ['onoff'], entity_id: ['switch.buro_steckdose'] }, { area_id: 'buro' });
  add('lock.buro', 'jammed', { friendly_name: 'Schloss', code_format: '^\\d{4}$', changed_by: null, supported_features: 1 }, { area_id: 'buro' });
  add('alarm_control_panel.buro', 'triggered', { friendly_name: 'Alarm', code_format: 'number', code_arm_required: true, supported_features: 63 }, { area_id: 'buro' });
  add('siren.buro', 'off', { friendly_name: 'Sirene', available_tones: { 1: 'Feuer', 2: 'Einbruch' }, supported_features: 31 }, { area_id: 'buro' });
  add('vacuum.buro_robbi', 'error', {
    friendly_name: 'Robbi', fan_speed_list: ['quiet', 'quiet', 'max'], fan_speed: 'turbo', battery_level: null,
    status: 'Stuck', supported_features: 16383,
  }, { area_id: 'buro' });

  /* ── Flur: der gemeldete Absturz (0.21.1) — Schalter und Licht, beide sichtbar ── */
  add('switch.flur_decke', 'on', { friendly_name: 'Flur Decke' }, { area_id: 'flur' });
  add('light.flur_decke', 'on', { friendly_name: 'Flur Decke', color_mode: 'onoff', supported_color_modes: ['onoff'], entity_id: ['switch.flur_decke'] }, { area_id: 'flur' });
  add('cover.flur_rollo', 'opening', { friendly_name: 'Rollo', supported_features: 0 }, { area_id: 'flur' });
  add('binary_sensor.flur_bewegung', 'on', { friendly_name: 'Bewegung', device_class: 'motion' }, { area_id: 'flur' });
  add('cover.flur_rollo_2', 'open', {
    friendly_name: 'Rollo', current_position: 150, current_tilt_position: -10, device_class: 'blind', supported_features: 255,
  }, { area_id: 'flur_2' });

  /* ── Namen, die niemand erwartet ── */
  add('light.lang', 'off', {
    friendly_name: `${LONG_NAME}\nzweite Zeile <script>alert(1)</script>`, supported_color_modes: ['brightness'],
  }, { area_id: 'lang', name: null, original_name: null });
  add('sensor.ohne_name', '3', { unit_of_measurement: 'x' }, { area_id: 'lang', name: null, original_name: null });

  /* ── Wintergarten: Tür als Rollo mit Kontakt und Batterie (Wunsch aus dem Postfach) ── */
  add('cover.wintergarten_tur', 'open', {
    friendly_name: 'Tür', current_position: 40, device_class: 'door', supported_features: 15,
  }, { area_id: 'wintergarten', device_id: 'dev_wintergarten' });
  /* Jalousie mit Lamellen nur auf/zu, gerade in Fahrt: ein Tipp muss sie anhalten. */
  add('cover.wintergarten_jalousie', 'closing', {
    friendly_name: 'Jalousie', current_position: 60, device_class: 'blind', supported_features: 63,
  }, { area_id: 'wintergarten' });
  add('binary_sensor.wintergarten_tur', 'off', { friendly_name: 'Tür', device_class: 'door' }, { device_id: 'dev_wintergarten' });
  add('sensor.wintergarten_tur', '87', { friendly_name: 'Tür', unit_of_measurement: '%', device_class: 'battery' }, { device_id: 'dev_wintergarten', entity_category: 'diagnostic' });

  /* ── Hauswirtschaft: Wärmepumpe mit Heizkreis und Warmwasser (Rückmeldung aus der App) ──
     Sie ist nicht die Heizung des Raums; ihr Ein/Aus-Knopf gehört nicht auf die Kachel. */
  add('climate.waermepumpe_heizkreis', 'heat', {
    friendly_name: 'Wärmepumpe Heizkreis', current_temperature: 34, temperature: 35, hvac_modes: ['off', 'heat'], supported_features: 385,
  }, { area_id: 'wintergarten', device_id: 'dev_waermepumpe' });
  add('water_heater.waermepumpe_warmwasser', 'heat_pump', { friendly_name: 'Warmwasser', temperature: 48 }, { device_id: 'dev_waermepumpe' });
  add('sensor.waermepumpe_vorlauf', '34.2', { friendly_name: 'Vorlauf', unit_of_measurement: '°C', device_class: 'temperature' }, { device_id: 'dev_waermepumpe' });

  /* ── Kinderzimmer ── */
  add('light.kinderzimmer_nacht', 'on', { friendly_name: 'Nachtlicht', brightness: 3, color_mode: 'hs', hs_color: null, supported_color_modes: ['hs'] }, { area_id: 'kinderzimmer' });
  add('media_player.kinderzimmer_box', 'idle', {
    friendly_name: 'Box', volume_level: 1.5, is_volume_muted: null, source_list: null, supported_features: 152_461,
  }, { area_id: 'kinderzimmer' });

  /* ── Schlafzimmer: alte Mired-Lampe, Fahrenheit, kaputte Heizung ── */
  add('light.schlafzimmer', 'on', {
    friendly_name: 'Schlafzimmer', brightness: 90, color_mode: 'color_temp', supported_color_modes: ['color_temp'],
    color_temp: 370, min_mireds: 153, max_mireds: 500,
  }, { area_id: 'schlafzimmer' });
  add('climate.schlafzimmer', 'unavailable', {}, { area_id: 'schlafzimmer' });
  add('sensor.schlafzimmer_temperatur', '71.2', { friendly_name: 'Temperatur', unit_of_measurement: '°F', device_class: 'temperature' }, { area_id: 'schlafzimmer' });
  add('sensor.schlafzimmer_feuchte', '120', { friendly_name: 'Feuchte', unit_of_measurement: '%', device_class: 'humidity' }, { area_id: 'schlafzimmer' });

  /* ── Dachboden ── */
  add('sensor.dachboden', '', { friendly_name: 'Dachboden', unit_of_measurement: '°C', device_class: 'temperature' }, { area_id: 'dachboden' });
  add('fan.dachboden', 'on', { friendly_name: 'Ventilator', percentage: 50, percentage_step: 33.333333333333336, preset_modes: null, supported_features: 1 }, { area_id: 'dachboden' });

  /* ── Keller: sechzig Lampen mit demselben Namen ── */
  for (let i = 1; i <= 60; i++) {
    const n = String(i).padStart(2, '0');
    add(`light.keller_${n}`, i % 3 === 0 ? 'off' : 'on', {
      friendly_name: 'Lampe', brightness: (i * 37) % 256, color_mode: 'brightness', supported_color_modes: ['brightness'],
    }, { area_id: 'keller' });
  }

  /* ── Technik: rechts nach links ── */
  add('sensor.technik_cpu', '37.5', { friendly_name: 'حرارة المعالج', unit_of_measurement: '°C', device_class: 'temperature' }, { area_id: 'technik', name: 'CPU' });
  add('binary_sensor.technik_tuer', 'on', { friendly_name: 'باب', device_class: 'door' }, { area_id: 'technik' });

  /* ── Ohne Bereich, verwaist, deaktiviert ── */
  add('light.ohne_bereich', 'on', { friendly_name: 'YAML-Licht', brightness: 10, supported_color_modes: ['brightness'], color_mode: 'brightness' }, {}, { noRegistry: true });
  add('switch.geisterschalter', 'off', { friendly_name: 'Geist' }, { area_id: 'wohnzimmer', disabled_by: 'user' }, { noState: true });
  add('sensor.verwaist', '1', { friendly_name: 'Verwaist', unit_of_measurement: 'W', device_class: 'power' }, { area_id: 'geloescht' });
  add('lawn_mower.rasen', 'error', { friendly_name: 'Rasenmäher', supported_features: 7 }, { device_id: 'dev_verwaist' });

  /* ── Haus und Menschen ── */
  add('sun.sun', 'above_horizon', {
    friendly_name: 'Sun', next_rising: at(now, 1, 7, 12), next_setting: at(now, 0, 19, 3), elevation: 23.4, azimuth: 180.2, rising: false,
  }, {}, { noRegistry: true });
  add('zone.home', '2', { friendly_name: 'Zuhause', latitude: 52.52, longitude: 13.405, radius: 100, passive: false, persons: [] }, {}, { noRegistry: true });
  add('weather.forecast_home', 'rainy', {
    friendly_name: 'Wetter', temperature: null, humidity: 'viel', wind_speed: 1e9, temperature_unit: '°C', supported_features: 3,
  }, {});
  add('person.alex', 'home', { friendly_name: 'Alex', user_id: 'u1' }, {}, { noRegistry: true });
  add('person.alex_2', 'not_home', { friendly_name: 'Alex', user_id: 'u2' }, {}, { noRegistry: true });
  add('person.gast', 'unknown', { friendly_name: '' }, {}, { noRegistry: true });
  add('person.lucja', 'home', { friendly_name: 'Łucja Gonçalves', user_id: 'u3' }, {}, { noRegistry: true });
  add('input_boolean.urlaub', 'off', { friendly_name: 'Urlaub' }, {});
  add('calendar.familie', 'off', { friendly_name: 'Kalender', message: 'Training', all_day: false }, {});
  add('calendar.muell', 'on', { friendly_name: 'Kalender', message: 'Restmüll', all_day: true }, {});
  add('calendar.leer', 'off', { friendly_name: 'Leer' }, {});
  add('calendar.kaputt', 'unavailable', { friendly_name: 'Kaputt' }, {});
  add('todo.einkaufsliste', '3', { friendly_name: 'Einkaufsliste', supported_features: 127 }, {});
  add('todo.leer', '0', { friendly_name: 'Einkaufsliste', supported_features: 15 }, {});

  const training = (day: number): HostileCalendarEvent => ({
    start: at(now, day, 18), end: at(now, day, 19, 30), summary: 'Training', uid: 'serie-training',
    recurrence_id: null, rrule: 'FREQ=DAILY',
  });
  const busyDay: HostileCalendarEvent[] = Array.from({ length: 15 }, (_, i) => ({
    start: at(now, 2, 8 + (i % 10), (i * 7) % 60), end: at(now, 2, 9 + (i % 10), 0), summary: `Termin ${i % 4}`, uid: null,
  }));

  return {
    config: {
      location_name: 'Stresshaus <i>🏠</i>', latitude: 52.52, longitude: 13.405, elevation: 34,
      unit_system: { length: 'km', accumulated_precipitation: 'mm', mass: 'g', pressure: 'Pa', temperature: '°C', volume: 'L', wind_speed: 'm/s' },
      time_zone: 'Europe/Berlin', components: ['calendar', 'todo', 'weather', 'recorder', 'logbook', 'persistent_notification', 'camera'],
      config_dir: '/config', allowlist_external_dirs: [], allowlist_external_urls: [], version: '2026.9.0',
      config_source: 'storage', recovery_mode: false, safe_mode: false, state: 'RUNNING', external_url: null, internal_url: null,
      currency: 'EUR', country: 'DE', language: 'de',
    },
    areas,
    devices,
    entities,
    states,
    calendarEvents: {
      'calendar.familie': [
        // Serie: jede Wiederholung mit derselben uid, eine davon doppelt ohne recurrence_id.
        ...[0, 1, 2, 3, 4].map(training),
        training(0),
        // Zwei gleiche Termine ohne uid.
        { start: at(now, 0, 10), end: at(now, 0, 11), summary: 'Arzt', uid: null },
        { start: at(now, 0, 10), end: at(now, 0, 11), summary: 'Arzt', uid: null },
        // Mehrtägig ganztags über den heutigen Tag hinweg.
        { start: isoDay(now, -1), end: isoDay(now, 3), summary: 'Ferien 🏖️', uid: 'ferien' },
        // Ende vor Beginn.
        { start: at(now, 1, 15), end: at(now, 1, 14), summary: 'Zeitreise', uid: 'zeitreise' },
        { start: at(now, 1, 9), end: at(now, 1, 10), summary: '', uid: 'leer' },
        { start: at(now, 1, 12), end: at(now, 1, 13), summary: LONG_NAME, description: '<b>fett</b>', location: '📍', uid: 'lang' },
        { start: isoDay(now, 3), end: isoDay(now, 4), summary: 'Geburtstag Alex', uid: 'geburtstag' },
        // Heute, Name außerhalb von Latin-1: stand als Momente-ETag im Kopf und beendete den Server.
        { start: isoDay(now, 0), end: isoDay(now, 1), summary: 'Geburtstag Łukasz', uid: 'geburtstag-heute' },
        ...busyDay,
      ],
      'calendar.muell': [
        // Dieselbe uid wie ein Termin im Familienkalender.
        { start: isoDay(now, 1), end: isoDay(now, 2), summary: 'Restmüll', uid: 'ferien' },
        { start: isoDay(now, 1), end: isoDay(now, 2), summary: 'Restmüll', uid: 'ferien' },
      ],
      'calendar.leer': [],
    },
    failingCalendars: ['calendar.kaputt'],
    todoItems: {
      'todo.einkaufsliste': [
        { uid: 'a', summary: 'Milch', status: 'needs_action' },
        { uid: 'b', summary: 'Milch', status: 'needs_action' },
        { uid: 'c', summary: '', status: 'completed' },
        { uid: 'd', summary: '🥖 Brot mit einem sehr langen Namen, der nicht in die Zeile passt', status: 'needs_action', due: 'kein-datum' },
      ],
      'todo.leer': [],
    },
    forecasts: {
      'weather.forecast_home': {
        daily: [
          { datetime: at(now, 0, 12), condition: 'rainy', temperature: 18, templow: 11, precipitation: 3 },
          { datetime: at(now, 0, 12), condition: 'rainy', temperature: 18, templow: 11, precipitation: 3 },
          { datetime: at(now, 1, 12), condition: 'exceptional', temperature: null, templow: null },
        ],
        hourly: [],
      },
    },
    /* Gemeldet: „Gesamt" blieb leer, weil die Einrichtung keine Zähler kennt.
       Das Dashboard darunter ist so krumm wie echte: Bezug doppelt und in Wh,
       ein Zähler, den es nicht mehr gibt, leere Kennungen, Gas daneben. */
    energyPrefs: {
      energy_sources: [
        {
          type: 'grid',
          flow_from: [{ stat_energy_from: 'sensor.netz_bezug_wh' }, { stat_energy_from: 'sensor.netz_bezug_wh' }, { stat_energy_from: '' }, null],
          flow_to: [{ stat_energy_to: 'sensor.netz_einspeisung' }, { stat_energy_to: 'sensor.alter_zaehler' }],
          cost_adjustment_day: 0,
        },
        { type: 'solar', stat_energy_from: 'sensor.pv_ertrag', config_entry_solar_forecast: null },
        { type: 'battery', stat_energy_from: 'sensor.akku_abgabe', stat_energy_to: 'sensor.akku_ladung' },
        { type: 'gas', stat_energy_from: 'sensor.gaszaehler' },
        'kaputt',
      ],
      device_consumption: [{ stat_consumption: 'sensor.kuche_energie' }],
    },
  };
}

/* ── Gewürfelte Varianten ──
   Jeder Lauf mit Startzahl legt zu den festen Fällen oben weitere Geräte aller
   Arten an, jedes mit ein bis drei Macken aus dem Katalog unten — immer andere
   Kombinationen, mit derselben Startzahl wiederholbar. Dazu kommen Szenarien,
   die sich die KI im Zwei-Tage-Lauf ausgedacht hat (`scenarios`). */

export interface HostileScenario {
  name: string;
  warum?: string;
  areas?: { area_id: string; name: string }[];
  devices?: { id: string; area_id: string | null; name: string }[];
  entities?: (Partial<RegistryOverrides> & AddOptions & { entity_id: string; state: string; attributes?: Record<string, unknown> })[];
  calendarEvents?: Record<string, HostileCalendarEvent[]>;
  todoItems?: Record<string, HostileTodoItem[]>;
}

export interface HostileOptions {
  seed?: number | null;
  scenarios?: readonly HostileScenario[];
}

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Gesunde Ausgangslage je Domain — die Macken verbiegen sie. */
export const TEMPLATES: Record<string, { state: string; attributes: Record<string, unknown> }> = {
  light: { state: 'on', attributes: { brightness: 128, color_mode: 'hs', supported_color_modes: ['hs', 'color_temp'], hs_color: [20, 50], color_temp_kelvin: 3000, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, effect_list: ['Kerze', 'Regenbogen'] } },
  switch: { state: 'on', attributes: {} },
  sensor: { state: '42', attributes: { unit_of_measurement: 'W', device_class: 'power', state_class: 'measurement' } },
  binary_sensor: { state: 'off', attributes: { device_class: 'window' } },
  climate: { state: 'heat', attributes: { hvac_modes: ['off', 'heat', 'cool', 'auto'], preset_modes: ['eco', 'comfort'], fan_modes: ['auto', 'low'], swing_modes: ['on', 'off'], current_temperature: 21, temperature: 20, min_temp: 7, max_temp: 30, target_temp_step: 0.5, hvac_action: 'idle', supported_features: 441 } },
  media_player: { state: 'playing', attributes: { source_list: ['TV', 'HDMI 1'], source: 'TV', sound_mode_list: ['Film', 'Musik'], volume_level: 0.3, is_volume_muted: false, media_title: 'Titel', media_artist: 'Künstler', media_duration: 300, media_position: 20, supported_features: 152_463 } },
  cover: { state: 'open', attributes: { current_position: 50, current_tilt_position: 50, device_class: 'shutter', supported_features: 255 } },
  fan: { state: 'on', attributes: { percentage: 33, percentage_step: 33.333333333333336, preset_modes: ['auto', 'sleep'], preset_mode: 'auto', oscillating: false, direction: 'forward', supported_features: 63 } },
  input_boolean: { state: 'on', attributes: {} },
  vacuum: { state: 'cleaning', attributes: { fan_speed_list: ['quiet', 'max'], fan_speed: 'quiet', battery_level: 80, status: 'Cleaning', supported_features: 16_383 } },
  camera: { state: 'idle', attributes: { supported_features: 2 } },
  valve: { state: 'open', attributes: { current_position: 50, reports_position: true, supported_features: 15 } },
  lock: { state: 'locked', attributes: { supported_features: 1 } },
  humidifier: { state: 'on', attributes: { available_modes: ['normal', 'eco'], mode: 'normal', humidity: 50, current_humidity: 45, min_humidity: 30, max_humidity: 80, supported_features: 1 } },
  water_heater: { state: 'eco', attributes: { operation_list: ['eco', 'performance'], operation_mode: 'eco', temperature: 50, current_temperature: 48, min_temp: 30, max_temp: 60, supported_features: 3 } },
  lawn_mower: { state: 'mowing', attributes: { supported_features: 7 } },
  alarm_control_panel: { state: 'disarmed', attributes: { code_format: null, code_arm_required: false, supported_features: 63 } },
  siren: { state: 'off', attributes: { available_tones: ['a', 'b'], supported_features: 31 } },
  remote: { state: 'on', attributes: { activity_list: ['TV', 'Radio'], current_activity: 'TV', supported_features: 4 } },
  number: { state: '50', attributes: { min: 0, max: 100, step: 1, mode: 'slider', unit_of_measurement: '%' } },
  input_number: { state: '50', attributes: { min: 0, max: 100, step: 1, mode: 'box' } },
  select: { state: 'a', attributes: { options: ['a', 'b', 'c'] } },
  input_select: { state: 'a', attributes: { options: ['a', 'b', 'c'] } },
  button: { state: 'unknown', attributes: {} },
  input_button: { state: '2026-01-01T00:00:00+00:00', attributes: {} },
};

const HOSTILE_NAMES: (string | null)[] = [
  '', null, LONG_NAME, '🛋️💡🔥', '<img src=x onerror=alert(1)>', 'مصباح', 'Zeile\nzwei', '   ', 'Lampe', 'Lampe',
  'Ä'.repeat(200), '0', 'undefined', 'null', '%s %d {name}', 'ﾗﾝﾌﾟ',
];
const HOSTILE_STATES = ['unavailable', 'unknown', '', 'ÄÖÜ', '21,5', 'NaN', '1e999', '-0', 'on ', 'ON', 'true', '[]'];
const HOSTILE_VALUES: unknown[] = [null, -1, 0, 1e12, -1e12, 'viel', '12', true, [], {}, [1, null, 'x'], 3.14159265358979];

type Rng = () => number;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

/* Der Katalog der Macken: jede nimmt ein Gerät und verbiegt eine Stelle. */
const MUTATIONS: Record<string, (entity: { state: string; attributes: Record<string, unknown> }, rng: Rng) => void> = {
  'Option doppelt': (e, rng) => {
    const lists = Object.keys(e.attributes).filter((k) => Array.isArray(e.attributes[k]) && (e.attributes[k] as unknown[]).length);
    if (!lists.length) return;
    const key = pick(rng, lists);
    const list = e.attributes[key] as unknown[];
    e.attributes[key] = [...list, pick(rng, list)];
  },
  'Optionen fast gleich': (e, rng) => {
    const lists = Object.keys(e.attributes).filter((k) => Array.isArray(e.attributes[k]) && typeof (e.attributes[k] as unknown[])[0] === 'string');
    if (!lists.length) return;
    const key = pick(rng, lists);
    const first = (e.attributes[key] as string[])[0];
    e.attributes[key] = [...(e.attributes[key] as string[]), ` ${first}`, first.toUpperCase(), `${first}​`];
  },
  'Liste leer': (e, rng) => {
    const lists = Object.keys(e.attributes).filter((k) => Array.isArray(e.attributes[k]));
    if (lists.length) e.attributes[pick(rng, lists)] = [];
  },
  'Liste riesig': (e, rng) => {
    const lists = Object.keys(e.attributes).filter((k) => Array.isArray(e.attributes[k]) && typeof (e.attributes[k] as unknown[])[0] === 'string');
    if (lists.length) e.attributes[pick(rng, lists)] = Array.from({ length: 150 }, (_, i) => `Option ${i} ${'x'.repeat(i % 40)}`);
  },
  'Attribut null': (e, rng) => {
    const keys = Object.keys(e.attributes);
    if (keys.length) e.attributes[pick(rng, keys)] = null;
  },
  'Attribut fehlt': (e, rng) => {
    const keys = Object.keys(e.attributes);
    if (keys.length) delete e.attributes[pick(rng, keys)];
  },
  'falscher Typ': (e, rng) => {
    const keys = Object.keys(e.attributes);
    if (keys.length) e.attributes[pick(rng, keys)] = pick(rng, HOSTILE_VALUES);
  },
  'außerhalb des Bereichs': (e, rng) => {
    const keys = Object.keys(e.attributes).filter((k) => typeof e.attributes[k] === 'number');
    if (keys.length) { const key = pick(rng, keys); e.attributes[key] = (e.attributes[key] as number) * pick(rng, [-1, 1000, -1000]); }
  },
  'Zustand seltsam': (e, rng) => { e.state = pick(rng, HOSTILE_STATES); },
  'Name feindlich': (e, rng) => { e.attributes.friendly_name = pick(rng, HOSTILE_NAMES); },
  'alle Funktionen': (e) => { e.attributes.supported_features = 2 ** 31 - 1; },
  'keine Funktionen': (e) => { e.attributes.supported_features = 0; },
};

function variations(home: HostileHome, seed: number, now: Date): void {
  const rng = seededRandom(seed);
  const domains = Object.keys(TEMPLATES);
  const extraAreas = Array.from({ length: 3 }, (_, i) => ({
    area_id: `zufall_${i + 1}`, name: pick(rng, [`Zufall ${i + 1}`, `Zufall ${i + 1} 🎲`, `zufall ${i + 1}`, `Zufall ${i + 1}`]),
    aliases: [], floor_id: null, icon: null, picture: null,
  }));
  home.areas.push(...extraAreas);
  const areaIds = [...home.areas.map((a) => a.area_id), null, 'geloescht'];
  const changed = new Date(now.getTime() - 60_000).toISOString();
  for (let i = 0; i < 45; i++) {
    const domain = pick(rng, domains);
    const base = structuredClone(TEMPLATES[domain]);
    const macken = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(rng, Object.keys(MUTATIONS)));
    for (const name of macken) MUTATIONS[name](base, rng);
    /* Mal ein eigener Objektname, mal einer, den es in einer anderen Domain schon gibt. */
    const object = rng() < 0.25 ? pick(rng, home.states).entity_id.split('.')[1] : `zufall_${seed % 1000}_${i}`;
    const entityId = `${domain}.${object}`;
    if (home.states.some((s) => s.entity_id === entityId)) continue;
    if (!('friendly_name' in base.attributes)) base.attributes.friendly_name = `${domain} ${i}`;
    base.attributes.stresshaus_macken = macken;
    home.states.push({ entity_id: entityId, state: base.state, attributes: base.attributes, last_changed: changed, last_updated: changed, context: { id: `zufall-${i}`, parent_id: null, user_id: null } });
    home.entities.push({
      entity_id: entityId, id: `reg-${entityId}`, unique_id: `uid-${entityId}`, platform: 'stresshaus',
      area_id: pick(rng, areaIds), device_id: null, name: rng() < 0.2 ? pick(rng, HOSTILE_NAMES) : null,
      original_name: null, icon: null, disabled_by: null, hidden_by: rng() < 0.1 ? 'user' : null,
      entity_category: rng() < 0.1 ? 'diagnostic' : null, has_entity_name: rng() < 0.5,
    });
  }
  /* Kalender und Listen: mehr, dichter, mit kaputten Feldern. */
  const family = home.calendarEvents['calendar.familie'] ??= [];
  for (let i = 0; i < 25; i++) {
    const day = Math.floor(rng() * 9) - 1;
    const hour = Math.floor(rng() * 24);
    const allDay = rng() < 0.3;
    const start = allDay ? isoDay(now, day) : at(now, day, hour, Math.floor(rng() * 60));
    const end = allDay ? isoDay(now, day + 1 + Math.floor(rng() * 3)) : at(now, day, hour + Math.floor(rng() * 5) - 1, 0);
    family.push({
      start, end, summary: pick(rng, [...HOSTILE_NAMES.filter((n): n is string => n !== null), 'Arzt', 'Training']),
      uid: pick(rng, [null, `zufall-${i}`, 'serie-training', 'ferien']),
      description: rng() < 0.2 ? '<script>x</script>' : null, location: rng() < 0.2 ? LONG_NAME : null,
    });
  }
  const list = home.todoItems['todo.einkaufsliste'] ??= [];
  for (let i = 0; i < 20; i++) {
    list.push({
      uid: rng() < 0.15 ? 'a' : `zufall-${i}`,
      summary: pick(rng, [...HOSTILE_NAMES.filter((n): n is string => n !== null), 'Milch']),
      status: rng() < 0.4 ? 'completed' : 'needs_action',
      ...(rng() < 0.4 ? { due: pick(rng, ['2026-13-45', isoDay(now, 1), at(now, 0, 9), '', 'morgen', '2026-09-24T25:61:00']) } : {}),
    });
  }
}

function applyScenario(home: HostileHome, scenario: HostileScenario, now: Date): void {
  const changed = new Date(now.getTime() - 60_000).toISOString();
  for (const area of scenario.areas ?? []) {
    if (!home.areas.some((a) => a.area_id === area.area_id)) home.areas.push({ ...area, aliases: [], floor_id: null, icon: null, picture: null });
  }
  for (const device of scenario.devices ?? []) {
    if (!home.devices.some((d) => d.id === device.id)) home.devices.push({ ...device, name_by_user: null, manufacturer: null, model: null });
  }
  for (const entity of scenario.entities ?? []) {
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(entity.entity_id)) continue;
    if (home.states.some((s) => s.entity_id === entity.entity_id)) continue;
    const attributes: Record<string, unknown> = { ...(entity.attributes ?? {}), stresshaus_szenario: scenario.name };
    if (!entity.noState) {
      home.states.push({ entity_id: entity.entity_id, state: String(entity.state), attributes, last_changed: changed, last_updated: changed, context: { id: `szenario-${entity.entity_id}`, parent_id: null, user_id: null } });
    }
    if (!entity.noRegistry) {
      home.entities.push({
        entity_id: entity.entity_id, id: `reg-${entity.entity_id}`, unique_id: `uid-${entity.entity_id}`, platform: 'stresshaus',
        area_id: entity.area_id ?? null, device_id: entity.device_id ?? null, name: entity.name ?? null,
        original_name: typeof attributes.friendly_name === 'string' ? attributes.friendly_name : null, icon: null,
        disabled_by: entity.disabled_by ?? null, hidden_by: entity.hidden_by ?? null, entity_category: entity.entity_category ?? null, has_entity_name: false,
      });
    }
  }
  for (const [id, events] of Object.entries(scenario.calendarEvents ?? {})) (home.calendarEvents[id] ??= []).push(...events);
  for (const [id, items] of Object.entries(scenario.todoItems ?? {})) (home.todoItems[id] ??= []).push(...items);
}

/** Das Stresshaus mit gewürfelten Varianten und ausgedachten Szenarien. */
export function hostileHomeWith(options: HostileOptions = {}, now: Date = new Date()): HostileHome {
  const home = hostileHome(now);
  if (typeof options.seed === 'number') variations(home, options.seed, now);
  for (const scenario of options.scenarios ?? []) applyScenario(home, scenario, now);
  return home;
}
