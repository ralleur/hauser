/* ============================================
   Smart Home HMI — Fake-State-Engine als Runes-Store (Phase 3, ADR-013/015)
   Portiert aus prototype/scripts/main.js: gleiche Daten, gleiche Logik —
   aber $state statt Hand-Rendering. Die HA-/Jellyfin-Anbindung ersetzt
   sendCommand/sendJellyfin in der Anbindungs-Session (Adapter, ADR-015).
   ============================================ */

import { showScreen } from './nav.svelte.ts';

import {
  buildRuntimeRooms,
  loadDeviceConfig,
  mergeCatalog,
  seedCatalog,
  type DeviceCategory,
  type ManagedDomain,
} from './device-config.ts';

/* Statische Raum-Metadaten (ADR-017): Name, Ist-Temperatur (sensor.*, read-only),
   Präsenz/Fenster (binary_sensor.*, read-only) + Licht-Liste OHNE Zustand. Die
   steuerbaren Werte (on/brightness/target/hvac) liegen im EntityStore und werden
   über mergedLight/mergedClimate (state/commands.ts) gelesen, nicht hier. */
/* Fähigkeiten (`dimmable`/`colorTemp`/`color` + Kelvin-Range) werden zur
   Laufzeit aus den HA-Attributen erkannt (`supported_color_modes`,
   `min/max_color_temp_kelvin` — adapter/capabilities.ts, B-16B) und
   überschreiben beim Katalog-Merge die Seed-Flags. Die Flags hier sind nur
   noch Fallback für Fake-Backend/Offline-Start. `colorTemp`/`color` blenden
   im Licht-Detail (zweite Ebene) die jeweilige Skala/Palette ein. */
export interface Light {
  id: string; entityId: string; domain?: ManagedDomain; name: string; dimmable: boolean;
  /** Overlay-/Kachel-Kategorie (categoryOf(domain)); fehlt bei Seed-Lichtern = 'light'. */
  category?: DeviceCategory;
  colorTemp?: boolean; color?: boolean;
  colorTempMin?: number; colorTempMax?: number;
  /** Anzeige-Metadaten der info-Kategorie (sensor/binary_sensor) */
  unit?: string | null;
  deviceClass?: string | null;
  /** Piktogramm-Symbol (Sprite-id); im Detail-Overlay umstellbar (Symbolwahl). */
  icon?: string;
}

/* Farbtemperatur-Bereich der UI (Kelvin) — warm ↔ kühl (Hauser-Tick-Skala). */
export const COLOR_TEMP_MIN = 2000;
export const COLOR_TEMP_MAX = 6500;

/* Die Ist-Temperatur ist bewusst KEIN statisches Room-Feld mehr (das war der
   alte Mock): sie wird live über roomTemperature() (state/commands.ts) aus dem
   EntityStore gelesen — dedizierter Raum-Sensor > Thermostat-Ist > nichts. */
export interface Room {
  id: string; name: string;
  presence: boolean; windowOpen: boolean; lights: Light[];
}

/* Seed für den EntityStore: die volle Ausgangs-Wahrheit inkl. der steuerbaren
   Felder. Quelle für buildEntitySeed() (state/entities.ts) UND für die statische
   appState.rooms-Projektion. In der HA-Session ersetzen echte Subscriptions den
   Seed; die Raum-Metadaten (Name, Licht-Liste) bleiben Konfiguration. */
export interface LightSeed extends Light {
  on: boolean; brightness: number; entityId: string;
  colorTemp?: boolean; color?: boolean; icon?: string;
  /** Startwerte (Fallback-Cache bis zum ersten Echo) für die Detail-Ebene */
  colorTempK?: number; colorHex?: string | null;
}


export interface RoomSeed extends Room {
  /** Räume OHNE Klima-Entität (z. B. Flur) haben keine steuerbare Heizung.
      target/hvac/climateEntityId sind dann undefined — die UI blendet
      die Klima-Steuerung aus und zeigt nur Licht + Temp (Sensor). */
  target?: number;
  hvac?: 'heat' | 'cool' | 'off';
  lights: LightSeed[];
  /** reale HA climate.*-entity_id (ADR-018: explizite Map statt Konvention) */
  climateEntityId?: string;
  /** Dedizierter Raum-Temperatursensor (reale HA sensor.*-entity_id). Hat in der
      Anzeige VORRANG vor dem Thermostat-Ist (roomTemperature()). Nicht gesetzt →
      Fallback auf climate.current_temperature bzw. keine Anzeige. */
  tempSensorId?: string;
  /** Ist-Temp-Startwert (Fallback-Cache bis zum ersten HA-Echo) — landet als
      `current` im climate-Seed. Nur bei Räumen MIT climateEntityId sinnvoll. */
  current?: number;
}

/* Statische Player-Metadaten (ADR-017 Addendum): nur id + name sind Konfig — die
   steuerbaren (playing/volume/source) und server-gepushten (track/artist/duration/
   available) Werte liegen im EntityStore (MediaValue) und werden über mergedMedia
   (state/media) gelesen, nicht hier. */
export interface MediaPlayerMeta { id: string; name: string }

/* Seed für den EntityStore: volle Ausgangs-Wahrheit inkl. optimistischer + Meta-
   Felder + Start-Position. `position` ist bewusst KEIN Entity-Feld (lokale
   Simulation, state/media) — der Seed trägt nur den Startwert. */
export interface MediaSeed extends MediaPlayerMeta {
  /** reale HA media_player.*-entity_id (ADR-018: explizite Map statt Konvention) */
  entityId: string;
  available: boolean; playing: boolean; volume: number; source: string | null;
  track: string | null; artist: string | null; duration: number; position: number;
}

export interface Episode {
  n: number; title: string; dur: number; watched: boolean; pos: number;
  /* Jellyfin-Item-Id der Folge (Funktionsumfang 9): nötig für PlaybackInfo/
     Progress-Reporting. Nur gesetzt, wenn die Folge aus der echten API stammt;
     die Fake-Folgen kennen keine Id (der Fake-Pfad ruft Jellyfin nie auf). */
  jfId?: string;
}

export interface Season { n: number; episodes: Episode[] }

export interface LibraryItem {
  id: string; type: 'movie' | 'series'; title: string; year: number; fsk: number;
  genres: string[]; hue: number; added: number; cw: number; overview: string;
  /* movie */ runtime?: number; pos?: number;
  /* series */ seasons?: Season[]; lastPlayed?: { season: number; ep: number } | null;
  /* Jellyfin-Artwork (ADR-008, Schritt 8): stabile Image-Tags fürs Caching.
     Nur gesetzt, wenn das Item aus der echten API stammt; die Fake-Daten
     bleiben beim `hue`-Platzhalter. Die Poster-URL baut die UI über
     `jellyfin.imageUrl(id, { tag })` zur passenden Render-Größe. */
  primaryTag?: string; backdropTag?: string; logoTag?: string;
}

export interface Playback {
  item: LibraryItem;
  season: number | null;
  ep: Episode | null;
  duration: number;
  position: number;
  playing: boolean;
  /* Live-Wiedergabe (Funktionsumfang 9): true, sobald ein echtes <video> mit
     HLS läuft. Dann treibt der Player-Timeupdate die Position — nicht der
     Fake-1-Hz-Tick (der schaltet sich ab). PlayerLayer.svelte setzt das Flag,
     sobald der Live-Modus greift; im Fake-Modus bleibt es undefined. */
  live?: boolean;
}

export interface SystemService {
  id: string; name: string; status: 'online' | 'degraded' | 'offline'; detail: string;
}

/* Generische Staffel für die Fake-Bibliothek (nur nicht-Feature-Serien —
   „Halbmond" hat handgeschriebene Folgentitel). watchedThrough = Folgen 1…n
   gelten als gesehen. */
function makeSeason(n: number, count: number, dur: number, watchedThrough = 0): Season {
  return {
    n,
    episodes: Array.from({ length: count }, (_, i) => ({
      n: i + 1, title: `Folge ${i + 1}`, dur, watched: i < watchedThrough, pos: 0,
    })),
  };
}

/* ── Seed = reale HA-Entitäten (ADR-018) ──
   6 Räume mit korrekten Entity-Mappings. 3 Räume haben Klima-Entitäten
   (Wohnzimmer/Schlafzimmer/Bad); Küche/Kinderzimmer/Flur haben nur Licht,
   kein `climateEntityId` → die UI blendet die Klima-Steuerung aus.
   `entityId` trägt die reale HA-`entity_id`; die on/brightness/target/current-
   Startwerte sind Fallback-Cache, bis das erste subscribe_entities-Echo greift.
   Ist-Temp: `current` (nur Klima-Räume) ist der Fallback-Cache fürs Thermostat-
   Ist; dedizierte Raum-Sensoren werden über `tempSensorId` gemappt und haben in
   der Anzeige Vorrang (roomTemperature(), state/commands.ts). Räume ohne beides
   zeigen keine Temperatur an. */
export const ROOM_SEED: RoomSeed[] = [
    {
      id: 'wohnzimmer', name: 'Wohnzimmer', target: 21.0, current: 23.5,
      hvac: 'heat', presence: true, windowOpen: false,
      climateEntityId: 'climate.wohnzimmer',
      // color/colorTemp-Flags sind Fallback (Fake/Offline) — gegen echtes HA
      // gilt die Laufzeit-Erkennung aus supported_color_modes (B-16B).
      lights: [
        { id: 'kugellampen', name: 'Kugellampen', entityId: 'light.wohnzimmer_kugellampen', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 2700, colorHex: null },
        { id: 'esstisch', name: 'Esstisch', entityId: 'light.wohnzimmer_esstisch', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 3000, colorHex: null, icon: 'i-lamp-pendant' },
        { id: 'kugel_tv', name: 'Kugellampe TV', entityId: 'light.wohnzimmer_tv', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 2700, colorHex: null },
        { id: 'kugel_fenster', name: 'Kugellampe Fenster', entityId: 'light.wohnzimmer_fensterlampe', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 4000, colorHex: null },
      ],
    },
    {
      id: 'kinderzimmer', name: 'Kinderzimmer',
      // Kein climate + kein dedizierter Sensor gemappt → keine Temp-Anzeige.
      // TODO: sensor.*-Raumtemperatur als tempSensorId eintragen, falls vorhanden.
      presence: false, windowOpen: false,
      lights: [
        // TODO: Kinderzimmer-Lichter zuordnen (aktuell keine smarten Lichter identifiziert)
      ],
    },
    {
      id: 'schlafzimmer', name: 'Schlafzimmer', target: 16.0, current: 23.0,
      hvac: 'heat', presence: false, windowOpen: false,
      climateEntityId: 'climate.schlafzimmer',
      lights: [
        { id: 'bett', name: 'Bett', entityId: 'light.schlafzimmer_bett', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 2700, colorHex: null },
        { id: 'schreibtisch', name: 'Schreibtisch', entityId: 'light.schlafzimmer_schreibtisch', on: false, brightness: 50, dimmable: true, colorTemp: true, colorTempK: 4000 },
      ],
    },
    {
      id: 'bad', name: 'Bad', target: 17.0, current: 22.5,
      hvac: 'heat', presence: false, windowOpen: false,
      climateEntityId: 'climate.bad',
      lights: [
        { id: 'spiegel', name: 'Spiegellicht', entityId: 'light.bad_spiegel', on: false, brightness: 50, dimmable: true, colorTemp: true, colorTempK: 4000 },
      ],
    },
    {
      id: 'kueche', name: 'Küche',
      // Kein climate + kein dedizierter Sensor gemappt → keine Temp-Anzeige.
      // TODO: sensor.*-Raumtemperatur als tempSensorId eintragen, falls vorhanden.
      presence: false, windowOpen: false,
      lights: [
        { id: 'ledfridge', name: 'LED-Leiste', entityId: 'light.kueche_ledleiste', on: false, brightness: 50, dimmable: true, color: true, colorHex: null, icon: 'i-led-strip' },
      ],
    },
    {
      id: 'flur', name: 'Flur',
      // Kein climate + kein dedizierter Sensor gemappt → keine Temp-Anzeige.
      // TODO: sensor.*-Raumtemperatur als tempSensorId eintragen, falls vorhanden.
      presence: false, windowOpen: false,
      lights: [
        // TODO: Flur-Lichter zuordnen (aktuell keine smarten Lichter identifiziert)
      ],
    },
];

/* Media-Seed = reale HA-Audio-Zonen (ADR-018): die beiden HomePods. Startwerte
   sind Fallback-Cache bis zum ersten Echo. `entityId` trägt die reale HA-`entity_id`.
   TODO: media_player.oled42/fernseher (TV) sind nicht als Raum-Audio gemappt. */
export const MEDIA_SEED: MediaSeed[] = [
  {
    id: 'wohnzimmer', name: 'Wohnzimmer', entityId: 'media_player.wohnzimmer_speaker',
    available: true, playing: false,
    track: null, artist: null, source: null,
    volume: 30, duration: 0, position: 0,
  },
  {
    id: 'kueche', name: 'Küche', entityId: 'media_player.kueche_speaker',
    available: true, playing: false,
    track: null, artist: null, source: null,
    volume: 30, duration: 0, position: 0,
  },
];

/* ── Read-only-Ambient-Entitäten (ADR-018) ──
   `sun.sun` ist eine Standard-HA-Entität (immer vorhanden) und treibt die
   Day/Night-Automatik (docs/07 Screen 9). Die Energie-Sensoren sind dagegen
   installationsspezifisch — ihre realen entity_ids kennt nur die HA-Instanz.
   TODO: echte PV-/Last-/Tages-Sensor-IDs eintragen. Nicht gesetzte
   (null) Sensoren → Node inaktiv bzw. KPI „—" (gleiche Graceful-Absence wie
   bei Räumen ohne climate.*). PV/Last kommen live über subscribe_entities;
   der Netz-Fluss wird aus (PV − Last) abgeleitet, die Tages-KPIs aus
   Tages-Total-Sensoren (utility_meter o. Ä.). */
export const SUN_ENTITY = 'sun.sun';

export type EnergySensorRef = string | readonly string[] | null;

/* Eine einzelne, benannte Lastquelle (B-19): trägt neben der realen entity_id
   ein lesbares Label für Legende/Kuchensegment und optional eine Gruppe, unter
   der mehrere Quellen zu EINEM Segment zusammenfallen. Die Summenbildung der
   „Erfassten Last" bleibt identisch (Summe über alle entityId). */
export interface LoadSource {
  /** reale HA-`entity_id` des Leistungssensors (W oder kW) */
  entityId: string;
  /** menschenlesbares Label für Legende/Segment */
  label: string;
  /** optionale Gruppierung: gleich benannte Quellen fallen zu EINEM Segment zusammen */
  group?: string;
}

export interface EnergySensors {
  /** aktuelle PV-Erzeugung (W oder kW — Einheit wird normalisiert) */
  pv: EnergySensorRef;
  /** aktuelle Last (W oder kW); alle Quellen werden zur „Erfassten Last" summiert. */
  load: readonly LoadSource[];
  /** Tages-Erzeugung (Wh oder kWh) */
  producedToday: EnergySensorRef;
  /** Tages-Verbrauch */
  consumedToday: EnergySensorRef;
  /** Tages-Einspeisung */
  fedInToday: EnergySensorRef;
  /** Tages-Netzbezug */
  drawnToday: EnergySensorRef;
}

/* Flache Liste konfigurierter entity_ids eines ENERGY_SENSORS-Werts (null → []).
   Deckt alle drei Formen ab: Einzel-ID, ID-Liste und Lastquellen-Objekte. Eine
   Stelle für Subscription (entities.ts), Summenbildung (energy.svelte.ts) und
   Tests, damit das Datenmodell-Format nur hier interpretiert wird. */
export function energyRefIds(ref: EnergySensorRef | readonly LoadSource[]): string[] {
  if (!ref) return [];
  if (typeof ref === 'string') return [ref];
  return ref.map((item) => (typeof item === 'string' ? item : item.entityId));
}
export const ENERGY_SENSORS: EnergySensors = {
  // Live geprüft 2026-07-09: keine eindeutigen PV-/Netz-/Hausanschluss-Sensoren
  // vorhanden. Deshalb kein geratenes PV/Grid-Mapping.
  pv: null,
  // Echte HA-Leistungssensoren für erfasste Steckdosen/Geräte. Das ist bewusst
  // „erfasste Last", nicht vollständige Hauslast. Labels sind aus der entity_id
  // abgeleitet (B-19) und per Geräte-Detail umbenennbar; die beiden Shelly-Kanäle
  // fallen über `group` zu einem Legenden-Segment zusammen.
  load: [
    { entityId: 'sensor.strom_leiste_kanal_1_power', label: 'Steckdosenleiste Kanal 1', group: 'Steckdosenleiste' },
    { entityId: 'sensor.strom_leiste_kanal_2_power', label: 'Steckdosenleiste Kanal 2', group: 'Steckdosenleiste' },
    { entityId: 'sensor.waschmaschine_strom_power', label: 'Waschmaschine' },
    { entityId: 'sensor.strom_schreibtisch_links_power', label: 'Schreibtisch links' },
    { entityId: 'sensor.strom_bad_klein_power', label: 'Bad (klein)' },
    { entityId: 'sensor.strom_schlafzimmer_tuer_power', label: 'Schlafzimmer Tür' },
    { entityId: 'sensor.strom_wohnzimmer_regal_power', label: 'Wohnzimmer Regal' },
    { entityId: 'sensor.strom_couch_lang_power', label: 'Couch' },
    { entityId: 'sensor.strom_glastuer_power', label: 'Glastür' },
    { entityId: 'sensor.strom_spuele_power', label: 'Spüle' },
    { entityId: 'sensor.strom_kinderzimmer_tuer_power', label: 'Kinderzimmer Tür' },
    { entityId: 'sensor.strom_zigbee_steckdose_power', label: 'Zigbee-Steckdose' },
    { entityId: 'sensor.strom_trockner_power', label: 'Trockner' },
    { entityId: 'sensor.strom_kaffeemaschine_power', label: 'Kaffeemaschine' },
    { entityId: 'sensor.strom_server_power', label: 'Server' },
  ],
  // Erzeugung/Einspeisung/Netzbezug brauchen PV bzw. einen Netzzähler — beides
  // nicht vorhanden → bewusst null (Graceful Absence, nicht geraten).
  producedToday: null,
  // Tages-Verbrauch der erfassten Last: HA-utility_meter (cycle: daily) auf einem
  // template-Summensensor der 15 *_energy-Zählerstände (configuration.yaml,
  // 2026-07-09). Startet ab Erstellung bei 0 → heute Teilwert, ab morgen 0-Uhr voll.
  // Die restlichen *_energy sind reine Zählerstände, keine Tageswerte.
  consumedToday: 'sensor.hmi_erfasste_last_taeglich',
  fedInToday: null,
  drawnToday: null,
};

export const appState = $state({
  theme: 'dark' as 'dark' | 'light',
  currentRoom: null as string | null,
  // Statische Projektion des Seeds (ADR-017): steuerbare Felder bewusst weg —
  // die kommen aus dem EntityStore über die gemergte Sicht.
  rooms: buildRuntimeRooms(ROOM_SEED, mergeCatalog(seedCatalog(ROOM_SEED), []), loadDeviceConfig()),
  scenes: ['Gemütlich', 'Hell', 'Aus'],
  // Energie (docs/07 Screen 10): die Live-Sicht liegt in state/energy.svelte.ts
  // und liest reale HA-Sensoren (ENERGY_SENSORS) über den Adapter-Seam — kein
  // Fake-State mehr im appState.
  media: {
    current: 'wohnzimmer',
    // Statische Player-Liste (id/name); steuerbare + gepushte Werte kommen aus
    // dem EntityStore über mergedMedia (ADR-017 Addendum).
    players: MEDIA_SEED.map(({ id, name }): MediaPlayerMeta => ({ id, name })),
    // Preset-Grid (docs/06 §4: Ghost-Cards, Hauser-Radio-Pattern)
    presets: [
      { label: 'Radio', value: '1LIVE' },
      { label: 'Radio', value: 'WDR 2' },
      { label: 'Playlist', value: 'Morgen-Mix' },
      { label: 'Playlist', value: 'Abendruhe' },
    ],
  },
  /* Jellyfin-Bibliothek (docs/07 Screens 6–8, docs/08): Fake-Daten mit
     Poster-Platzhaltern — pro Item ein Farbton (--ph) statt Artwork;
     echte Poster kommen über /Items/{id}/Images/Primary?maxWidth&tag.
     pos/ep.pos in Sekunden = Resume-Punkt (Jellyfin: PositionTicks). */
  library: {
    currentId: null as string | null,
    season: 1, // im Detail ausgewählte Staffel
    items: [
      {
        id: 'signal', type: 'movie', title: 'Signal aus der Tiefe', year: 2025, fsk: 12,
        genres: ['Science-Fiction'], hue: 258, runtime: 8280, added: 1, pos: 0, cw: 0,
        overview: 'Eine Forschungsstation im Nordatlantik empfängt ein Muster, das es nicht geben dürfte. Die Ozeanografin Marla Jansen muss entscheiden, wem sie die Entdeckung meldet — und wem besser nicht.',
      },
      {
        id: 'gletscherlicht', type: 'movie', title: 'Gletscherlicht', year: 2025, fsk: 12,
        genres: ['Drama'], hue: 205, runtime: 7680, added: 2, pos: 2880, cw: 3,
        overview: 'Nach dem Tod ihres Vaters kehrt die Glaziologin Ada Brenner ins Hochtal ihrer Kindheit zurück. Zwischen schmelzendem Eis und alten Rechnungen findet sie ein Tagebuch, das die Geschichte des Dorfes neu schreibt.',
      },
      {
        id: 'letzte-schicht', type: 'movie', title: 'Die letzte Schicht', year: 2024, fsk: 16,
        genres: ['Thriller'], hue: 12, runtime: 6240, added: 9, pos: 0, cw: 0,
        overview: 'Im stillgelegten Bergwerk Konrad II soll eine letzte Nachtschicht die Pumpen abstellen. Als der Aufzug ausfällt, merkt Steiger Wollny, dass jemand von der Belegschaft nicht auf der Liste steht.',
      },
      {
        id: 'nordwind', type: 'movie', title: 'Nordwind', year: 2023, fsk: 6,
        genres: ['Abenteuer'], hue: 150, runtime: 5760, added: 8, pos: 0, cw: 0,
        overview: 'Die zwölfjährige Juno segelt mit ihrem Großvater das alte Postboot die Küste hinauf — gegen den Wind, gegen die Zeit und gegen den Plan ihrer Eltern, das Boot zu verkaufen.',
      },
      {
        id: 'kastanienjahre', type: 'movie', title: 'Kastanienjahre', year: 2022, fsk: 12,
        genres: ['Drama'], hue: 35, runtime: 6720, added: 11, pos: 0, cw: 0,
        overview: 'Drei Geschwister erben das Gasthaus ihrer Mutter — und mit ihm die Frage, warum der Vater 1989 nicht zurückkam. Ein Sommer zwischen Renovierung und Wahrheit.',
      },
      {
        id: 'paralleltal', type: 'movie', title: 'Paralleltal', year: 2024, fsk: 16,
        genres: ['Mystery'], hue: 290, runtime: 7260, added: 7, pos: 1080, cw: 1,
        overview: 'Ein Vermessungsingenieur findet in den Karten zweier Jahrzehnte dasselbe Seitental — nur liegt es jedes Mal woanders. Je genauer er misst, desto weniger stimmt die Landschaft.',
      },
      {
        id: 'acht-stunden', type: 'movie', title: 'Acht Stunden', year: 2021, fsk: 16,
        genres: ['Thriller'], hue: 0, runtime: 5340, added: 12, pos: 0, cw: 0,
        overview: 'Eine Nachtdienst-Ärztin, ein abgeriegeltes Kreiskrankenhaus, ein Patient ohne Akte. Acht Stunden bis zur Frühschicht — erzählt in Echtzeit.',
      },
      {
        id: 'sommer-marseille', type: 'movie', title: 'Sommer in Marseille', year: 2023, fsk: 6,
        genres: ['Komödie'], hue: 45, runtime: 6060, added: 6, pos: 0, cw: 0,
        overview: 'Der pensionierte Lokführer Herbert Kaminski will nur seinen Koffer zurück. Die Fluggesellschaft schickt ihn dafür quer durch Marseille — und mitten in die Familienfeier der Fahrerin Amira.',
      },
      {
        id: 'kartograf', type: 'movie', title: 'Der Kartograf', year: 2020, fsk: 12,
        genres: ['Historie'], hue: 190, runtime: 8040, added: 13, pos: 0, cw: 0,
        overview: '1783: Der junge Kartograf Elias Vogt soll das Erzgebirge neu vermessen. Doch seine Karten zeigen, was der Hof nicht sehen will — leere Dörfer, verlassene Gruben, hungernde Täler.',
      },
      {
        id: 'blaupause', type: 'movie', title: 'Blaupause', year: 2025, fsk: 0,
        genres: ['Dokumentation'], hue: 220, runtime: 5220, added: 4, pos: 0, cw: 0,
        overview: 'Wie baut man eine Stadt, die es noch nicht gibt? Zwei Jahre hinter den Kulissen des größten Holzbau-Quartiers Europas — vom ersten Modell bis zum Einzug.',
      },
      {
        id: 'halbmond', type: 'series', title: 'Halbmond', year: 2024, fsk: 16,
        genres: ['Spionage', 'Drama'], hue: 230, added: 5, cw: 4,
        lastPlayed: { season: 2, ep: 4 },
        overview: 'Ost-Berlin, 1983: Die Übersetzerin Vera Salt führt ein Doppelleben zwischen zwei Diensten. Als ihr Führungsoffizier verschwindet, weiß sie nicht mehr, für wen ihre Berichte eigentlich bestimmt sind.',
        seasons: [
          { n: 1, episodes: [
            { n: 1, title: 'Ankunft', dur: 3060, watched: true, pos: 0 },
            { n: 2, title: 'Deckname Aster', dur: 2940, watched: true, pos: 0 },
            { n: 3, title: 'Der Brief', dur: 3000, watched: true, pos: 0 },
            { n: 4, title: 'Tote Winkel', dur: 3120, watched: true, pos: 0 },
            { n: 5, title: 'Grenzverkehr', dur: 2880, watched: true, pos: 0 },
            { n: 6, title: 'Das Archiv', dur: 3060, watched: true, pos: 0 },
            { n: 7, title: 'Nachtfahrt', dur: 2940, watched: true, pos: 0 },
            { n: 8, title: 'Übergabe', dur: 3300, watched: true, pos: 0 },
          ] },
          { n: 2, episodes: [
            { n: 1, title: 'Rückkehr', dur: 3060, watched: true, pos: 0 },
            { n: 2, title: 'Alte Schulden', dur: 2940, watched: true, pos: 0 },
            { n: 3, title: 'Doppelgänger', dur: 3000, watched: true, pos: 0 },
            { n: 4, title: 'Das Netz', dur: 3120, watched: false, pos: 1250 },
            { n: 5, title: 'Stille Post', dur: 2940, watched: false, pos: 0 },
            { n: 6, title: 'Gegenlicht', dur: 3060, watched: false, pos: 0 },
            { n: 7, title: 'Maulwurf', dur: 2940, watched: false, pos: 0 },
            { n: 8, title: 'Endspiel', dur: 3480, watched: false, pos: 0 },
          ] },
        ],
      },
      {
        id: 'revier', type: 'series', title: 'Revier', year: 2023, fsk: 12,
        genres: ['Krimi'], hue: 80, added: 10, cw: 0, lastPlayed: null,
        overview: 'Eine Kommissarin kehrt aus Hamburg zurück ins Ruhrgebiet ihrer Jugend. Jeder Fall führt tiefer in ein Geflecht aus Zechen-Erbe, Familienbanden und Dingen, über die man im Revier nicht spricht.',
        seasons: [makeSeason(1, 6, 2700, 6), makeSeason(2, 6, 2700, 6), makeSeason(3, 6, 2760, 2)],
      },
      {
        id: 'station-nord', type: 'series', title: 'Station Nord', year: 2025, fsk: 12,
        genres: ['Science-Fiction'], hue: 180, added: 3, cw: 0, lastPlayed: null,
        overview: 'Sechs Überwinterer, eine Polarstation, neun Monate Dunkelheit. Als der Funkkontakt abbricht, empfängt die Station weiter Nachrichten — abgestempelt mit dem Datum des nächsten Frühjahrs.',
        seasons: [makeSeason(1, 8, 2820)],
      },
      {
        id: 'werkstatt', type: 'series', title: 'Die Werkstatt', year: 2022, fsk: 6,
        genres: ['Comedy'], hue: 25, added: 14, cw: 0, lastPlayed: null,
        overview: 'Halb Autowerkstatt, halb Dorfparlament: Bei Meisterin Rosi Lindner wird mehr repariert als nur Autos. Vier Staffeln über Kundschaft, Kaffee und die große Frage, wem der Parkplatz vorm Tor gehört.',
        seasons: [makeSeason(1, 10, 1560, 10), makeSeason(2, 10, 1560, 10), makeSeason(3, 10, 1620, 10), makeSeason(4, 10, 1620, 4)],
      },
      {
        id: 'tiefgang', type: 'series', title: 'Tiefgang', year: 2024, fsk: 16,
        genres: ['Drama'], hue: 320, added: 15, cw: 2,
        lastPlayed: { season: 1, ep: 2 },
        overview: 'Eine Binnenschifferfamilie, drei Generationen, ein Frachter mit Hypothek. Zwischen Rotterdam und Basel verhandelt jede Fahrt neu, wer an Bord das Sagen hat — und wer von Bord geht.',
        seasons: [makeSeason(1, 6, 2580, 1), makeSeason(2, 6, 2640)],
      },
      {
        id: 'funkstille', type: 'series', title: 'Funkstille', year: 2021, fsk: 12,
        genres: ['Mystery'], hue: 265, added: 16, cw: 0, lastPlayed: null,
        overview: 'Ein Küstenort verliert für sieben Minuten jede Verbindung zur Außenwelt — Netz, Radio, Festnetz. Niemand erinnert sich an die Zeit dazwischen. Dann tauchen die ersten Aufnahmen auf.',
        seasons: [makeSeason(1, 8, 2640, 8), makeSeason(2, 8, 2640, 8), makeSeason(3, 8, 2700)],
      },
    ] as LibraryItem[],
  },
  playback: null as Playback | null, // aktive (Fake-)Wiedergabe im Player-Layer
  system: {
    services: [
      { id: 'ha', name: 'Home Assistant', status: 'online', detail: 'Version 2026.6.4 · 885 Entitäten' },
      { id: 'z2m', name: 'Zigbee2MQTT', status: 'online', detail: '27 Geräte verbunden' },
      { id: 'mqtt', name: 'MQTT Broker', status: 'online', detail: 'Verbunden' },
      { id: 'tunnel', name: 'Cloudflared Tunnel', status: 'degraded', detail: '1/2 Routen aktiv' },
      { id: 'adguard', name: 'AdGuard', status: 'online', detail: '142.853 Anfragen heute' },
    ] as SystemService[],
    updates: [
      { name: 'Home Assistant Core', from: '2026.6.4', to: '2026.7.1' },
      { name: 'Home Assistant OS', from: '15.2', to: '15.3' },
      { name: 'Zigbee2MQTT', from: '2.4.0', to: '2.5.1' },
      { name: 'ESPHome', from: '2026.5.2', to: '2026.6.0' },
      { name: 'AdGuard Home', from: '0.107.60', to: '0.107.62' },
      { name: 'Matter Server', from: '7.0.1', to: '7.1.0' },
    ],
  },
});

/* Resume-Punkt in einer generierten Staffel nachtragen (Tiefgang S1E2 läuft) */
appState.library.items.find((i) => i.id === 'tiefgang')!.seasons![0].episodes[1].pos = 2050;

// Dev-Handle: appState im Preview-Browser inspizierbar (window.__hmi.appState).
if (typeof window !== 'undefined') {
  const w = window as unknown as { __hmi?: Record<string, unknown> };
  w.__hmi = { ...(w.__hmi ?? {}), appState };
}

/* SystemStatus-Zustände (docs/06 §6) — Dot + Label aus einer Quelle */
export const SERVICE_STATUS = {
  online: { label: 'Verbunden', dot: 'dot-online' },
  degraded: { label: 'Eingeschränkt', dot: 'dot-warning' },
  offline: { label: 'Nicht erreichbar', dot: 'dot-offline' },
} as const;

export const HVAC_MODES = [
  { id: 'heat', label: 'Heizen', icon: 'i-flame' },
  { id: 'cool', label: 'Kühlen', icon: 'i-snow' },
  { id: 'off', label: 'Aus', icon: 'i-power' },
] as const;

/* Fake-Command-Dispatch: loggt nur; die Anbindungs-Session ersetzt das durch
   CommandQueue → WebSocket (ADR-015). Der optimistische UI-Update ist zu
   diesem Zeitpunkt bereits passiert. */
export function sendCommand(domain: string, service: string, data: Record<string, unknown>) {
  console.log(`[fake-ha] ${domain}.${service}`, data);
}

/* Fake-Jellyfin-Dispatch (analog sendCommand): loggt nur; später REST-API
   (/Sessions/Playing, /Sessions/Playing/Progress, … — docs/08) */
export function sendJellyfin(endpoint: string, data: Record<string, unknown>) {
  console.log(`[fake-jellyfin] ${endpoint}`, data);
}

/* ── Räume ── */
export function currentRoom(): Room | undefined {
  return appState.rooms.find((r) => r.id === appState.currentRoom);
}

/* ── Energie ── */

/* Deterministischer 24-h-Verlauf als PLATZHALTER für den Tagesverlauf-Chart.
   Der echte historische Verlauf braucht die HA-Statistics-API
   (`recorder/statistics_during_period`) — ein separater WS-Request außerhalb
   des subscribe_entities-Seams — und ist als Folge-Schritt zurückgestellt
   (BACKLOG). Live-Fluss + Tages-KPIs (state/energy.svelte.ts) sind bereits real.
   Kein Math.random: der Chart sieht bei jedem Aufbau gleich aus. */
export const ENERGY_CURVE = Array.from({ length: 24 }, (_, h) => {
  const wave = (n: number) => Math.abs(Math.sin(h * n + 1.7)) * 0.12; // organisches Rauschen
  const prod = h < 6 || h > 20 ? 0 : Math.max(0, Math.sin(((h - 6) / 14) * Math.PI) - wave(2.3));
  const load = Math.min(1,
    0.22 + wave(3.1)
    + (h >= 6 && h <= 9 ? 0.4 : 0)
    + (h >= 17 && h <= 22 ? 0.55 : 0)
    + (h >= 12 && h <= 13 ? 0.18 : 0));
  return { prod, load };
});

/* ── Bibliothek (docs/07 Screens 6–8, docs/08) ── */
let cwSeq = 100; // Weiterschauen-Reihenfolge: zuletzt gespielt zuerst

export function libItem(id: string | null): LibraryItem | undefined {
  return appState.library.items.find((i) => i.id === id);
}

export function epOf(item: LibraryItem, seasonN: number, epN: number): Episode | null {
  return item.seasons?.find((s) => s.n === seasonN)?.episodes.find((e) => e.n === epN) ?? null;
}

export interface ResumeTarget {
  season?: number; ep?: Episode; pos: number; dur: number; resume: boolean;
}

/* Resume-Ziel eines Items: Film = eigener Punkt, Serie = angefangene bzw.
   erste ungesehene Folge (Jellyfin-NextUp-Logik, vereinfacht) */
export function resumeTarget(item: LibraryItem): ResumeTarget {
  if (item.type === 'movie') {
    return { pos: item.pos!, dur: item.runtime!, resume: item.pos! > 0 };
  }
  if (item.lastPlayed) {
    const ep = epOf(item, item.lastPlayed.season, item.lastPlayed.ep);
    if (ep && ep.pos > 0) return { season: item.lastPlayed.season, ep, pos: ep.pos, dur: ep.dur, resume: true };
  }
  const seasons = item.seasons ?? [];
  for (const s of seasons) {
    const ep = s.episodes.find((e) => !e.watched);
    if (ep) return { season: s.n, ep, pos: ep.pos, dur: ep.dur, resume: ep.pos > 0 };
  }
  const s0 = seasons.find((s) => s.episodes.length); // erste Staffel mit Folgen
  if (!s0) {
    // Live-Serie noch nicht hydriert (keine Folgen geladen) — sicheres Ziel
    // ohne Folge; die Detail-Screen zeigt bis dahin einen Ladezustand.
    return { season: seasons[0]?.n ?? item.lastPlayed?.season ?? 1, pos: 0, dur: 0, resume: false };
  }
  return { season: s0.n, ep: s0.episodes[0], pos: 0, dur: s0.episodes[0].dur, resume: false };
}

/* Weiterschauen-Info für die MediaCard: Fortschritts-Anteil + Meta-Zeile */
export function continueInfo(item: LibraryItem): { frac: number; meta: string } | null {
  if (item.type === 'movie') {
    return item.pos! > 0
      ? { frac: item.pos! / item.runtime!, meta: `Noch ${Math.round((item.runtime! - item.pos!) / 60)} min` }
      : null;
  }
  if (!item.lastPlayed) return null;
  const ep = epOf(item, item.lastPlayed.season, item.lastPlayed.ep);
  return ep && ep.pos > 0
    ? { frac: ep.pos / ep.dur, meta: `S${item.lastPlayed.season} · E${ep.n}` }
    : null;
}

/* Media Detail öffnen (docs/07 Screen 7): Staffel-Vorauswahl folgt dem
   Resume-Ziel; Navigation als echter Unter-Screen mit Back (anders als
   das Room Overlay) */
export function openMediaItem(id: string) {
  const item = libItem(id)!;
  appState.library.currentId = id;
  appState.library.season = item.type === 'series' ? resumeTarget(item).season! : 1;
  showScreen('library-detail');
}

/* ── Player (docs/07 Screen 8): Playback-State; das Chrome-Verhalten
   (Auto-Hide) lebt in PlayerLayer.svelte ── */

/* Fortschritt zurück in die Bibliothek schreiben (Fake-Pendant zum
   Progress-Reporting, docs/08) — kurz vor Ende gilt als gesehen */
export function writeThrough(pb: Playback) {
  const nearEnd = pb.position >= pb.duration * 0.97;
  if (pb.ep) {
    pb.ep.pos = nearEnd ? 0 : Math.round(pb.position);
    if (nearEnd) pb.ep.watched = true;
    pb.item.lastPlayed = { season: pb.season!, ep: pb.ep.n };
  } else {
    pb.item.pos = nearEnd ? 0 : Math.round(pb.position);
  }
}

/* Vorherige/nächste Folge über Staffelgrenzen hinweg (Filme: null) */
export function adjacentEpisode(pb: Playback, dir: 1 | -1): { season: number; ep: Episode } | null {
  if (!pb.ep) return null;
  const flat: { season: number; ep: Episode }[] = [];
  pb.item.seasons!.forEach((s) => s.episodes.forEach((e) => flat.push({ season: s.n, ep: e })));
  const idx = flat.findIndex((x) => x.season === pb.season && x.ep.n === pb.ep!.n);
  return flat[idx + dir] ?? null;
}

export function openPlayer(item: LibraryItem, epRef: { season: number; ep: Episode } | null, startPos: number) {
  item.cw = ++cwSeq; // frisch gespielt → vorn im Weiterschauen-Shelf
  const duration = epRef ? epRef.ep.dur : item.runtime!;
  appState.playback = {
    item,
    season: epRef?.season ?? null,
    ep: epRef?.ep ?? null,
    duration,
    position: Math.min(startPos, duration - 1),
    playing: true,
  };
  writeThrough(appState.playback); // „Von vorne" verwirft den alten Punkt sofort
  sendJellyfin('Sessions/Playing', {
    item: item.id,
    episode: epRef ? `S${epRef.season}E${epRef.ep.n}` : null,
    position: Math.round(appState.playback.position),
  });
}

export function closePlayer() {
  const pb = appState.playback;
  if (!pb) return;
  writeThrough(pb);
  sendJellyfin('Sessions/Playing/Stopped', { item: pb.item.id, position: Math.round(pb.position) });
  appState.playback = null;
}

/* ── Ticks (Fake; später: HA-Push) — State-Ebene, kein Animations-Timer.
   Anders als im Clickdummy muss hier niemand prüfen, ob der Screen sichtbar
   ist: Svelte updated nur die DOM-Knoten, die den Wert wirklich zeigen. ── */

/* Der 1-Hz-Fortschritt des Raum-Audios ist lokale Simulation über die gemergte
   Sicht und lebt in state/media.svelte.ts (ADR-017 Addendum) — nicht hier, weil
   media_player jetzt durch den Adapter-Seam läuft. */

/* Fake-Wiedergabe: 1-Hz-Tick; am Ende pausiert der Player und markiert die
   Folge/den Film als gesehen (Chrome-Reaktion: PlayerLayer.svelte) */
setInterval(() => {
  const pb = appState.playback;
  if (!pb || !pb.playing || pb.live) return; // Live: der <video>-Timeupdate treibt die Position
  pb.position = Math.min(pb.duration, pb.position + 1);
  writeThrough(pb);
  if (pb.position >= pb.duration) {
    pb.playing = false;
    sendJellyfin('Sessions/Playing/Stopped', { item: pb.item.id, ended: true });
  }
}, 1000);
