import type { LiveShelf } from '../adapter/jellyfin-shelves.ts';
import type { LibraryItem } from './app.svelte.ts';

import { m } from '../../paraglide/messages.js';
export type LibraryCategory = 'continue' | 'latest' | 'series' | 'movies';

export function categoryFromLabel(label: string): LibraryCategory {
  if (label.startsWith(m.library_continue())) return 'continue';
  if (label.startsWith(m.library_recent())) return 'latest';
  if (label.startsWith('Serien')) return 'series';
  return 'movies';
}

export function categoryItems(
  category: LibraryCategory,
  shelves: readonly LiveShelf[],
  allItems: readonly LibraryItem[],
): LibraryItem[] {
  if (category === 'continue') {
    return [...(shelves.find((shelf) => categoryFromLabel(shelf.label) === category)?.list ?? [])];
  }
  if (category === 'latest') return [...allItems].sort((a, b) => b.added - a.added);
  return allItems.filter((item) => item.type === (category === 'series' ? 'series' : 'movie'));
}

export function searchLibrary(items: readonly LibraryItem[], rawQuery: string): LibraryItem[] {
  const query = normalize(rawQuery.trim());
  if (!query) return [];
  return items.filter((item) => normalize([
    item.title,
    item.year,
    ...item.genres,
  ].join(' ')).includes(query));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
