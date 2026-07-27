import { describe, it, expect } from 'vitest';
import { buildLiveLibrary } from './jellyfin-shelves.ts';
import type { BaseItemDto } from './jellyfin-map.ts';

const movie = (id: string, extra: Partial<BaseItemDto> = {}): BaseItemDto => ({
  Id: id, Type: 'Movie', Name: id, RunTimeTicks: 60_000_000_000, ...extra,
});
const series = (id: string, extra: Partial<BaseItemDto> = {}): BaseItemDto => ({
  Id: id, Type: 'Series', Name: id, ChildCount: 2, ...extra,
});

describe('buildLiveLibrary — Shelves', () => {
  it('baut die vier Shelves in Endpunkt-Reihenfolge mit Zählern', () => {
    const lib = buildLiveLibrary({
      resume: [],
      latest: [movie('m1'), series('s1')],
      movies: [movie('m1'), movie('m2')],
      series: [series('s1')],
    });
    expect(lib.shelves.map((s) => s.label)).toEqual([
      'Weiterschauen', 'Zuletzt hinzugefügt', 'Serien · 1', 'Filme · 2',
    ]);
    expect(lib.shelves[1].list.map((i) => i.id)).toEqual(['m1', 's1']); // Latest-Order bleibt
  });

  it('dedupliziert Duplikate INNERHALB eines Shelfs (Jellyfin liefert Items über DiskA/DiskB doppelt)', () => {
    // Gleiche Id doppelt in movies/latest → darf im Shelf nur einmal erscheinen
    // (sonst sprengt es das keyed `{#each … (item.id)}` → each_key_duplicate).
    const dup = movie('dup');
    const lib = buildLiveLibrary({
      resume: [], latest: [dup, dup], movies: [dup, dup, movie('m2')], series: [],
    });
    const latestShelf = lib.shelves[1].list;
    const movieShelf = lib.shelves[3].list;
    expect(latestShelf.filter((i) => i.id === 'dup')).toHaveLength(1);
    expect(movieShelf.filter((i) => i.id === 'dup')).toHaveLength(1);
    expect(movieShelf.map((i) => i.id)).toEqual(['dup', 'm2']);
  });

  it('dedupliziert dasselbe Medium mit verschiedenen Jellyfin-Ids über Provider-Id', () => {
    const diskA = movie('jf-disk-a', { Name: 'Dune', ProductionYear: 2021, ProviderIds: { Tmdb: '438631' } });
    const diskB = movie('jf-disk-b', { Name: 'Dune: Part One', ProductionYear: 2021, ProviderIds: { tmdb: '438631' } });
    const lib = buildLiveLibrary({
      resume: [], latest: [diskA, diskB], movies: [diskA, diskB], series: [],
    });
    expect(lib.shelves[1].list).toHaveLength(1);
    expect(lib.shelves[3].list).toHaveLength(1);
    expect(lib.items).toHaveLength(1);
  });

  it('dedupliziert verschiedene Jellyfin-Ids per normalisiertem Titel und Jahr ohne Provider-Ids', () => {
    const lib = buildLiveLibrary({
      resume: [], latest: [],
      movies: [
        movie('jf-disk-a', { Name: 'Léon – Der Profi', ProductionYear: 1994 }),
        movie('jf-disk-b', { Name: 'Leon: Der Profi', ProductionYear: 1994 }),
      ],
      series: [],
    });
    expect(lib.shelves[3].list).toHaveLength(1);
    expect(lib.shelves[3].label).toBe('Filme · 1');
  });

  it('behält gleichnamige Medien aus verschiedenen Jahren getrennt', () => {
    const lib = buildLiveLibrary({
      resume: [], latest: [],
      movies: [
        movie('old', { Name: 'Dune', ProductionYear: 1984 }),
        movie('new', { Name: 'Dune', ProductionYear: 2021 }),
      ],
      series: [],
    });
    expect(lib.shelves[3].list).toHaveLength(2);
  });

  it('legt Resume eines Library-Duplikats auf das kanonische sichtbare Item', () => {
    const diskA = movie('jf-disk-a', { Name: 'Dune', ProductionYear: 2021, ProviderIds: { Tmdb: '438631' } });
    const diskBResume = movie('jf-disk-b', {
      Name: 'Dune', ProductionYear: 2021, ProviderIds: { Tmdb: '438631' },
      UserData: { PlaybackPositionTicks: 12_000_000_000 },
    });
    const lib = buildLiveLibrary({
      resume: [diskBResume], latest: [], movies: [diskA, diskBResume], series: [],
    });
    expect(lib.shelves[0].list).toHaveLength(1);
    expect(lib.shelves[0].list[0].id).toBe('jf-disk-a');
    expect(lib.shelves[0].list[0].pos).toBe(1200);
  });

  it('dedupliziert Weiterschauen, wenn zwei Resume-Folgen auf dieselbe Serie zeigen', () => {
    const ep = (n: number): BaseItemDto => ({
      Id: `ep-${n}`, Type: 'Episode', SeriesId: 's1', SeriesName: 'S', ParentIndexNumber: 1, IndexNumber: n,
      RunTimeTicks: 30_000_000_000, UserData: { PlaybackPositionTicks: 10_000_000_000 },
    });
    const lib = buildLiveLibrary({ resume: [ep(1), ep(2)], latest: [], movies: [], series: [series('s1')] });
    expect(lib.shelves[0].list.filter((i) => i.id === 's1')).toHaveLength(1);
  });

  it('dedupliziert über Shelves hinweg — ein Item pro Id im Index', () => {
    const lib = buildLiveLibrary({
      resume: [],
      latest: [movie('m1')],
      movies: [movie('m1'), movie('m2')],
      series: [],
    });
    expect(lib.items.filter((i) => i.id === 'm1')).toHaveLength(1);
    // Latest referenziert dasselbe Objekt wie Filme
    expect(lib.shelves[1].list[0]).toBe(lib.shelves[3].list[0]);
  });
});

describe('buildLiveLibrary — Resume-Overlay Film', () => {
  it('setzt pos aus PlaybackPositionTicks und nimmt den Film in Weiterschauen auf', () => {
    const lib = buildLiveLibrary({
      resume: [movie('m1', { UserData: { PlaybackPositionTicks: 12_000_000_000, LastPlayedDate: '2026-07-05T20:00:00Z' } })],
      latest: [],
      movies: [movie('m1'), movie('m2')],
      series: [],
    });
    const cont = lib.shelves[0].list;
    expect(cont.map((i) => i.id)).toEqual(['m1']);
    expect(cont[0].pos).toBe(1200);
    expect(cont[0].cw).toBe(Date.parse('2026-07-05T20:00:00Z'));
    // Overlay wirkt auf dasselbe Item im Filme-Shelf
    expect(lib.shelves[3].list.find((i) => i.id === 'm1')!.pos).toBe(1200);
  });

  it('Film ohne Fortschritt (pos 0) fällt aus Weiterschauen', () => {
    const lib = buildLiveLibrary({
      resume: [movie('m1', { UserData: { PlaybackPositionTicks: 0 } })],
      latest: [], movies: [movie('m1')], series: [],
    });
    expect(lib.shelves[0].list).toHaveLength(0);
  });
});

describe('buildLiveLibrary — Resume-Overlay Episode', () => {
  const episode: BaseItemDto = {
    Id: 'ep-42', Type: 'Episode', Name: 'Das Netz',
    SeriesId: 's1', SeriesName: 'Halbmond', SeriesPrimaryImageTag: 'poster-s1',
    ParentIndexNumber: 2, IndexNumber: 4,
    RunTimeTicks: 31_200_000_000, // 3120 s
    UserData: { PlaybackPositionTicks: 12_500_000_000, LastPlayedDate: '2026-07-06T21:00:00Z' }, // 1250 s
  };

  it('projiziert die Episode auf die Serie: lastPlayed + eingebettete Folge + Poster-Tag', () => {
    const lib = buildLiveLibrary({ resume: [episode], latest: [], movies: [], series: [series('s1')] });
    const cont = lib.shelves[0].list;
    expect(cont).toHaveLength(1);
    const s = cont[0];
    expect(s.id).toBe('s1');
    expect(s.type).toBe('series');
    expect(s.lastPlayed).toEqual({ season: 2, ep: 4 });
    expect(s.primaryTag).toBe('poster-s1');
    const ep = s.seasons!.find((x) => x.n === 2)!.episodes.find((e) => e.n === 4)!;
    expect(ep).toMatchObject({ n: 4, title: 'Das Netz', dur: 3120, pos: 1250 });
  });

  it('legt die Serie an, wenn sie in keinem anderen Shelf war', () => {
    const lib = buildLiveLibrary({ resume: [episode], latest: [], movies: [], series: [] });
    expect(lib.items.map((i) => i.id)).toContain('s1');
    expect(lib.items.find((i) => i.id === 's1')!.title).toBe('Halbmond');
  });

  it('Episode ohne SeriesId wird ignoriert (kein Crash)', () => {
    const lib = buildLiveLibrary({
      resume: [{ Id: 'ep-x', Type: 'Episode', IndexNumber: 1 }],
      latest: [], movies: [], series: [],
    });
    expect(lib.shelves[0].list).toHaveLength(0);
  });
});
