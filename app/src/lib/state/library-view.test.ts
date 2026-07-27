import { describe, expect, it } from 'vitest';
import type { LibraryItem } from './app.svelte.ts';
import type { LiveShelf } from '../adapter/jellyfin-shelves.ts';
import {
  categoryFromLabel,
  categoryItems,
  searchLibrary,
  type LibraryCategory,
} from './library-view.ts';

const item = (id: string, type: 'movie' | 'series', title: string, added: number): LibraryItem => ({
  id, type, title, added, year: 2026, fsk: 0, genres: [], hue: 0, cw: 0, overview: '',
  ...(type === 'series' ? { seasons: [], lastPlayed: null } : { runtime: 100, pos: 0 }),
});

const oldMovie = item('m-old', 'movie', 'Älterer Film', 10);
const newMovie = item('m-new', 'movie', 'Neuer Film', 30);
const series = item('s-new', 'series', 'Die Serie', 20);
const shelves: LiveShelf[] = [
  { label: 'Weiterschauen', list: [oldMovie] },
  { label: 'Zuletzt hinzugefügt', list: [newMovie] },
  { label: 'Serien · 1', list: [series] },
  { label: 'Filme · 2', list: [oldMovie, newMovie] },
];
const all = [oldMovie, newMovie, series];

describe('library view projection', () => {
  it.each<[string, LibraryCategory]>([
    ['Weiterschauen', 'continue'],
    ['Zuletzt hinzugefügt', 'latest'],
    ['Serien · 12', 'series'],
    ['Filme · 42', 'movies'],
  ])('ordnet %s einer stabilen Kategorie zu', (label, expected) => {
    expect(categoryFromLabel(label)).toBe(expected);
  });

  it('zeigt in Zuletzt hinzugefügt den vollständigen Bestand statt nur das Shelf-Limit', () => {
    expect(categoryItems('latest', shelves, all).map((entry) => entry.id)).toEqual([
      'm-new', 's-new', 'm-old',
    ]);
  });

  it('nutzt für Weiterschauen die Resume-Reihenfolge und für Typen den Gesamtbestand', () => {
    expect(categoryItems('continue', shelves, all)).toEqual([oldMovie]);
    expect(categoryItems('movies', shelves, all).map((entry) => entry.id)).toEqual(['m-old', 'm-new']);
    expect(categoryItems('series', shelves, all)).toEqual([series]);
  });

  it('sucht case- und diakritikunabhängig in Titel, Genre und Jahr', () => {
    const genreItem = { ...series, genres: ['Krimi'] };
    expect(searchLibrary([oldMovie, newMovie, genreItem], 'alterer')).toEqual([oldMovie]);
    expect(searchLibrary([genreItem], 'krimi')).toEqual([genreItem]);
    expect(searchLibrary([newMovie], '2026')).toEqual([newMovie]);
  });

  it('liefert bei leerer Suche noch keine Ergebniswand', () => {
    expect(searchLibrary(all, '   ')).toEqual([]);
  });
});
