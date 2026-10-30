// SPDX-License-Identifier: AGPL-3.0-only
// Each stop opens the real app surface; chapter links remain available throughout.
const tours = {
  de: {
    light: [
      { key: 'tap', label: 'Schalten', next: 'Regler öffnen', response: 'Ein Tipp genügt. Als Nächstes öffnen wir die Regler hinter dem Schalter.' },
      { key: 'controls', label: 'Fein einstellen', next: 'Szenen erleben', title: 'Einfach an.<br>Oder genau dein Licht.', text: 'Hier steckt mehr hinter dem Schalter: Helligkeit, Lichttemperatur und Farbe. Probiere die Regler der Stehlampe aus. Im Alltag erreichst du sie durch Gedrückthalten.', response: 'So viel Kontrolle, wie du gerade brauchst.' },
      { key: 'scenes', label: 'Stimmung wählen', next: 'Zum Hausklima', title: 'Ein Raum.<br>Eine Stimmung.', text: 'Wähle „Gemütlich“, „Hell“ oder „Aus“. Eine Szene verändert mehrere Leuchten zusammen. Deine eigenen Szenen kannst du später nach deinen Wünschen zusammenstellen.', response: 'Eine Berührung verändert den ganzen Raum.' },
      { key: 'climate', label: 'Alle Räume', next: 'Deine Räume', title: 'Ein bisschen wärmer.<br>Im ganzen Zuhause.', text: 'Mit Plus und Minus unten regelst du die Temperatur für alle beteiligten Räume. Einzelne Zimmer behalten ihre eigenen Regler. Welche Räume mitmachen und mit welchem Abstand, lässt sich konfigurieren.', response: 'Ein gemeinsamer Regler. Platz für die Eigenheiten jedes Raums.' },
    ],
    rooms: [
      { key: 'rooms', label: 'Wiedererkennen', next: 'Raum gestalten' },
      { key: 'room-design', label: 'Dein Raumbild', next: 'Zur Konfiguration', title: 'Dein Raum.<br>Auch im Detail.', text: 'Das ist der echte Raum-Editor. Tausche Bilder aus, passe den Ausschnitt an und lege fest, wo Geräte im Bild sitzen. Über den Zurück-Pfeil bestimmst du auch, welche Geräte in diesem Raum auftauchen.', response: 'Dein Zuhause gibt die Form vor.' },
      { key: 'appearance', label: 'Deine Oberfläche', next: 'Weiter zur Energie', detail: 'Was du anpassen kannst ↗', heading: 'Dein Zuhause gibt den Ton an.', more: 'Hell oder dunkel, Glas oder ruhige Flächen, eine oder mehrere Kontrollflächen: Die Konfiguration macht Hauser zu deiner Oberfläche. Weitere Bereiche bündeln Räume und Geräte, Sensoren, Standby, Kalender und Einkäufe. Du brauchst diese Tiefe zum täglichen Bedienen nicht – sie ist da, wenn du etwas ändern möchtest.', url: 'using/home-screen/#three-views', link: 'Mehr zu den Home-Ansichten (EN)', title: 'Leicht zu bedienen.<br>Frei zu gestalten.', text: 'Jetzt sind wir in der Konfiguration. Probiere einen anderen Kartenstil oder ein helles Erscheinungsbild aus. Hier findest du auch Layout, Bedienung und weitere Bereiche für deine Räume und Inhalte.', response: 'Die Oberfläche passt sich dir an. Deine Auswahl bleibt in dieser Demo.' },
    ],
  },
  en: {
    light: [
      { key: 'tap', label: 'Switch', next: 'Open controls', response: 'One tap is enough. Next, let’s open the controls behind the switch.' },
      { key: 'controls', label: 'Fine tune', next: 'Try a scene', title: 'Simply on.<br>Or just your light.', text: 'There’s more behind the switch: brightness, colour temperature and colour. Try the floor lamp’s controls. In everyday use, a long press brings you here.', response: 'As much control as you need, when you need it.' },
      { key: 'scenes', label: 'Set the mood', next: 'Whole-home climate', title: 'One room.<br>One mood.', text: 'Choose Cozy, Bright or Off. A scene changes several lights together. You can build your own scenes to suit your home.', response: 'One touch changes the whole room.' },
      { key: 'climate', label: 'Every room', next: 'Your rooms', title: 'A little warmer.<br>Across your home.', text: 'Use plus and minus below to adjust the temperature in all participating rooms. Each room keeps its own controls. You can configure which rooms take part and their temperature offsets.', response: 'A shared control, with room for individual preferences.' },
    ],
    rooms: [
      { key: 'rooms', label: 'Recognise', next: 'Shape your room' },
      { key: 'room-design', label: 'Your room picture', next: 'Open settings', title: 'Your room.<br>Down to the details.', text: 'This is the actual room editor. Replace pictures, adjust their crop and position devices in the image. The back arrow also takes you to the devices that belong in this room.', response: 'Your home gives the interface its shape.' },
      { key: 'appearance', label: 'Your interface', next: 'On to energy', detail: 'What you can customise ↗', heading: 'Your home sets the tone.', more: 'Light or dark, glass or quiet surfaces, one control panel or more: settings make Hauser your interface. Further sections cover rooms and devices, sensors, standby, calendars and shopping. This depth stays available whenever you want to change something.', url: 'using/home-screen/#three-views', link: 'More about the home views', title: 'Easy to use.<br>Yours to shape.', text: 'Now we’re in the real settings. Try another card style or a light appearance. This is also where you find layout, interaction and further sections for your rooms and content.', response: 'The interface adapts to you. Your choices stay in this demo.' },
    ],
  },
};
export function tourSteps(chapter, locale) {
  return tours[locale][chapter] ?? [{ key: chapter, label: '' }];
}
export const loadingCopy = {
  de: { title: 'Dein Zuhause wird vorbereitet.', phases: ['Verbindung zur Demo aufbauen…', 'Hauser wird geladen…', 'Bedienoberfläche vorbereiten…', 'Raumbilder laden…', 'Letzte Details vorbereiten…', 'Die Tür ist offen.'], images: (done, total) => `Raumbilder laden · ${done} von ${total}`, slow: 'Beim ersten Besuch braucht Hauser etwas länger. Der Fortschritt läuft weiter, sobald die nächste Ladephase abgeschlossen ist.', retry: 'Erneut laden', step: 'Schritt' },
  en: { title: 'Getting your home ready.', phases: ['Connecting to the demo…', 'Loading Hauser…', 'Preparing the interface…', 'Loading room pictures…', 'Finishing the details…', 'The door is open.'], images: (done, total) => `Loading room pictures · ${done} of ${total}`, slow: 'The first visit takes a little longer. Progress continues as each loading phase completes.', retry: 'Load again', step: 'Step' },
};
