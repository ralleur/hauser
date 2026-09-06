/* API-Vertrag der Hauser-Serverfläche.

   Eine Route pro Eintrag: Kennung, Methoden, Pfadmuster, Bereich, Zugangs-
   klasse und ein kurzer Zweck. Pfadparameter stehen als `:name`. Der Vertrag
   ist die einzige Quelle für `src/lib/api/contract.generated.ts` (Browser-
   Client) und für den Drift-Test, der jede `/api/...`-Literalstelle in Server
   und Oberfläche gegen diese Liste prüft.

   Zugangsklassen:
   - `public`   — ohne Origin-Prüfung erreichbar (Health, Build-Info, Ambient).
   - `origin`   — Browser-Anfrage von einer freigegebenen Origin (Trusted LAN).
   - `admin`    — hinter dem Hotel-Admin-Gate, wenn Hotel Mode eingerichtet ist.
   - `session`  — verlangt eine zuvor freigegebene Sitzung (PIN-Cookie).
   - `guest`    — für Hotelgäste ohne Adminsitzung erreichbar.

   Antworttypen (`response`) verweisen auf Namen in `src/lib/api/types.ts`;
   ohne Angabe ist die Antwort für den Client `unknown`. */

export const API_CONTRACT_VERSION = 1;

/** @typedef {'GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE'} ApiMethod */
/** `cacheable: true` markiert eine Leseroute, deren Antwort der Server mit
    einem schwachen ETag versieht (Paket 11): eine wiederholte Anfrage mit
    passendem `if-none-match` bekommt 304 statt des Rumpfs. Bewusst eine
    Eigenschaft des Vertrags und nicht der Route — hier steht, was gespeichert
    werden darf. Alles ohne Markierung bleibt `no-store`. */

/** @typedef {{ id: string, methods: ApiMethod[], path: string, area: string, access: 'public'|'origin'|'admin'|'session'|'guest', purpose: string, response?: string, cacheable?: boolean }} ApiRoute */

/** @type {ApiRoute[]} */
export const API_ROUTES = [
  /* ── Kern ── */
  { id: 'health', methods: ['GET'], path: '/api/health', area: 'core', access: 'public', purpose: 'Readiness des Servers und der Haushaltskonfiguration.', response: 'HealthResponse' },
  { id: 'buildInfo', methods: ['GET'], path: '/api/build-info', area: 'core', access: 'public', purpose: 'Version, Revision, Lizenz und Quellcode-Adresse (AGPL §13).', response: 'BuildInfoResponse', cacheable: true },
  { id: 'haConnection', methods: ['GET'], path: '/api/ha/connection', area: 'core', access: 'origin', purpose: 'Betriebsart des Home-Assistant-Zugangs (direct/supervisor).', response: 'HaConnectionResponse' },
  { id: 'haGateway', methods: ['GET'], path: '/api/websocket', area: 'core', access: 'origin', purpose: 'Same-Origin-WebSocket-Relais zu Home Assistant im Supervisor-Modus (Upgrade).' },
  { id: 'haCameraProxy', methods: ['GET'], path: '/api/camera_proxy/:entityId', area: 'core', access: 'origin', purpose: 'Kamerabild aus Home Assistant im Supervisor-Modus.' },
  { id: 'haCameraProxyStream', methods: ['GET'], path: '/api/camera_proxy_stream/:entityId', area: 'core', access: 'origin', purpose: 'Kamerastrom aus Home Assistant im Supervisor-Modus.' },
  { id: 'haCaldavFlow', methods: ['POST'], path: '/api/ha/caldav-flow', area: 'core', access: 'origin', purpose: 'iCloud-Kalender über den HA-Config-Flow einrichten.' },

  /* ── Konfiguration ── */
  { id: 'config', methods: ['GET', 'PUT'], path: '/api/config', area: 'config', access: 'origin', purpose: 'Geteilte Gerätekonfiguration (ETag-geschützt).', response: 'SharedConfigResponse' },
  { id: 'householdConfigMode', methods: ['GET'], path: '/api/household-config-mode', area: 'config', access: 'origin', purpose: 'Aktiver oder Schattenmodus der Haushaltskonfiguration.', response: 'HouseholdConfigModeResponse' },
  { id: 'householdConfig', methods: ['GET', 'HEAD'], path: '/api/household-config', area: 'config', access: 'origin', purpose: 'Versionierte Haushaltskonfiguration (ETag-geschützt).', cacheable: true },
  { id: 'householdModuleToggle', methods: ['PUT'], path: '/api/household-modules/:moduleId', area: 'config', access: 'origin', purpose: 'Optionales Modul ein- oder ausschalten.' },
  { id: 'householdEnergy', methods: ['PUT'], path: '/api/household-energy', area: 'config', access: 'origin', purpose: 'Energie-Sensorauswahl speichern.' },
  { id: 'setupDiscovery', methods: ['GET'], path: '/api/setup/discovery', area: 'setup', access: 'origin', purpose: 'Areas und Entitäten aus Home Assistant für den Wizard lesen.' },
  { id: 'setupActivate', methods: ['POST'], path: '/api/setup/activate', area: 'setup', access: 'origin', purpose: 'Haushaltskonfiguration validieren und atomar aktivieren.' },

  /* ── Benachrichtigungen und Wäsche ── */
  { id: 'notificationRules', methods: ['GET', 'PUT'], path: '/api/notifications/rules', area: 'notifications', access: 'origin', purpose: 'Regeln der Benachrichtigungskategorien.', response: 'NotificationRulesResponse', cacheable: true },
  { id: 'laundryExistingValidate', methods: ['POST'], path: '/api/laundry/existing/validate', area: 'laundry', access: 'origin', purpose: 'Vorhandene Statusentität prüfen.' },
  { id: 'laundryExistingApply', methods: ['POST'], path: '/api/laundry/existing/apply', area: 'laundry', access: 'origin', purpose: 'Vorhandene Statusentität übernehmen.' },
  { id: 'laundryBlueprintPreview', methods: ['POST'], path: '/api/laundry/blueprint/preview', area: 'laundry', access: 'origin', purpose: 'Blueprint-Objekte vor dem Anlegen zeigen.' },
  { id: 'laundryBlueprintApply', methods: ['POST'], path: '/api/laundry/blueprint/apply', area: 'laundry', access: 'origin', purpose: 'Blueprint-Objekte in Home Assistant anlegen.' },
  { id: 'laundryDisablePreview', methods: ['POST'], path: '/api/laundry/disable/preview', area: 'laundry', access: 'origin', purpose: 'Rückbau vorab zeigen.' },
  { id: 'laundryDisableApply', methods: ['POST'], path: '/api/laundry/disable/apply', area: 'laundry', access: 'origin', purpose: 'Wäsche-Adapter deaktivieren.' },

  /* ── Familiendaten ── */
  { id: 'reminders', methods: ['GET', 'POST'], path: '/api/reminders', area: 'family', access: 'origin', purpose: 'Zentrale Erinnerungen lesen und anlegen.', response: 'RemindersResponse', cacheable: true },
  { id: 'reminderComplete', methods: ['POST'], path: '/api/reminders/:id/complete', area: 'family', access: 'origin', purpose: 'Erinnerung als erledigt markieren.' },
  { id: 'reminderUpdate', methods: ['PATCH'], path: '/api/reminders/:id', area: 'family', access: 'origin', purpose: 'Erinnerung ändern.' },
  { id: 'shopping', methods: ['GET'], path: '/api/shopping', area: 'family', access: 'origin', purpose: 'Einkaufsliste lesen.', response: 'ShoppingResponse' },
  { id: 'shoppingItems', methods: ['POST'], path: '/api/shopping/items', area: 'family', access: 'origin', purpose: 'Eintrag anlegen.' },
  { id: 'shoppingItemUpdate', methods: ['PATCH'], path: '/api/shopping/items/:id', area: 'family', access: 'origin', purpose: 'Eintrag ändern oder abhaken.' },
  { id: 'shoppingStores', methods: ['POST'], path: '/api/shopping/stores', area: 'family', access: 'origin', purpose: 'Geschäft anlegen.' },
  { id: 'shoppingStoreDelete', methods: ['DELETE'], path: '/api/shopping/stores/:storeId', area: 'family', access: 'origin', purpose: 'Geschäft entfernen.' },
  { id: 'shoppingHaList', methods: ['POST'], path: '/api/shopping/ha-list', area: 'family', access: 'origin', purpose: 'Neue Einkaufsliste als todo-Entität in Home Assistant anlegen.' },
  { id: 'shoppingNotion', methods: ['GET'], path: '/api/shopping/notion', area: 'family', access: 'origin', purpose: 'Einkaufsliste aus der Notion-Seite lesen.', response: 'ShoppingResponse', cacheable: true },
  { id: 'shoppingNotionItems', methods: ['POST'], path: '/api/shopping/notion/items', area: 'family', access: 'origin', purpose: 'Eintrag auf der Notion-Seite anlegen.' },
  { id: 'shoppingNotionItemUpdate', methods: ['PATCH'], path: '/api/shopping/notion/items/:id', area: 'family', access: 'origin', purpose: 'Notion-Eintrag abhaken.' },
  { id: 'weather', methods: ['GET'], path: '/api/weather', area: 'family', access: 'origin', purpose: 'Außenwetter für den Heimatort aus Home Assistant (Open-Meteo, serverseitig, ohne Koordinaten in der Antwort).', cacheable: true },
  { id: 'moments', methods: ['GET'], path: '/api/moments', area: 'family', access: 'origin', purpose: 'Kalendermomente des Tages (Geburtstag, fester Tag, erster Schnee).', response: 'MomentsResponse', cacheable: true },

  /* ── Raumbilder ── */
  { id: 'roomImageCapability', methods: ['GET', 'HEAD'], path: '/api/room-images/capability', area: 'room-images', access: 'origin', purpose: 'Sanitisierter Funktionsstatus des Raumbild-Wizards.' },
  { id: 'roomImageCapabilityDetails', methods: ['GET', 'HEAD'], path: '/api/room-images/capability/details', area: 'room-images', access: 'admin', purpose: 'Detailstatus für die Einstellungen.' },
  { id: 'roomImageProbe', methods: ['POST'], path: '/api/room-images/probe', area: 'room-images', access: 'admin', purpose: 'Provider-Zugang prüfen.' },
  { id: 'roomImageAccess', methods: ['GET', 'DELETE'], path: '/api/room-images/access', area: 'room-images', access: 'admin', purpose: 'Provider-Zugang lesen oder entfernen.' },
  { id: 'roomImageAccessApiKey', methods: ['POST'], path: '/api/room-images/access/api-key', area: 'room-images', access: 'admin', purpose: 'OpenAI-Schlüssel hinterlegen.' },
  { id: 'roomImageAccessChatGptStart', methods: ['POST'], path: '/api/room-images/access/chatgpt/start', area: 'room-images', access: 'admin', purpose: 'ChatGPT-Anmeldung starten.' },
  { id: 'roomImageAccessChatGptPoll', methods: ['POST'], path: '/api/room-images/access/chatgpt/poll', area: 'room-images', access: 'admin', purpose: 'ChatGPT-Anmeldung abfragen.' },
  { id: 'roomImageUploads', methods: ['POST'], path: '/api/room-image-uploads', area: 'room-images', access: 'admin', purpose: 'Quellfoto hochladen.' },
  { id: 'roomImageUploadDelete', methods: ['DELETE'], path: '/api/room-image-uploads/:uploadId', area: 'room-images', access: 'admin', purpose: 'Quellfoto verwerfen.' },
  { id: 'roomImageJobs', methods: ['POST'], path: '/api/room-image-jobs', area: 'room-images', access: 'admin', purpose: 'Generierungsauftrag anlegen.' },
  { id: 'roomImageJob', methods: ['GET'], path: '/api/room-image-jobs/:jobId', area: 'room-images', access: 'admin', purpose: 'Auftragsstatus lesen.' },
  { id: 'roomImageJobPublish', methods: ['POST'], path: '/api/room-image-jobs/:jobId/publish', area: 'room-images', access: 'admin', purpose: 'Ergebnis in die Bibliothek übernehmen.' },
  { id: 'roomImageJobRetry', methods: ['POST'], path: '/api/room-image-jobs/:jobId/retry', area: 'room-images', access: 'admin', purpose: 'Fehlgeschlagenen Auftrag wiederholen.' },
  { id: 'roomImageJobDiscard', methods: ['POST'], path: '/api/room-image-jobs/:jobId/discard', area: 'room-images', access: 'admin', purpose: 'Auftrag verwerfen.' },
  { id: 'roomImageJobCancel', methods: ['POST'], path: '/api/room-image-jobs/:jobId/cancel', area: 'room-images', access: 'admin', purpose: 'Auftrag abbrechen.' },
  { id: 'roomImageJobSourcePreview', methods: ['GET', 'HEAD'], path: '/api/room-image-jobs/:jobId/source-preview', area: 'room-images', access: 'admin', purpose: 'Vorschau des Quellfotos.' },
  { id: 'roomImageJobCandidatePreview', methods: ['GET', 'HEAD'], path: '/api/room-image-jobs/:jobId/previews/:candidateId', area: 'room-images', access: 'admin', purpose: 'Vorschau einer Variante.' },
  { id: 'roomImageJobFinalPreview', methods: ['GET', 'HEAD'], path: '/api/room-image-jobs/:jobId/final-previews/:variant', area: 'room-images', access: 'admin', purpose: 'Vorschau des finalen Satzes (light, dark, dark-off).' },
  { id: 'roomImageAssets', methods: ['GET'], path: '/api/room-image-assets', area: 'room-images', access: 'origin', purpose: 'Bibliothek der Bildsets.', cacheable: true },
  { id: 'roomImageOvercast', methods: ['POST'], path: '/api/room-image-assets/:assetId/overcast', area: 'room-images', access: 'admin', purpose: 'Trübe Bildvariante eines Bildsets erzeugen und dazulegen.' },
  { id: 'roomImageRegions', methods: ['POST'], path: '/api/room-image-assets/:assetId/regions', area: 'room-images', access: 'admin', purpose: 'Flächen eines Bildsets erkennen (Fenster, Sitzflächen, Tische …) und im Katalog festhalten.' },
  { id: 'roomImageAssetDelete', methods: ['DELETE'], path: '/api/room-image-assets/:assetId', area: 'room-images', access: 'admin', purpose: 'Bildset löschen.' },
  { id: 'roomImageAssignment', methods: ['PUT'], path: '/api/room-image-assignments/:roomId', area: 'room-images', access: 'admin', purpose: 'Bildset einem Raum zuweisen.' },
  { id: 'roomBackground', methods: ['POST', 'DELETE'], path: '/api/room-backgrounds/:roomId', area: 'room-images', access: 'admin', purpose: 'Manuelles Raumbild setzen oder auf den Projekt-Fallback zurückgehen.' },
  { id: 'roomImageAssignmentLegacy', methods: ['PUT'], path: '/api/rooms/:roomId/room-image-assignment', area: 'room-images', access: 'admin', purpose: 'Ältere Zuweisungsroute; bleibt für bestehende Clients beantwortet.' },

  /* ── Ambient ── */
  { id: 'ambientMap', methods: ['GET', 'HEAD'], path: '/api/ambient-map', area: 'ambient', access: 'public', purpose: 'Sanitisierter Status des Stadtplan-Hintergrunds.' },
  { id: 'ambientMapAdmin', methods: ['GET', 'HEAD'], path: '/api/admin/ambient-map', area: 'ambient', access: 'admin', purpose: 'Vollständiger Status mit Ort.' },
  { id: 'ambientMapLocation', methods: ['PUT', 'DELETE'], path: '/api/admin/ambient-map/location', area: 'ambient', access: 'admin', purpose: 'Ort setzen oder entfernen.' },
  { id: 'ambientMapSearch', methods: ['GET'], path: '/api/admin/ambient-map/search', area: 'ambient', access: 'admin', purpose: 'Ortssuche über den Server.' },
  { id: 'ambientMapRegenerate', methods: ['POST'], path: '/api/admin/ambient-map/regenerate', area: 'ambient', access: 'admin', purpose: 'Karte neu rendern.' },

  /* ── Hotel Mode ── */
  { id: 'hotelSession', methods: ['GET'], path: '/api/hotel-mode/session', area: 'hotel', access: 'guest', purpose: 'Adminsitzung des Aufrufers.' },
  { id: 'hotelStatus', methods: ['GET'], path: '/api/hotel-mode/status', area: 'hotel', access: 'guest', purpose: 'Aktivierungs- und Aufenthaltsstatus.' },
  { id: 'hotelEntities', methods: ['GET'], path: '/api/hotel-mode/entities', area: 'hotel', access: 'guest', purpose: 'Für den Gast sichtbare Entitäten.' },
  { id: 'hotelCommand', methods: ['POST'], path: '/api/hotel-mode/command', area: 'hotel', access: 'guest', purpose: 'Freigegebene Geräteaktion des Gasts.' },
  { id: 'hotelCheckout', methods: ['POST'], path: '/api/hotel-mode/checkout', area: 'hotel', access: 'guest', purpose: 'Auschecken.' },
  { id: 'hotelActivation', methods: ['GET'], path: '/api/hotel-mode/activation', area: 'hotel', access: 'admin', purpose: 'Aktivierungs-Vorprüfung.' },
  { id: 'hotelSettings', methods: ['GET', 'PUT'], path: '/api/hotel-mode/settings', area: 'hotel', access: 'admin', purpose: 'Hotel-Mode-Einstellungen.' },
  { id: 'hotelStay', methods: ['GET'], path: '/api/hotel-mode/stay', area: 'hotel', access: 'admin', purpose: 'Aktueller Aufenthalt.' },
  { id: 'hotelOverride', methods: ['POST'], path: '/api/hotel-mode/override', area: 'hotel', access: 'admin', purpose: 'Manueller Aufenthalt.' },
  { id: 'hotelPin', methods: ['POST'], path: '/api/hotel-mode/pin', area: 'hotel', access: 'admin', purpose: 'Admin-PIN setzen.' },
  { id: 'hotelUnlock', methods: ['POST'], path: '/api/hotel-mode/unlock', area: 'hotel', access: 'guest', purpose: 'Adminsitzung per PIN öffnen.' },
  { id: 'hotelLock', methods: ['POST'], path: '/api/hotel-mode/lock', area: 'hotel', access: 'guest', purpose: 'Adminsitzung schließen.' },

  /* ── Companion-App (Plan 21) ── */
  { id: 'pairingStart', methods: ['POST'], path: '/api/pairing/start', area: 'app', access: 'origin', purpose: 'Einmalcode für die Kopplung eines Telefons (nur im LAN).', response: 'PairingStartResponse' },
  { id: 'pairingClaim', methods: ['POST'], path: '/api/pairing/claim', area: 'app', access: 'public', purpose: 'Code einlösen, Gerätetoken erhalten (nur im LAN).', response: 'PairingClaimResponse' },
  { id: 'pairingDevices', methods: ['GET'], path: '/api/pairing/devices', area: 'app', access: 'origin', purpose: 'Gekoppelte Geräte.', response: 'PairingDevicesResponse' },
  { id: 'pairingDeviceRevoke', methods: ['DELETE'], path: '/api/pairing/devices/:deviceId', area: 'app', access: 'origin', purpose: 'Gerät widerrufen.' },
  { id: 'appBundle', methods: ['GET', 'HEAD'], path: '/api/app/bundle', area: 'app', access: 'origin', purpose: 'Dateiliste des Phone-Bundles mit Hashes (ETag).', response: 'AppFileListResponse' },
  { id: 'appManifest', methods: ['GET', 'HEAD'], path: '/api/app/manifest', area: 'app', access: 'origin', purpose: 'Phone-Varianten der Raumbilder mit Hashes (ETag).', response: 'AppFileListResponse' },
  { id: 'hotelTouch', methods: ['POST'], path: '/api/hotel-mode/touch', area: 'hotel', access: 'guest', purpose: 'Adminsitzung verlängern.' },

  /* ── Ablage (Paperless) ── */
  { id: 'ablageStatus', methods: ['GET'], path: '/api/ablage/status', area: 'ablage', access: 'origin', purpose: 'Konfigurations- und Freigabestatus.' },
  { id: 'ablageUnlock', methods: ['POST'], path: '/api/ablage/unlock', area: 'ablage', access: 'origin', purpose: 'PIN-Freigabe.' },
  { id: 'ablageLock', methods: ['POST'], path: '/api/ablage/lock', area: 'ablage', access: 'origin', purpose: 'Freigabe beenden.' },
  { id: 'ablageDocuments', methods: ['GET'], path: '/api/ablage/documents', area: 'ablage', access: 'session', purpose: 'Dokumentensuche.' },
  { id: 'ablageDocumentImport', methods: ['POST'], path: '/api/ablage/documents/import', area: 'ablage', access: 'session', purpose: 'Datei an Paperless übergeben.' },
  { id: 'ablageTasks', methods: ['GET'], path: '/api/ablage/tasks', area: 'ablage', access: 'session', purpose: 'Laufende Verarbeitungen.' },
  { id: 'ablageDocumentFile', methods: ['GET'], path: '/api/ablage/documents/:documentId/:kind', area: 'ablage', access: 'session', purpose: 'Thumbnail, Vorschau oder Download eines Dokuments.' },

  /* ── Songs (privater AceStep-Pfad) ── */
  { id: 'songsHealth', methods: ['GET'], path: '/api/songs/health', area: 'songs', access: 'origin', purpose: 'Erreichbarkeit des Songdienstes.' },
  { id: 'songsGenerate', methods: ['POST'], path: '/api/songs/generate', area: 'songs', access: 'origin', purpose: 'Song erzeugen.' },
  { id: 'songsStatus', methods: ['POST'], path: '/api/songs/status', area: 'songs', access: 'origin', purpose: 'Erzeugungsstatus.' },
  { id: 'songsAudio', methods: ['GET'], path: '/api/songs/audio', area: 'songs', access: 'origin', purpose: 'Audio des Dienstes durchreichen.' },
  { id: 'songsLibrary', methods: ['GET', 'POST'], path: '/api/songs/library', area: 'songs', access: 'origin', purpose: 'Lokale Songbibliothek.' },
  { id: 'songsLibraryItem', methods: ['PATCH', 'DELETE'], path: '/api/songs/library/:songId', area: 'songs', access: 'origin', purpose: 'Song umbenennen oder löschen.' },
  { id: 'songsLibraryAudio', methods: ['GET', 'HEAD'], path: '/api/songs/library/:songId/audio', area: 'songs', access: 'origin', purpose: 'Audio eines gespeicherten Songs.' },
];

/* `/api/...`-Literale im Serverquelltext, die keine Hauser-Routen sind, sondern
   Pfade fremder Dienste (Home Assistant Core, Paperless, Hermes), an die der
   Server weiterreicht. Der Drift-Test kennt sie, damit sie nicht als fehlende
   Vertragsrouten gelten. */
export const UPSTREAM_API_PATHS = [
  '/api/history/period',
  '/api/states',
  '/api/states/',
  '/api/calendars',
  '/api/calendars/',
  '/api/template',
  '/api/config/config_entries/flow',
  '/api/config/config_entries/flow/',
  '/api/config/automation/config/',
  '/api/documents/',
  '/api/documents/post_document/',
  '/api/tasks/',
  '/api/sessions',
  '/api/sessions/',
];

const PARAM_PATTERN = /:([A-Za-z]+)/g;

/** Kompiliert ein Pfadmuster zu einem RegExp; Parameter matchen ein Segment. */
export function routePattern(path) {
  const source = path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(PARAM_PATTERN, '([^/]+)');
  return new RegExp(`^${source}$`);
}

/** Findet die Vertragsroute zu einer Methode und einem Pfad (ohne Query). */
export function matchApiRoute(method, pathname) {
  for (const route of API_ROUTES) {
    if (!routePattern(route.path).test(pathname)) continue;
    if (method && !route.methods.includes(method)) continue;
    return route;
  }
  return null;
}

/** Prüft, ob ein Literal aus dem Quelltext von einer Vertragsroute abgedeckt ist.
    Präfixe (`/api/hotel-mode/`) gelten als abgedeckt, wenn eine Route darunter liegt. */
export function literalCoveredByContract(literal) {
  const clean = literal.replace(/\?.*$/, '');
  if (UPSTREAM_API_PATHS.includes(clean)) return true;
  for (const route of API_ROUTES) {
    if (route.path === clean) return true;
    if (routePattern(route.path).test(clean)) return true;
    const prefix = clean.endsWith('/') ? clean : `${clean}/`;
    if (route.path.startsWith(prefix)) return true;
  }
  return false;
}
