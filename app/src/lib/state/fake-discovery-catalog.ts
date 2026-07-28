/* Side-effect-free catalog contract and FakeBackend defaults.
   Keep this module independent of storage and application runtime state so
   isolated runtimes can consume the same catalog truth without loading them. */

export const MANAGED_DOMAINS = [
  'light', 'switch', 'sensor', 'binary_sensor', 'climate', 'media_player', 'cover', 'fan', 'input_boolean',
] as const;
export type ManagedDomain = (typeof MANAGED_DOMAINS)[number];

export interface EntityCatalogItem {
  entityId: string;
  domain: ManagedDomain;
  name: string;
  area?: string | null;
  unit?: string | null;
  deviceClass?: string | null;
  capabilities?: Partial<{
    dimmable: boolean;
    colorTemp: boolean;
    color: boolean;
    colorTempMin: number;
    colorTempMax: number;
  }>;
}

export const FAKE_DISCOVERY_CATALOG: EntityCatalogItem[] = [
  {
    entityId: 'switch.steckdose_wohnzimmer_regal',
    domain: 'switch',
    name: 'Regal Steckdose',
    area: 'wohnzimmer',
  },
  {
    entityId: 'light.flur_deckenlicht',
    domain: 'light',
    name: 'Deckenlicht Flur',
    area: 'flur',
    capabilities: { dimmable: false, colorTemp: false, color: false },
  },
  {
    // Tunable-White mit gemeldeter Kelvin-Range (B-16B): die Farbtemp-Skala
    // der Detail-Ebene folgt min/max des Geräts statt der fixen UI-Range.
    entityId: 'light.demo_stehlampe',
    domain: 'light',
    name: 'Stehlampe',
    area: 'schlafzimmer',
    capabilities: { dimmable: true, colorTemp: true, color: false, colorTempMin: 2700, colorTempMax: 5000 },
  },
  {
    entityId: 'sensor.demo_aussentemperatur',
    domain: 'sensor',
    name: 'Außentemperatur',
    area: 'wohnzimmer',
    unit: '°C',
    deviceClass: 'temperature',
  },
  {
    entityId: 'climate.demo_buero',
    domain: 'climate',
    name: 'Heizung Büro',
    area: 'buero',
  },
];
