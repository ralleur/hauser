import json, glob

LANG_VALUES = {
  'de': {
    'laundry_label': 'Wäsche',
    'laundry_desc': 'Waschmaschine und Trockner einrichten — Zustandsentität oder Leistungssensor-Blueprint.',
    'layout_label': 'Layout & Bedienung',
    'layout_desc': 'Kontrollflächen und Raumkontexte des Home-Screens, Panelbreite — pro Gerät.',
    'media_label': 'Medien & Musik',
    'media_desc': 'Bibliotheks-Modus und KI-generierte Songtexte in der Songwerkstatt.',
    'ai_customizing_label': 'App per KI anpassen',
    'ai_customizing_desc': 'Feature-Chat und Verlauf: die App durch Beschreibungen anpassen und Änderungen zurückrollen.',
    'sys_group_services_ai': 'KI',
    'appearance_label': 'Erscheinungsbild',
    'calendar_label': 'Kalender & Erinnerungen',
    'calendar_desc': 'Auswahl der angezeigten Kalender und Erinnerungslisten.',
    'status_label': 'Status & Updates',
    'status_desc': 'Gesundheitszustand der Verbindung und aller Smart-Home-Dienste, dazu verfügbare Software-Aktualisierungen.',
    'maintenance_label': 'Wartung & Diagnose',
    'maintenance_desc': 'Lokale Caches leeren, Demo-Modus umschalten, App neu laden.',
  },
  'en': {
    'laundry_label': 'Laundry',
    'laundry_desc': 'Set up the washer and dryer — a state entity or a power-sensor blueprint.',
    'layout_label': 'Layout & Interaction',
    'layout_desc': 'Control surfaces and room contexts of the Home screen, panel width — per device.',
    'media_label': 'Media & Music',
    'media_desc': 'Library mode and AI-generated lyrics in the Song Studio.',
    'ai_customizing_label': 'Customize the app with AI',
    'ai_customizing_desc': 'Feature chat and history: describe changes and roll them back.',
    'sys_group_services_ai': 'AI',
    'appearance_label': 'Appearance',
    'calendar_label': 'Calendar & Reminders',
    'calendar_desc': 'Choose which calendars and reminder lists to show.',
    'status_label': 'Status & Updates',
    'status_desc': 'Health of the connection and of every smart home service, plus available software updates.',
    'maintenance_label': 'Maintenance & Diagnostics',
    'maintenance_desc': 'Clear local caches, switch demo mode, reload the app.',
  },
  'fr': {
    'laundry_label': 'Linge',
    'laundry_desc': 'Configurez la machine à laver et le sèche-linge — entité d\'état ou blueprint de capteur de puissance.',
    'layout_label': 'Mise en page & utilisation',
    'layout_desc': 'Surfaces de contrôle et contextes de pièce de l\'écran d\'accueil, largeur du panneau — par appareil.',
    'media_label': 'Médias & musique',
    'media_desc': 'Mode bibliothèque et paroles générées par IA dans l\'Atelier à chansons.',
    'ai_customizing_label': 'Personnaliser l\'app avec l\'IA',
    'ai_customizing_desc': 'Chat et historique des fonctionnalités : décrire des modifications et les annuler.',
    'sys_group_services_ai': 'IA',
    'appearance_label': 'Apparence',
    'calendar_label': 'Calendrier & rappels',
    'calendar_desc': 'Choisissez les calendriers et listes de rappels affichés.',
    'status_label': 'Statut & mises à jour',
    'status_desc': 'Santé de la connexion et de tous les services domotiques, plus les mises à jour disponibles.',
    'maintenance_label': 'Maintenance & diagnostic',
    'maintenance_desc': 'Vider les caches locaux, basculer le mode démo, recharger l\'application.',
  },
  'it': {
    'laundry_label': 'Bucato',
    'laundry_desc': 'Configura lavatrice e asciugatrice — entità di stato o blueprint del sensore di potenza.',
    'layout_label': 'Layout e interazione',
    'layout_desc': 'Superfici di controllo e contesti stanza della schermata Home, larghezza del pannello — per dispositivo.',
    'media_label': 'Media e musica',
    'media_desc': 'Modalità libreria e testi generati dall\'IA nella Song Workshop.',
    'ai_customizing_label': 'Personalizza l\'app con l\'IA',
    'ai_customizing_desc': 'Chat e cronologia delle funzionalità: descrivi le modifiche e annullale.',
    'sys_group_services_ai': 'IA',
    'appearance_label': 'Aspetto',
    'calendar_label': 'Calendario e promemoria',
    'calendar_desc': 'Scelta dei calendari e degli elenchi di promemoria mostrati.',
    'status_label': 'Stato e aggiornamenti',
    'status_desc': 'Salute della connessione e di tutti i servizi della casa intelligente, più gli aggiornamenti disponibili.',
    'maintenance_label': 'Manutenzione e diagnostica',
    'maintenance_desc': 'Svuotare le cache locali, cambiare modalità demo, ricaricare l\'app.',
  },
  'pl': {
    'laundry_label': 'Pranie',
    'laundry_desc': 'Skonfiguruj pralkę i suszarkę — encja stanu lub blueprint czujnika mocy.',
    'layout_label': 'Układ i obsługa',
    'layout_desc': 'Powierzchnie sterowania i konteksty pomieszczeń ekranu głównego, szerokość panelu — na urządzenie.',
    'media_label': 'Media i muzyka',
    'media_desc': 'Tryb biblioteki i teksty generowane przez AI w Warsztacie piosenek.',
    'ai_customizing_label': 'Dostosuj aplikację przez AI',
    'ai_customizing_desc': 'Chat funkcji i historia: opisz zmiany i cofnij je.',
    'sys_group_services_ai': 'AI',
    'appearance_label': 'Wygląd',
    'calendar_label': 'Kalendarz i przypomnienia',
    'calendar_desc': 'Wybór wyświetlanych kalendarzy i list przypomnień.',
    'status_label': 'Stan i aktualizacje',
    'status_desc': 'Kondycja połączenia i wszystkich usług inteligentnego domu oraz dostępne aktualizacje.',
    'maintenance_label': 'Konserwacja i diagnostyka',
    'maintenance_desc': 'Wyczyść lokalne pamięci podręczne, przełącz tryb demo, przeładuj aplikację.',
  },
  'pt': {
    'laundry_label': 'Roupas',
    'laundry_desc': 'Configure a máquina de lavar e a secadora — entidade de estado ou blueprint de sensor de potência.',
    'layout_label': 'Layout e interação',
    'layout_desc': 'Superfícies de controle e contextos de cômodos da tela inicial, largura do painel — por dispositivo.',
    'media_label': 'Mídia e música',
    'media_desc': 'Modo biblioteca e letras geradas por IA na Oficina de canções.',
    'ai_customizing_label': 'Personalize o app com IA',
    'ai_customizing_desc': 'Chat de recursos e histórico: descreva mudanças e desfaça-as.',
    'sys_group_services_ai': 'IA',
    'appearance_label': 'Aparência',
    'calendar_label': 'Calendário e lembretes',
    'calendar_desc': 'Escolha dos calendários e listas de lembretes apresentados.',
    'status_label': 'Estado e atualizações',
    'status_desc': 'Saúde da ligação e de todos os serviços da casa inteligente, mais as atualizações disponíveis.',
    'maintenance_label': 'Manutenção e diagnóstico',
    'maintenance_desc': 'Limpar caches locais, alternar o modo demo, recarregar a aplicação.',
  },
}

REMOVE = [
  'settings_group_ai_label',
  'settings_section_updates_label', 'settings_section_updates_desc',
  'settings_section_notifications_label', 'settings_section_notifications_desc',
  'settings_section_home_layout_label', 'settings_section_home_layout_desc',
  'settings_section_operating_mode_label', 'settings_section_operating_mode_desc',
  'settings_section_ai_access_label', 'settings_section_ai_access_desc',
  'settings_section_ai_features_label', 'settings_section_ai_features_desc',
  'sys_operating_mode_note', 'sys_ai_features_group',
]

# new key -> anchor key (insert right after anchor)
ADD_AFTER = {
  'settings_section_laundry_label': 'settings_section_rooms_devices_label',
  'settings_section_laundry_desc': 'settings_section_laundry_label',
  'settings_section_layout_label': 'settings_section_appearance_desc',
  'settings_section_layout_desc': 'settings_section_layout_label',
  'settings_section_media_label': 'settings_section_shopping_desc',
  'settings_section_media_desc': 'settings_section_media_label',
  'settings_section_ai_customizing_label': 'settings_entry_ai_song_lyrics_label',
  'settings_section_ai_customizing_desc': 'settings_section_ai_customizing_label',
  'sys_group_services_ai': 'sys_group_services_private',
}

UPDATE = {
  'settings_section_appearance_label': 'appearance_label',
  'settings_section_calendar_label': 'calendar_label',
  'settings_section_calendar_desc': 'calendar_desc',
  'settings_section_status_label': 'status_label',
  'settings_section_status_desc': 'status_desc',
  'settings_section_maintenance_label': 'maintenance_label',
  'settings_section_maintenance_desc': 'maintenance_desc',
}

for path in sorted(glob.glob('app/messages/*.json')):
    lang = path.split('/')[-1][:-5]
    d = json.load(open(path))
    for k in REMOVE:
        d.pop(k, None)
    for k, varkey in UPDATE.items():
        d[k] = LANG_VALUES[lang][varkey]
    # insert new keys after anchors
    for newk, anchor in ADD_AFTER.items():
        if newk in d:
            continue
        value = newk.split('_label')[0] if newk.endswith('_label') else None
        if newk.endswith('_label'):
            varkey = newk.replace('settings_section_', '').replace('_label', '') + '_label'
            val = LANG_VALUES[lang][varkey]
        elif newk.endswith('_desc'):
            varkey = newk.replace('settings_section_', '').replace('_desc', '') + '_desc'
            val = LANG_VALUES[lang][varkey]
        else:  # sys_group_services_ai
            val = LANG_VALUES[lang]['sys_group_services_ai']
        items = list(d.items())
        pos = 0
        for i, (ak, av) in enumerate(items):
            if ak == anchor:
                pos = i + 1
                break
        else:
            pos = len(items)
        items.insert(pos, (newk, val))
        d = dict(items)
    json.dump(d, open(path, 'w'), ensure_ascii=False, indent=2)
    open(path, 'a').write('\n')
    print(f'{path}: {len(d)} keys')

print('done')
