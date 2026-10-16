import { m } from '../../paraglide/messages.js';
import { pluralCategory } from './locale.svelte.ts';

/* Plurale je Sprache: Deutsch hat zwei Formen, Polnisch vier. */
const WINDOWS_OPEN = {
  one: m.status_window_open_one, two: m.status_window_open_two,
  few: m.status_window_open_few, many: m.status_window_open_many,
  other: m.status_window_open_other,
};
const DOORS_OPEN = {
  one: m.status_door_open_one, two: m.status_door_open_two,
  few: m.status_door_open_few, many: m.status_door_open_many,
  other: m.status_door_open_other,
};

/** Was offen steht, z. B. „2 Fenster offen", „1 Tür offen" oder beides
    nebeneinander („1 Fenster offen, 1 Tür offen"). Leer, wenn nichts offen ist. */
export function openingsLabel(windows: number, doors: number): string {
  return [
    windows > 0 ? WINDOWS_OPEN[pluralCategory(windows)]({ count: windows }) : '',
    doors > 0 ? DOORS_OPEN[pluralCategory(doors)]({ count: doors }) : '',
  ].filter(Boolean).join(', ');
}
