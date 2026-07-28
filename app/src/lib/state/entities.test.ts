/* ============================================
   Subscription-Mengen (ADR-006) — sichert zu, dass das `subscribe_entities`-Abo
   AUSSCHLIESSLICH die gemappten entity_ids enthält. Motiviert von der Live-
   Beobachtung (Funktionsumfang 10): zwei Power-Sensoren tauchten während eines
   Licht-/Klima-Tests im Store auf, obwohl der Screen sie nicht zeigte. Erklärung
   und hier festgenagelt: die Energie-`load`-Sensoren sind Teil des Ambient-Sets
   (sun + Energie), das auf JEDEM Screen abonniert wird — also korrekt angefordert,
   kein Filter-Leck.
   ============================================ */

import { describe, expect, it } from 'vitest';
import { ambientEntityIds, visibleEntityIds, allEntityIds, LAUNDRY_ENTITIES, lightEntityId } from './entities.ts';
import { SUN_ENTITY, ENERGY_SENSORS, energyRefIds } from './app.svelte.ts';

/* ENERGY_SENSORS-Refs → flache Liste konfigurierter entity_ids (null ausgelassen);
   deckt Einzel-ID, ID-Liste und Lastquellen-Objekte ab (B-19). */
const configuredEnergyIds = Object.values(ENERGY_SENSORS).flatMap(energyRefIds);

/* Domänen, die haToValue (ADR-018 §4) überhaupt in den Store lässt. */
const MAPPED_PREFIXES = ['light.', 'climate.', 'media_player.', 'sensor.', 'switch.', 'input_boolean.', 'camera.'];
function isMapped(id: string): boolean {
  return id === SUN_ENTITY || MAPPED_PREFIXES.some((p) => id.startsWith(p));
}

const SCREENS = ['home', 'energy', 'media', 'library', 'library-detail', 'system'];

describe('ambient subscription set (ADR-006)', () => {
  it('enthält sun.sun und jeden konfigurierten Energie-Sensor', () => {
    const ambient = ambientEntityIds();
    expect(ambient).toContain(SUN_ENTITY);
    for (const id of configuredEnergyIds) expect(ambient).toContain(id);
  });

  it('enthält die zwei live beobachteten Power-Sensoren (FU10-Regression)', () => {
    // Genau diese tauchten während des Licht-/Klima-Tests auf — sie sind Teil
    // der Energie-`load`-Liste und damit legitim im Dauer-Abo.
    const ambient = ambientEntityIds();
    expect(ambient).toContain('sensor.strom_schreibtisch_links_power');
    expect(ambient).toContain('sensor.strom_zigbee_steckdose_power');
  });

  it('enthält nichts außer sun + Energie + globale Laundry-Zustände (keine null, keine Duplikate)', () => {
    const ambient = ambientEntityIds();
    const expected = new Set([SUN_ENTITY, ...configuredEnergyIds, ...Object.values(LAUNDRY_ENTITIES)]);
    for (const id of ambient) expect(expected.has(id)).toBe(true);
    expect(ambient).not.toContain(null);
    expect(new Set(ambient).size).toBe(ambient.length);
  });
});

describe('per-screen subscription set (ADR-006)', () => {
  it('weist unbekannte Lichtziele fail-closed ab', () => {
    expect(() => lightEntityId('unknown-room', 'unknown-light')).toThrow(/Unknown configured light target/);
  });

  it('trägt das Ambient-Set auf JEDEM Screen mit — nur so erklärt sich die Beobachtung', () => {
    const ambient = ambientEntityIds();
    for (const screen of SCREENS) {
      const visible = visibleEntityIds(screen);
      for (const id of ambient) expect(visible).toContain(id);
    }
  });

  it('abonniert ausschließlich gemappte entity_ids (kein Leck ungemappter Domänen)', () => {
    for (const screen of [...SCREENS, 'irgendein-unbekannter-screen']) {
      for (const id of visibleEntityIds(screen)) {
        expect(isMapped(id), `${id} (${screen}) ist keine gemappte Domäne`).toBe(true);
      }
    }
  });

  it('Nicht-Home/Media-Screens abonnieren genau das Ambient-Set', () => {
    // energy/library/system zeigen keine steuerbaren Geräte → nur sun + Energie.
    const ambient = [...ambientEntityIds()].sort();
    for (const screen of ['energy', 'library', 'library-detail', 'system']) {
      expect([...visibleEntityIds(screen)].sort()).toEqual(ambient);
    }
  });

  it('allEntityIds ist eine Obermenge jedes Screen-Sets', () => {
    const all = new Set(allEntityIds());
    for (const screen of SCREENS) {
      for (const id of visibleEntityIds(screen)) expect(all.has(id)).toBe(true);
    }
  });
});
