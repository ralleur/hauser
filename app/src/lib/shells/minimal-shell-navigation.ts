export type MinimalShellViewId = 'home' | 'rooms' | 'system';

export interface MinimalShellView {
  id: MinimalShellViewId;
  label: string;
  title: string;
  summary: string;
  details: string;
}

export const MINIMAL_SHELL_VIEWS: readonly MinimalShellView[] = [
  {
    id: 'home',
    label: 'Zuhause',
    title: 'Lokales Dashboard',
    summary: 'Lokale Übersicht ohne Live-Daten.',
    details: 'Raumstatus fehlt · Aktionen gesperrt',
  },
  {
    id: 'rooms',
    label: 'Räume',
    title: 'Lokale Raumübersicht',
    summary: 'Neutrale Liste ohne geladene Haushaltsdaten.',
    details: 'Wohnbereich · Schlafbereich · Außenbereich',
  },
  {
    id: 'system',
    label: 'System',
    title: 'Verbindung wird geprüft',
    summary: 'Offline oder unbekannt. Lokal weiter bedienbar.',
    details: 'Keine Geräteaktion · Freigabe wird geprüft',
  },
];
