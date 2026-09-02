import { describe, expect, it } from 'vitest';
import {
  addSceneMember,
  buildSceneCommands,
  deleteScene,
  defaultSceneMembers,
  EMPTY_SCENE_CONFIG,
  isSceneCustomized,
  loadSceneConfig,
  parseSceneConfig,
  removeSceneMember,
  resetSceneOverride,
  resolveSceneMembers,
  saveSceneConfig,
  sceneDef,
  sceneList,
  sceneMemberStateFromValue,
  sceneOverride,
  SCENE_CONFIG_KEY,
  SCENES,
  type SceneConfig,
  type SceneStorage,
} from './scene-config.ts';

class MemoryStorage implements SceneStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const roomDevices = [
  { entityId: 'light.wohnzimmer_kugellampen' },
  { entityId: 'light.wohnzimmer_esstisch' },
  { entityId: 'switch.steckdose_regal' },   // Schalter ist NICHT Default
  { entityId: 'sensor.aussentemperatur' },  // andere Domänen nie Default
];
const defaults = defaultSceneMembers(roomDevices);

describe('scene-config Defaults + Auflösung', () => {
  it('Default-Mitglieder sind genau die Raum-Lichter', () => {
    expect(defaults).toEqual(['light.wohnzimmer_kugellampen', 'light.wohnzimmer_esstisch']);
  });

  it('ohne Override gilt der Default (dynamisch: neue Lichter nehmen teil)', () => {
    expect(resolveSceneMembers(defaults)).toEqual(defaults);
    const grown = defaultSceneMembers([...roomDevices, { entityId: 'light.neu' }]);
    expect(resolveSceneMembers(grown)).toContain('light.neu');
  });

  it('exclude entfernt Defaults, include ergänzt Fremd-Geräte (stabil geordnet)', () => {
    const members = resolveSceneMembers(defaults, {
      include: ['switch.steckdose_regal'],
      exclude: ['light.wohnzimmer_esstisch'],
    });
    expect(members).toEqual(['light.wohnzimmer_kugellampen', 'switch.steckdose_regal']);
  });
});

describe('scene-config Updates', () => {
  it('erlaubt das Löschen der letzten Szene eines Raums', () => {
    let config = EMPTY_SCENE_CONFIG;
    for (const scene of SCENES) config = deleteScene(config, 'wohnzimmer', scene.id);
    expect(sceneList(config, 'wohnzimmer')).toEqual([]);
  });

  it('Entfernen eines Default-Lichts landet im exclude, Wieder-Hinzufügen räumt es', () => {
    let config: SceneConfig = EMPTY_SCENE_CONFIG;
    config = removeSceneMember(config, 'wohnzimmer', 'gemuetlich', 'light.wohnzimmer_esstisch', defaults);
    expect(sceneOverride(config, 'wohnzimmer', 'gemuetlich')?.exclude).toEqual(['light.wohnzimmer_esstisch']);
    expect(isSceneCustomized(config, 'wohnzimmer', 'gemuetlich')).toBe(true);

    config = addSceneMember(config, 'wohnzimmer', 'gemuetlich', 'light.wohnzimmer_esstisch', defaults);
    // leerer Override wird normalisiert entfernt → wieder Standard
    expect(sceneOverride(config, 'wohnzimmer', 'gemuetlich')).toBeUndefined();
    expect(isSceneCustomized(config, 'wohnzimmer', 'gemuetlich')).toBe(false);
  });

  it('Hinzufügen/Entfernen eines Nicht-Default-Schalters läuft über include', () => {
    let config = addSceneMember(EMPTY_SCENE_CONFIG, 'wohnzimmer', 'hell', 'switch.steckdose_regal', defaults);
    expect(sceneOverride(config, 'wohnzimmer', 'hell')?.include).toEqual(['switch.steckdose_regal']);
    // idempotent
    config = addSceneMember(config, 'wohnzimmer', 'hell', 'switch.steckdose_regal', defaults);
    expect(sceneOverride(config, 'wohnzimmer', 'hell')?.include).toEqual(['switch.steckdose_regal']);

    config = removeSceneMember(config, 'wohnzimmer', 'hell', 'switch.steckdose_regal', defaults);
    expect(sceneOverride(config, 'wohnzimmer', 'hell')).toBeUndefined();
  });

  it('nicht szenenfähige Entitäten (sensor.*, climate.*) werden nie aufgenommen', () => {
    const config = addSceneMember(EMPTY_SCENE_CONFIG, 'wohnzimmer', 'hell', 'sensor.aussentemperatur', defaults);
    expect(config).toEqual(EMPTY_SCENE_CONFIG);
  });

  it('Szenen eines Raums sind unabhängig; reset trifft nur eine', () => {
    let config = removeSceneMember(EMPTY_SCENE_CONFIG, 'wohnzimmer', 'aus', 'light.wohnzimmer_esstisch', defaults);
    config = addSceneMember(config, 'wohnzimmer', 'hell', 'switch.steckdose_regal', defaults);
    config = resetSceneOverride(config, 'wohnzimmer', 'aus');
    expect(sceneOverride(config, 'wohnzimmer', 'aus')).toBeUndefined();
    expect(sceneOverride(config, 'wohnzimmer', 'hell')?.include).toEqual(['switch.steckdose_regal']);
  });

  it('Updates mutieren die Ausgangs-Config nicht', () => {
    const before = removeSceneMember(EMPTY_SCENE_CONFIG, 'bad', 'aus', 'light.spiegel', ['light.spiegel']);
    const snapshot = JSON.parse(JSON.stringify(before));
    addSceneMember(before, 'bad', 'aus', 'switch.luefter', ['light.spiegel']);
    resetSceneOverride(before, 'bad', 'aus');
    expect(before).toEqual(snapshot);
  });
});

describe('scene-config Persistenz', () => {
  it('Roundtrip über Storage', () => {
    const storage = new MemoryStorage();
    const config = addSceneMember(EMPTY_SCENE_CONFIG, 'wohnzimmer', 'gemuetlich', 'switch.steckdose_regal', defaults);
    expect(saveSceneConfig(config, storage)).toBe(true);
    expect(loadSceneConfig(storage)).toEqual(config);
  });

  it('kaputte/fremde Daten fallen auf leere Config zurück', () => {
    const storage = new MemoryStorage();
    storage.setItem(SCENE_CONFIG_KEY, '{kaputt');
    expect(loadSceneConfig(storage)).toEqual(EMPTY_SCENE_CONFIG);
    expect(parseSceneConfig(JSON.stringify({ version: 99, rooms: {} }))).toEqual(EMPTY_SCENE_CONFIG);
  });

  it('validiert unbekannte Szenen und nicht szenenfähige Entitäten weg', () => {
    const parsed = parseSceneConfig(JSON.stringify({
      version: 1,
      rooms: {
        wohnzimmer: {
          gemuetlich: { include: ['switch.ok', 'sensor.nope', 42], exclude: ['light.ok'] },
          party: { include: ['light.egal'], exclude: [] },
        },
      },
    }));
    expect(parsed.rooms.wohnzimmer.gemuetlich).toEqual({ include: ['switch.ok'], exclude: ['light.ok'] });
    expect(Object.keys(parsed.rooms.wohnzimmer)).toEqual(['gemuetlich']);
  });
});

describe('buildSceneCommands', () => {
  const now = 1234;

  it('Gemütlich: dimmbare Lichter → turn_on mit 20 %, Schalter → turn_on', () => {
    const cmds = buildSceneCommands(sceneDef('gemuetlich'), [
      { entityId: 'light.dimmbar', dimmable: true },
      { entityId: 'light.unbekannt' }, // unbekannt → dimmbar angenommen
      { entityId: 'switch.regal' },
    ], now);
    expect(cmds[0].command).toEqual({
      entityId: 'light.dimmbar', domain: 'light', service: 'turn_on',
      data: { brightness_pct: 20 }, queuedAt: now,
    });
    expect(cmds[0].optimistic).toEqual({ on: true, brightness: 20 });
    expect(cmds[1].command.data).toEqual({ brightness_pct: 20 });
    expect(cmds[2].command).toEqual({
      entityId: 'switch.regal', domain: 'switch', service: 'turn_on', data: {}, queuedAt: now,
    });
    expect(cmds[2].optimistic).toEqual({ on: true });
  });

  it('nicht dimmbare Lichter bekommen kein brightness_pct', () => {
    const [cmd] = buildSceneCommands(sceneDef('hell'), [{ entityId: 'light.onoff', dimmable: false }], now);
    expect(cmd.command.service).toBe('turn_on');
    expect(cmd.command.data).toEqual({});
    expect(cmd.optimistic).toEqual({ on: true });
  });

  it('Hell setzt 100 %', () => {
    const [cmd] = buildSceneCommands(sceneDef('hell'), [{ entityId: 'light.dimmbar', dimmable: true }], now);
    expect(cmd.command.data).toEqual({ brightness_pct: 100 });
  });

  it('Aus schaltet Lichter und Schalter aus', () => {
    const cmds = buildSceneCommands(sceneDef('aus'), [
      { entityId: 'light.dimmbar', dimmable: true },
      { entityId: 'switch.regal' },
    ], now);
    expect(cmds.map((c) => c.command.service)).toEqual(['turn_off', 'turn_off']);
    expect(cmds.map((c) => c.optimistic)).toEqual([{ on: false }, { on: false }]);
  });

  it('SCENES trägt die geforderten Defaults', () => {
    expect(SCENES.map((s) => [s.id, s.on, s.brightness])).toEqual([
      ['gemuetlich', true, 20],
      ['hell', true, 100],
      ['aus', false, 0],
    ]);
  });
});

describe('sceneMemberStateFromValue (Import aus einer HA-Szene)', () => {
  it('übernimmt Helligkeit und Farbtemperatur eines eingeschalteten Lichts', () => {
    expect(sceneMemberStateFromValue({ on: true, brightness: 42.4, colorTemp: 2703, color: null }))
      .toEqual({ on: true, brightness: 42, colorTemp: 2703 });
  });

  it('ein ausgeschaltetes Gerät trägt nur den Aus-Zustand', () => {
    expect(sceneMemberStateFromValue({ on: false, brightness: 80 })).toEqual({ on: false });
  });

  it('ohne verwertbaren Zustand bleibt der Szenen-Default stehen', () => {
    expect(sceneMemberStateFromValue(undefined)).toBeNull();
    expect(sceneMemberStateFromValue({ value: 21.5, unit: '°C' })).toBeNull();
  });
});
