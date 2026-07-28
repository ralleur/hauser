import { describe, expect, expectTypeOf, it } from 'vitest';
// @ts-expect-error Nativer Node-Test ohne @types/node.
import { readFileSync } from 'node:fs';
import neutralSmall from '../../../config/examples/neutral-small.json';
import neutralStudio from '../../../config/examples/neutral-studio.json';
import {
  compileHouseholdConfig,
  parseHouseholdConfig,
  type HouseholdRuntimeModel,
} from '../config/household-config.ts';
import { legacyHouseholdRuntimeModel } from '../config/legacy-household-config.ts';
import {
  HOME_POD_TARGETS,
  homePodAudioUrl,
  homePodEntityIds,
  type HomePodTarget,
} from './songs.ts';

function compileValid(input: unknown): HouseholdRuntimeModel {
  const parsed = parseHouseholdConfig(input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return compileHouseholdConfig(parsed.value);
}

describe('Songausgabe auf HomePods', () => {
  it('bewahrt Schlüsselmenge, Reihenfolge und öffentliche Zielunion', () => {
    expect(Object.keys(HOME_POD_TARGETS)).toEqual(['wohnzimmer', 'kueche']);
    expectTypeOf<HomePodTarget>().toEqualTypeOf<'wohnzimmer' | 'kueche' | 'both'>();
  });

  it('liefert eine für Home Assistant und HomePods erreichbare LAN-URL', () => {
    expect(homePodAudioUrl('/api/songs/audio?path=%2Ftmp%2Fsong.mp3')).toBe(
      'http://localhost:4173/api/songs/audio?path=%2Ftmp%2Fsong.mp3',
    );
    expect(homePodAudioUrl('https://evil.invalid/song.mp3')).toBeNull();
    expect(homePodAudioUrl('/api/songs/library/550e8400-e29b-41d4-a716-446655440000/audio')).toBe(
      'http://localhost:4173/api/songs/library/550e8400-e29b-41d4-a716-446655440000/audio',
    );
  });

  it('leitet alle Songziele aus der produktiven Media-Quelle ab und hält Fixtures disjunkt', () => {
    const source = readFileSync(new URL('./songs.ts', import.meta.url), 'utf8');
    expect(source).toContain("from '../config/household-runtime-data.ts'");
    expect(source).not.toMatch(/media_player\.[a-z0-9_]+/);

    expect(homePodEntityIds('wohnzimmer')).toEqual([HOME_POD_TARGETS.wohnzimmer.entityId]);
    expect(homePodEntityIds('kueche')).toEqual([HOME_POD_TARGETS.kueche.entityId]);

    const songTargets = homePodEntityIds('both');
    expect(songTargets).toEqual(Object.values(HOME_POD_TARGETS).map(({ entityId }) => entityId));
    for (const entityId of songTargets) {
      const command = legacyHouseholdRuntimeModel.commandContracts.find((contract) => (
        contract.domain === 'media_player' && contract.entityId === entityId
      ));
      expect(command?.services).toEqual(expect.arrayContaining(['play_media', 'media_stop']));
    }

    const neutralIds = new Set([neutralSmall, neutralStudio].flatMap((fixture) => (
      compileValid(fixture).subscriptionEntityIds
    )));
    expect(songTargets.filter((entityId) => neutralIds.has(entityId))).toEqual([]);
  });
});
