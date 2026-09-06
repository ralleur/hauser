import { m } from '../../paraglide/messages.js';

export type MinimalShellViewId = 'home' | 'rooms' | 'system';

export interface MinimalShellView {
  id: MinimalShellViewId;
  readonly label: string;
  readonly title: string;
  readonly summary: string;
  readonly details: string;
}

/* Getter statt fester Zeichenketten: die Liste entsteht beim Import, die
   Sprache steht erst beim Rendern fest. */
export const MINIMAL_SHELL_VIEWS: readonly MinimalShellView[] = [
  {
    id: 'home',
    get label() { return m.minimal_tab_home(); },
    get title() { return m.minimal_home_title(); },
    get summary() { return m.minimal_home_summary(); },
    get details() { return m.minimal_home_details(); },
  },
  {
    id: 'rooms',
    get label() { return m.minimal_tab_rooms(); },
    get title() { return m.minimal_rooms_title(); },
    get summary() { return m.minimal_rooms_summary(); },
    get details() { return m.minimal_rooms_details(); },
  },
  {
    id: 'system',
    get label() { return m.minimal_tab_system(); },
    get title() { return m.minimal_system_title(); },
    get summary() { return m.minimal_system_summary(); },
    get details() { return m.minimal_system_details(); },
  },
];
