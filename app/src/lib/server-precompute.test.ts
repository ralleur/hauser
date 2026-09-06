import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
import { msUntilNightly, previousWeekRange, runPrecompute } from '../../server/precompute.mjs';
// @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
import { energySensorIds, summarizeHistory } from '../../server/energy-week.mjs';
// @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
import { checkRoomImageAssets } from '../../server/self-check.mjs';
// @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
import { createRuntimeConfig } from '../../server/runtime-config.mjs';

/* Paket 11: Der Server denkt voraus — nächtlicher Lauf, Selbstprüfung und die
   Modul-Injektion aus ADR-030. */

describe('Nächtlicher Lauf', () => {
  it('zielt auf 03:30 der kommenden Nacht', () => {
    const evening = new Date(2026, 8, 4, 22, 0, 0);
    expect(msUntilNightly(evening)).toBe((5 * 60 + 30) * 60 * 1000);
    const morning = new Date(2026, 8, 4, 4, 0, 0);
    expect(msUntilNightly(morning)).toBe((23 * 60 + 30) * 60 * 1000);
  });

  it('nimmt die Vorwoche von Montag bis Montag', () => {
    const range = previousWeekRange(new Date(2026, 8, 4, 12, 0, 0)); // Freitag
    expect(new Date(range.start).getDay()).toBe(1);
    expect(range.end - range.start).toBe(7 * 24 * 60 * 60 * 1000);
    expect(range.end).toBeLessThanOrEqual(new Date(2026, 8, 4).getTime());
  });

  it('lässt eine fehlgeschlagene Aufgabe die anderen nicht mitreißen', async () => {
    const second = vi.fn().mockResolvedValue({ status: 'written' });
    const result = await runPrecompute([
      { name: 'kaputt', run: () => Promise.reject(new Error('kein Zugang')) },
      { name: 'gut', run: second },
    ]);
    expect(second).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.tasks[0]).toMatchObject({ name: 'kaputt', ok: false, detail: 'kein Zugang' });
    expect(result.tasks[1]).toMatchObject({ name: 'gut', ok: true });
  });
});

describe('Energiestatistik der Vorwoche', () => {
  it('sammelt die Sensor-Ids aus der Haushaltskonfiguration', () => {
    const ids = energySensorIds({
      energy: {
        sensors: { productionPower: ['sensor.pv'], consumptionPower: ['sensor.haus'] },
        kpis: { producedToday: 'sensor.pv_heute', consumedToday: null },
      },
    });
    expect(ids).toEqual(['sensor.pv', 'sensor.haus', 'sensor.pv_heute']);
  });

  it('behält je Tag und Sensor den letzten Wert', () => {
    const range = { start: Date.parse('2026-08-24T00:00:00Z'), end: Date.parse('2026-08-31T00:00:00Z') };
    const entries = summarizeHistory([[
      { entity_id: 'sensor.pv', state: '10', last_changed: '2026-08-24T08:00:00Z' },
      { entity_id: 'sensor.pv', state: '14', last_changed: '2026-08-24T20:00:00Z' },
      { entity_id: 'sensor.pv', state: '99', last_changed: '2026-09-02T20:00:00Z' },
      { entity_id: 'sensor.pv', state: 'unavailable', last_changed: '2026-08-25T20:00:00Z' },
    ]], range);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityId: 'sensor.pv', value: 14 });
  });
});

describe('Selbstprüfung', () => {
  it('meldet fehlende Dateien, ohne zu werfen', () => {
    const result = checkRoomImageAssets({
      catalogPath: '/tmp/katalog.json',
      assetRoot: '/tmp/assets',
      readFile: () => JSON.stringify({ assets: [{ assetId: 'abc' }] }),
      exists: (path: string) => !String(path).endsWith('light.avif'),
    });
    expect(result.ok).toBe(false);
    expect(result.checkedSets).toBe(1);
    expect(result.missing.some((entry: string) => entry.startsWith('abc/'))).toBe(true);
  });

  it('bleibt still, wenn es keinen Katalog gibt', () => {
    const result = checkRoomImageAssets({ catalogPath: null, assetRoot: '/tmp/assets' });
    expect(result).toMatchObject({ ok: true, checkedSets: 0, note: 'no-catalog' });
  });
});

describe('Modul-Injektion (ADR-030)', () => {
  it('liefert die Umgebungswerte als Vorgabe und lässt sie überschreiben', () => {
    const base = createRuntimeConfig();
    expect(typeof base.ambientBodyMax).toBe('number');
    expect(typeof base.ambientModel).toBe('string');
    const custom = createRuntimeConfig({ ambientBodyMax: 42, ambientModel: 'test-modell' });
    expect(custom.ambientBodyMax).toBe(42);
    expect(custom.ambientModel).toBe('test-modell');
    expect(custom.ambientMapHaTimeoutMs).toBe(base.ambientMapHaTimeoutMs);
  });
});
