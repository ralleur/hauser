import { describe, it, expect } from 'vitest';
import {
  ticksToSeconds,
  secondsToTicks,
  parseFsk,
  hueFromId,
  mapMovie,
  mapSeries,
  mapItem,
  mapItems,
  mapEpisode,
  mapSeasons,
  type BaseItemDto,
} from './jellyfin-map.ts';

describe('Ticks ↔ Sekunden', () => {
  it('ticksToSeconds: 100-ns-Ticks → ganze Sekunden', () => {
    expect(ticksToSeconds(10_000_000)).toBe(1); // 1 s
    expect(ticksToSeconds(48_000_000_000)).toBe(4800); // 80 min
  });
  it('undefined/negativ → 0', () => {
    expect(ticksToSeconds(undefined)).toBe(0);
    expect(ticksToSeconds(-5)).toBe(0);
  });
  it('secondsToTicks ist die Umkehr (auf Sekunden gerundet)', () => {
    expect(secondsToTicks(1)).toBe(10_000_000);
    expect(ticksToSeconds(secondsToTicks(2050))).toBe(2050);
  });
});

describe('parseFsk', () => {
  it('zieht die erste Zahl aus verschiedenen Rating-Formaten', () => {
    expect(parseFsk('FSK 16')).toBe(16);
    expect(parseFsk('de/12')).toBe(12);
    expect(parseFsk('6')).toBe(6);
  });
  it('ohne Ziffer / undefined → 0', () => {
    expect(parseFsk('R')).toBe(0);
    expect(parseFsk(undefined)).toBe(0);
  });
});

describe('hueFromId', () => {
  it('ist deterministisch und im Bereich 0–359', () => {
    const a = hueFromId('abc-123');
    expect(a).toBe(hueFromId('abc-123'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });
  it('verschiedene Ids → (meist) verschiedene Farbtöne', () => {
    expect(hueFromId('signal')).not.toBe(hueFromId('nordwind'));
  });
});

describe('mapMovie', () => {
  const dto: BaseItemDto = {
    Id: 'movie-1',
    Name: 'Gletscherlicht',
    Type: 'Movie',
    ProductionYear: 2025,
    OfficialRating: 'FSK 12',
    Genres: ['Drama'],
    Overview: 'Eine Glaziologin kehrt zurück.',
    RunTimeTicks: 76_800_000_000, // 7680 s
    DateCreated: '2026-07-01T10:00:00Z',
    ImageTags: { Primary: 'tagP', Logo: 'tagL' },
    BackdropImageTags: ['tagB'],
    UserData: { PlaybackPositionTicks: 28_800_000_000, LastPlayedDate: '2026-07-05T20:00:00Z' },
  };

  it('übersetzt Kern-Metadaten + Ticks → Sekunden', () => {
    const m = mapMovie(dto);
    expect(m).toMatchObject({
      id: 'movie-1',
      type: 'movie',
      title: 'Gletscherlicht',
      year: 2025,
      fsk: 12,
      genres: ['Drama'],
      runtime: 7680,
      pos: 2880,
    });
  });

  it('added = DateCreated in ms, cw = LastPlayedDate in ms', () => {
    const m = mapMovie(dto);
    expect(m.added).toBe(Date.parse('2026-07-01T10:00:00Z'));
    expect(m.cw).toBe(Date.parse('2026-07-05T20:00:00Z'));
  });

  it('übernimmt die Artwork-Tags', () => {
    const m = mapMovie(dto);
    expect(m.primaryTag).toBe('tagP');
    expect(m.backdropTag).toBe('tagB');
    expect(m.logoTag).toBe('tagL');
  });

  it('fehlende Felder → sichere Defaults', () => {
    const m = mapMovie({ Id: 'x' });
    expect(m).toMatchObject({ title: '', year: 0, fsk: 0, genres: [], runtime: 0, pos: 0, added: 0, cw: 0 });
    expect(m.primaryTag).toBeUndefined();
  });
});

describe('mapSeries', () => {
  const dto: BaseItemDto = {
    Id: 'series-1',
    Name: 'Halbmond',
    Type: 'Series',
    ProductionYear: 2024,
    OfficialRating: '16',
    Genres: ['Spionage'],
    ChildCount: 2,
  };

  it('ignoriert unzuverlässiges ChildCount bis die echten Staffeln geladen sind', () => {
    const s = mapSeries(dto);
    expect(s.type).toBe('series');
    expect(s.seasons).toEqual([]);
    expect(s.lastPlayed).toBeNull();
  });

  it('mit geladenen Staffeln → diese werden übernommen', () => {
    const seasons = [{ n: 1, episodes: [{ n: 1, title: 'Ankunft', dur: 3060, watched: true, pos: 0 }] }];
    const s = mapSeries(dto, seasons);
    expect(s.seasons).toBe(seasons);
  });
});

describe('mapItem / mapItems', () => {
  it('dispatcht nach Type', () => {
    expect(mapItem({ Id: 'a', Type: 'Series', ChildCount: 1 }).type).toBe('series');
    expect(mapItem({ Id: 'b', Type: 'Movie' }).type).toBe('movie');
  });
  it('unbekannter Type → movie (Fallback)', () => {
    expect(mapItem({ Id: 'c' }).type).toBe('movie');
  });
  it('mapItems mappt die Liste', () => {
    const list = mapItems([{ Id: 'a', Type: 'Movie' }, { Id: 'b', Type: 'Series' }]);
    expect(list.map((i) => i.type)).toEqual(['movie', 'series']);
  });
});

describe('mapEpisode', () => {
  it('IndexNumber/Played/Position übersetzen', () => {
    const e = mapEpisode({
      Id: 'ep-4',
      Name: 'Das Netz',
      IndexNumber: 4,
      RunTimeTicks: 31_200_000_000, // 3120 s
      UserData: { Played: false, PlaybackPositionTicks: 12_500_000_000 }, // 1250 s
    });
    expect(e).toEqual({ n: 4, title: 'Das Netz', dur: 3120, watched: false, pos: 1250, jfId: 'ep-4' });
  });
  it('ohne UserData → nicht gesehen, pos 0', () => {
    expect(mapEpisode({ Id: 'ep-1', Name: 'A', IndexNumber: 1 })).toMatchObject({ watched: false, pos: 0 });
  });
  it('trägt die Jellyfin-Id der Folge fürs Playback (Funktionsumfang 9)', () => {
    expect(mapEpisode({ Id: 'ep-77', Name: 'X', IndexNumber: 2 }).jfId).toBe('ep-77');
  });
});

describe('mapSeasons', () => {
  it('sortiert Staffeln + Folgen und ordnet Episoden per SeasonId zu', () => {
    const seasonDtos: BaseItemDto[] = [
      { Id: 's2', Type: 'Season', IndexNumber: 2 },
      { Id: 's1', Type: 'Season', IndexNumber: 1 },
    ];
    const episodesBySeasonId = {
      s1: [
        { Id: 'e2', IndexNumber: 2, Name: 'Zwei' },
        { Id: 'e1', IndexNumber: 1, Name: 'Eins' },
      ],
      s2: [{ Id: 'e3', IndexNumber: 1, Name: 'Drei' }],
    };
    const seasons = mapSeasons(seasonDtos, episodesBySeasonId);
    expect(seasons.map((s) => s.n)).toEqual([1, 2]);
    expect(seasons[0].episodes.map((e) => e.n)).toEqual([1, 2]);
    expect(seasons[1].episodes[0].title).toBe('Drei');
  });
  it('Staffel ohne Episoden-Eintrag → leere Folgenliste', () => {
    const seasons = mapSeasons([{ Id: 's1', IndexNumber: 1 }], {});
    expect(seasons[0].episodes).toEqual([]);
  });

  it('vereinigt doppelte Staffeln und Folgen aus mehreren Jellyfin-Libraries', () => {
    const seasons = mapSeasons(
      [
        { Id: 'disk-a-season-1', Type: 'Season', IndexNumber: 1 },
        { Id: 'disk-b-season-1', Type: 'Season', IndexNumber: 1 },
      ],
      {
        'disk-a-season-1': [
          { Id: 'disk-a-e1', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1, Name: 'Pilot', ProviderIds: { Tvdb: '101' } },
          { Id: 'disk-a-e2', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 2, Name: 'Zweite Folge' },
        ],
        'disk-b-season-1': [
          { Id: 'disk-b-e1', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1, Name: 'Pilot', ProviderIds: { tvdb: '101' } },
          { Id: 'disk-b-e2', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 2, Name: 'Episode 2' },
          { Id: 'disk-b-e3', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 3, Name: 'Dritte Folge' },
        ],
      },
    );
    expect(seasons).toHaveLength(1);
    expect(seasons[0].episodes.map((episode) => episode.n)).toEqual([1, 2, 3]);
  });

  it('dedupliziert denselben Episodenslot auch bei widersprüchlichen Provider-Ids', () => {
    const seasons = mapSeasons(
      [{ Id: 'season-1', Type: 'Season', IndexNumber: 1 }],
      {
        'season-1': [
          { Id: 'version-a', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 4, ProviderIds: { Tvdb: 'correct' } },
          { Id: 'version-b', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 4, ProviderIds: { Tvdb: 'wrong' } },
        ],
      },
    );
    expect(seasons[0].episodes).toHaveLength(1);
    expect(seasons[0].episodes[0].n).toBe(4);
  });

  it('ordnet einen global vermischten Jellyfin-Feed über ParentIndexNumber den richtigen Staffeln zu', () => {
    const mixed = [
      { Id: 's1e1-a', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1 },
      { Id: 's1e1-b', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1 },
      { Id: 's2e1-a', Type: 'Episode', ParentIndexNumber: 2, IndexNumber: 1 },
      { Id: 's2e1-b', Type: 'Episode', ParentIndexNumber: 2, IndexNumber: 1 },
    ];
    const seasons = mapSeasons(
      [{ Id: 'season-1', IndexNumber: 1 }, { Id: 'season-2', IndexNumber: 2 }],
      { 'season-1': mixed, 'season-2': mixed },
    );
    expect(seasons.map((season) => [season.n, season.episodes.map((episode) => episode.n)])).toEqual([
      [1, [1]], [2, [1]],
    ]);
  });

  it('bevorzugt beim Deduplizieren die Episodenversion mit Wiedergabefortschritt', () => {
    const seasons = mapSeasons(
      [{ Id: 'season-1', IndexNumber: 1 }],
      {
        'season-1': [
          { Id: 'idle', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1, UserData: { PlaybackPositionTicks: 0 } },
          { Id: 'resumed', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1, UserData: { PlaybackPositionTicks: 120_000_000 } },
        ],
      },
    );
    expect(seasons[0].episodes[0].jfId).toBe('resumed');
    expect(seasons[0].episodes[0].pos).toBe(12);
  });

  it('behält Folgen ohne Episodennummer und Provider-Id getrennt', () => {
    const seasons = mapSeasons(
      [{ Id: 's1', Type: 'Season', IndexNumber: 0 }],
      { s1: [{ Id: 'special-a', Name: 'Bonus A' }, { Id: 'special-b', Name: 'Bonus B' }] },
    );
    expect(seasons[0].episodes).toHaveLength(2);
  });
});
