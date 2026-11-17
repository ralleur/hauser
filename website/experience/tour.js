// SPDX-License-Identifier: AGPL-3.0-only
// Durations are reading time AFTER the real app acknowledges a visible result.
export const scenes = [
  {id:'welcome', chapter:'welcome', seconds:7},
  {id:'lamp', chapter:'light', seconds:6},
  {id:'cozy', chapter:'light', seconds:7},
  {id:'commute', chapter:'commute', seconds:18, panel:true},
  {id:'photo', chapter:'rooms', seconds:4},
  {id:'illustration', chapter:'rooms', seconds:7},
  {id:'energy', chapter:'energy', seconds:13},
  {id:'shopping', chapter:'everyday', seconds:6},
  {id:'checked', chapter:'everyday', seconds:6},
  {id:'evening', chapter:'quiet', seconds:7},
  {id:'quiet', chapter:'quiet', seconds:7, panel:true},
  {id:'finish', chapter:'finish', seconds:7},
];
export const narrative = {
  en: {
    welcome:['Come on in.', 'A real app. A simulated home.'],
    light:['The picture is the switch.', 'Control lights and scenes directly in your room.'],
    commute:['Know when to leave.', 'Your route, traffic and departure time, together.'],
    rooms:['Your home, in its own image.', 'Start with your own room photo.'],
    energy:['See where your energy goes.', 'Solar, consumption, battery and grid in one view.'],
    everyday:['The little things, together.', 'Shared shopping, reminders and calendars.'],
    quiet:['At home, even at rest.', 'Your clock, your week, a few things to remember.'],
    finish:['Make yourself at home.', 'Free. No subscription.'],
    names:['Welcome','Light','Commute','Your rooms','Energy','Everyday','At rest','At home'],
    pause:'Pause', resume:'Continue tour', replay:'Watch again', explore:'Explore freely', panel:'Wall panel view',
    paused:'Your turn. Continue whenever you like.', loading:'Preparing the next moment…', error:'This moment could not load. Continue to try again.',
    playLabel:'Play or pause the introduction', chapters:'Choose a chapter', progress:'Introduction progress',
  },
  de: {
    welcome:['Komm herein.', 'Die echte App. Ein simuliertes Zuhause.'],
    light:['Das Bild ist der Schalter.', 'Lichter und Szenen direkt in deinem Raum steuern.'],
    commute:['Wissen, wann du losmusst.', 'Deine Route, Verkehr und Abfahrtszeit an einem Ort.'],
    rooms:['Dein Zuhause. Dein Bild.', 'Alles beginnt mit einem Foto deines Raums.'],
    energy:['Sehen, wohin die Energie fließt.', 'Solar, Verbrauch, Batterie und Netz auf einen Blick.'],
    everyday:['Die kleinen Dinge. Gemeinsam.', 'Einkäufe, Erinnerungen und Kalender für alle.'],
    quiet:['Zuhause. Auch in der Ruhe.', 'Deine Uhr, deine Woche, ein paar kleine Erinnerungen.'],
    finish:['Fühl dich wie zuhause.', 'Kostenlos. Ohne Abo.'],
    names:['Willkommen','Licht','Arbeitsweg','Deine Räume','Energie','Alltag','In Ruhe','Zuhause'],
    pause:'Pause', resume:'Tour fortsetzen', replay:'Noch einmal ansehen', explore:'Frei erkunden', panel:'Wandpanel-Ansicht',
    paused:'Du bist dran. Weiter, wann du möchtest.', loading:'Der nächste Moment wird vorbereitet…', error:'Dieser Moment konnte nicht laden. Mit Fortsetzen erneut versuchen.',
    playLabel:'Einführung abspielen oder pausieren', chapters:'Kapitel wählen', progress:'Fortschritt der Einführung',
  },
};
export const loadingCopy = {
  de: { title: 'Dein Zuhause wird vorbereitet.', phases: ['Verbindung zur Demo aufbauen…', 'Hauser wird geladen…', 'Bedienoberfläche vorbereiten…', 'Raumbilder laden…', 'Letzte Details vorbereiten…', 'Die Tür ist offen.'], images: (done, total) => `Raumbilder laden · ${done} von ${total}`, slow: 'Beim ersten Besuch braucht Hauser etwas länger. Der Fortschritt läuft weiter, sobald die nächste Ladephase abgeschlossen ist.', retry: 'Erneut laden', step: 'Schritt' },
  en: { title: 'Getting your home ready.', phases: ['Connecting to the demo…', 'Loading Hauser…', 'Preparing the interface…', 'Loading room pictures…', 'Finishing the details…', 'The door is open.'], images: (done, total) => `Loading room pictures · ${done} of ${total}`, slow: 'The first visit takes a little longer. Progress continues as each loading phase completes.', retry: 'Load again', step: 'Step' },
};
