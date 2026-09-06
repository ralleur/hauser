/* ── Fake-Bibliothek (docs/07 Screens 6–8, docs/08) ──
   Poster-Platzhalter statt Artwork — pro Item ein Farbton (--ph); echte Poster
   kommen über /Items/{id}/Images/Primary?maxWidth&tag. pos/ep.pos in Sekunden
   = Resume-Punkt (Jellyfin: PositionTicks).

   Eigenes Modul, weil dieser Bestand nur im Fake-Modus und nur in der
   Bibliothek gebraucht wird — im Startpfad hätte er nichts verloren
   (ADR-029). Eingespielt wird er von state/library.svelte.ts. */

import { appState, type LibraryItem, type Season } from './app.svelte.ts';

/* Generische Staffel für die Fake-Bibliothek (nur nicht-Feature-Serien —
   „Halbmond" hat handgeschriebene Folgentitel). watchedThrough = Folgen 1…n
   gelten als gesehen. */
function makeSeason(n: number, count: number, dur: number, watchedThrough = 0): Season {
  return {
    n,
    episodes: Array.from({ length: count }, (_, i) => ({
      n: i + 1, title: `Folge ${i + 1}`, dur, watched: i < watchedThrough, pos: 0,
    })),
  };
}

export const LIBRARY_SEED_ITEMS: LibraryItem[] = [
  {
    id: 'signal', type: 'movie', title: 'Signal aus der Tiefe', year: 2025, fsk: 12,
    genres: ['Science-Fiction'], hue: 258, runtime: 8280, added: 1, pos: 0, cw: 0,
    overview: 'Eine Forschungsstation im Nordatlantik empfängt ein Muster, das es nicht geben dürfte. Die Ozeanografin Marla Jansen muss entscheiden, wem sie die Entdeckung meldet — und wem besser nicht.',
  },
  {
    id: 'gletscherlicht', type: 'movie', title: 'Gletscherlicht', year: 2025, fsk: 12,
    genres: ['Drama'], hue: 205, runtime: 7680, added: 2, pos: 2880, cw: 3,
    overview: 'Nach dem Tod ihres Vaters kehrt die Glaziologin Ada Brenner ins Hochtal ihrer Kindheit zurück. Zwischen schmelzendem Eis und alten Rechnungen findet sie ein Tagebuch, das die Geschichte des Dorfes neu schreibt.',
  },
  {
    id: 'letzte-schicht', type: 'movie', title: 'Die letzte Schicht', year: 2024, fsk: 16,
    genres: ['Thriller'], hue: 12, runtime: 6240, added: 9, pos: 0, cw: 0,
    overview: 'Im stillgelegten Bergwerk Konrad II soll eine letzte Nachtschicht die Pumpen abstellen. Als der Aufzug ausfällt, merkt Steiger Wollny, dass jemand von der Belegschaft nicht auf der Liste steht.',
  },
  {
    id: 'nordwind', type: 'movie', title: 'Nordwind', year: 2023, fsk: 6,
    genres: ['Abenteuer'], hue: 150, runtime: 5760, added: 8, pos: 0, cw: 0,
    overview: 'Die zwölfjährige Juno segelt mit ihrem Großvater das alte Postboot die Küste hinauf — gegen den Wind, gegen die Zeit und gegen den Plan ihrer Eltern, das Boot zu verkaufen.',
  },
  {
    id: 'kastanienjahre', type: 'movie', title: 'Kastanienjahre', year: 2022, fsk: 12,
    genres: ['Drama'], hue: 35, runtime: 6720, added: 11, pos: 0, cw: 0,
    overview: 'Drei Geschwister erben das Gasthaus ihrer Mutter — und mit ihm die Frage, warum der Vater 1989 nicht zurückkam. Ein Sommer zwischen Renovierung und Wahrheit.',
  },
  {
    id: 'paralleltal', type: 'movie', title: 'Paralleltal', year: 2024, fsk: 16,
    genres: ['Mystery'], hue: 290, runtime: 7260, added: 7, pos: 1080, cw: 1,
    overview: 'Ein Vermessungsingenieur findet in den Karten zweier Jahrzehnte dasselbe Seitental — nur liegt es jedes Mal woanders. Je genauer er misst, desto weniger stimmt die Landschaft.',
  },
  {
    id: 'acht-stunden', type: 'movie', title: 'Acht Stunden', year: 2021, fsk: 16,
    genres: ['Thriller'], hue: 0, runtime: 5340, added: 12, pos: 0, cw: 0,
    overview: 'Eine Nachtdienst-Ärztin, ein abgeriegeltes Kreiskrankenhaus, ein Patient ohne Akte. Acht Stunden bis zur Frühschicht — erzählt in Echtzeit.',
  },
  {
    id: 'sommer-marseille', type: 'movie', title: 'Sommer in Marseille', year: 2023, fsk: 6,
    genres: ['Komödie'], hue: 45, runtime: 6060, added: 6, pos: 0, cw: 0,
    overview: 'Der pensionierte Lokführer Herbert Kaminski will nur seinen Koffer zurück. Die Fluggesellschaft schickt ihn dafür quer durch Marseille — und mitten in die Familienfeier der Fahrerin Amira.',
  },
  {
    id: 'kartograf', type: 'movie', title: 'Der Kartograf', year: 2020, fsk: 12,
    genres: ['Historie'], hue: 190, runtime: 8040, added: 13, pos: 0, cw: 0,
    overview: '1783: Der junge Kartograf Elias Vogt soll das Erzgebirge neu vermessen. Doch seine Karten zeigen, was der Hof nicht sehen will — leere Dörfer, verlassene Gruben, hungernde Täler.',
  },
  {
    id: 'blaupause', type: 'movie', title: 'Blaupause', year: 2025, fsk: 0,
    genres: ['Dokumentation'], hue: 220, runtime: 5220, added: 4, pos: 0, cw: 0,
    overview: 'Wie baut man eine Stadt, die es noch nicht gibt? Zwei Jahre hinter den Kulissen des größten Holzbau-Quartiers Europas — vom ersten Modell bis zum Einzug.',
  },
  {
    id: 'halbmond', type: 'series', title: 'Halbmond', year: 2024, fsk: 16,
    genres: ['Spionage', 'Drama'], hue: 230, added: 5, cw: 4,
    lastPlayed: { season: 2, ep: 4 },
    overview: 'Ost-Berlin, 1983: Die Übersetzerin Vera Salt führt ein Doppelleben zwischen zwei Diensten. Als ihr Führungsoffizier verschwindet, weiß sie nicht mehr, für wen ihre Berichte eigentlich bestimmt sind.',
    seasons: [
      { n: 1, episodes: [
        { n: 1, title: 'Ankunft', dur: 3060, watched: true, pos: 0 },
        { n: 2, title: 'Deckname Aster', dur: 2940, watched: true, pos: 0 },
        { n: 3, title: 'Der Brief', dur: 3000, watched: true, pos: 0 },
        { n: 4, title: 'Tote Winkel', dur: 3120, watched: true, pos: 0 },
        { n: 5, title: 'Grenzverkehr', dur: 2880, watched: true, pos: 0 },
        { n: 6, title: 'Das Archiv', dur: 3060, watched: true, pos: 0 },
        { n: 7, title: 'Nachtfahrt', dur: 2940, watched: true, pos: 0 },
        { n: 8, title: 'Übergabe', dur: 3300, watched: true, pos: 0 },
      ] },
      { n: 2, episodes: [
        { n: 1, title: 'Rückkehr', dur: 3060, watched: true, pos: 0 },
        { n: 2, title: 'Alte Schulden', dur: 2940, watched: true, pos: 0 },
        { n: 3, title: 'Doppelgänger', dur: 3000, watched: true, pos: 0 },
        { n: 4, title: 'Das Netz', dur: 3120, watched: false, pos: 1250 },
        { n: 5, title: 'Stille Post', dur: 2940, watched: false, pos: 0 },
        { n: 6, title: 'Gegenlicht', dur: 3060, watched: false, pos: 0 },
        { n: 7, title: 'Maulwurf', dur: 2940, watched: false, pos: 0 },
        { n: 8, title: 'Endspiel', dur: 3480, watched: false, pos: 0 },
      ] },
    ],
  },
  {
    id: 'revier', type: 'series', title: 'Revier', year: 2023, fsk: 12,
    genres: ['Krimi'], hue: 80, added: 10, cw: 0, lastPlayed: null,
    overview: 'Eine Kommissarin kehrt aus Hamburg zurück ins Ruhrgebiet ihrer Jugend. Jeder Fall führt tiefer in ein Geflecht aus Zechen-Erbe, Familienbanden und Dingen, über die man im Revier nicht spricht.',
    seasons: [makeSeason(1, 6, 2700, 6), makeSeason(2, 6, 2700, 6), makeSeason(3, 6, 2760, 2)],
  },
  {
    id: 'station-nord', type: 'series', title: 'Station Nord', year: 2025, fsk: 12,
    genres: ['Science-Fiction'], hue: 180, added: 3, cw: 0, lastPlayed: null,
    overview: 'Sechs Überwinterer, eine Polarstation, neun Monate Dunkelheit. Als der Funkkontakt abbricht, empfängt die Station weiter Nachrichten — abgestempelt mit dem Datum des nächsten Frühjahrs.',
    seasons: [makeSeason(1, 8, 2820)],
  },
  {
    id: 'werkstatt', type: 'series', title: 'Die Werkstatt', year: 2022, fsk: 6,
    genres: ['Comedy'], hue: 25, added: 14, cw: 0, lastPlayed: null,
    overview: 'Halb Autowerkstatt, halb Dorfparlament: Bei Meisterin Rosi Lindner wird mehr repariert als nur Autos. Vier Staffeln über Kundschaft, Kaffee und die große Frage, wem der Parkplatz vorm Tor gehört.',
    seasons: [makeSeason(1, 10, 1560, 10), makeSeason(2, 10, 1560, 10), makeSeason(3, 10, 1620, 10), makeSeason(4, 10, 1620, 4)],
  },
  {
    id: 'tiefgang', type: 'series', title: 'Tiefgang', year: 2024, fsk: 16,
    genres: ['Drama'], hue: 320, added: 15, cw: 2,
    lastPlayed: { season: 1, ep: 2 },
    overview: 'Eine Binnenschifferfamilie, drei Generationen, ein Frachter mit Hypothek. Zwischen Rotterdam und Basel verhandelt jede Fahrt neu, wer an Bord das Sagen hat — und wer von Bord geht.',
    seasons: [makeSeason(1, 6, 2580, 1), makeSeason(2, 6, 2640)],
  },
  {
    id: 'funkstille', type: 'series', title: 'Funkstille', year: 2021, fsk: 12,
    genres: ['Mystery'], hue: 265, added: 16, cw: 0, lastPlayed: null,
    overview: 'Ein Küstenort verliert für sieben Minuten jede Verbindung zur Außenwelt — Netz, Radio, Festnetz. Niemand erinnert sich an die Zeit dazwischen. Dann tauchen die ersten Aufnahmen auf.',
    seasons: [makeSeason(1, 8, 2640, 8), makeSeason(2, 8, 2640, 8), makeSeason(3, 8, 2700)],
  },
];

/* Resume-Punkt in einer generierten Staffel nachtragen (Tiefgang S1E2 läuft) */
LIBRARY_SEED_ITEMS.find((i) => i.id === 'tiefgang')!.seasons![0].episodes[1].pos = 2050;

/** Spielt den Fake-Bestand ein — einmal, beim Laden der Bibliothek. */
export function installFakeLibrary(): void {
  if (appState.library.items.length === 0) appState.library.items = LIBRARY_SEED_ITEMS;
}
