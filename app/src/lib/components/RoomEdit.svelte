<script lang="ts">
  /* Raum-Geräte-Editor (Long-Press auf Raum-Kachel, analog Licht-Detail):
     Modal mit der Geräteliste des Raums (Reihenfolge per Pfeile, Entfernen)
     und einer Suche, die Katalog-Vorschläge zum Hinzufügen einblendet — nie
     die komplette Entity-Liste. Reuse des overlay-scrim/modal-Musters. */
  import Icon from './Icon.svelte';
  import '../../styles/room-images.css';
  import { longpress } from '../actions/longpress.ts';
  import { dragreorder } from '../actions/dragreorder.ts';
  import { tilereorder } from '../actions/tilereorder.ts';
  import ClimateCard from './ClimateCard.svelte';
  import { mergedClimate } from '../state/commands.ts';
  import { resolvePhoneHero } from '../state/phone-home.ts';
  import { roomBlueprint } from './room-blueprint.ts';
  import { tick } from 'svelte';
  import { SHEET_SWIPE_IGNORE, swipedown } from '../actions/swipedown.ts';
  import { swipeleft } from '../actions/swipeleft.ts';
  import { appState } from '../state/app.svelte.ts';
  import { roomEdit, closeRoomEdit, finishRoomEditClose } from '../state/overlay.svelte.ts';
  import { openSceneEdit, scenes } from '../state/scene-manager.svelte.ts';
  import {
    addDeviceToRoom,
    deviceManager,
    hideDevice,
    setRoomDeviceOrder,
  } from '../state/device-manager.svelte.ts';
  import {
    categoryOf, CATEGORY_LABELS, type DeviceCategory, type EntityCatalogItem,
  } from '../state/device-config.ts';
  import { m } from '../../paraglide/messages.js';
  import { flip } from 'svelte/animate';
  import { popAway, prefersReducedMotion, tokenDuration } from '../motion/index.ts';
  import {
    removeLightPlacement,
    roomLightPlacements,
    setLightPlacement,
  } from '../state/immersion-light.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { removeRoomBackground, uploadRoomBackground } from '../state/room-background-client.ts';
  import RoomImageLibrary from './settings/RoomImageLibrary.svelte';
  import RoomImageWizard from './settings/RoomImageWizard.svelte';
  import {
    autoSensorId,
    cameraSplit,
    contactIdsFor,
    contactsAreAutomatic,
    otherSensorCandidates,
    roomContactOptions,
    roomSensorCandidates,
    sensorIdFor,
    sensorIsAutomatic,
    setCameraSplit,
    setContactIds,
    setSensorId,
    setShowsMetric,
    showsMetric,
  } from '../state/room-display-config.svelte.ts';
  import type { RoomContactKind } from '../state/commands.ts';
  import { ROOM_NAME_MAX, cleanRoomName, renameRoom } from '../state/room-rename.ts';
  import { cardsAroundTiles } from '../state/room-cards.ts';

  const room = $derived(appState.rooms.find((r) => r.id === roomEdit.roomId));

  let query = $state('');
  let searchEl = $state<HTMLInputElement>();
  /* Filterpillen: Wer ins Suchfeld tippt, weiß meist den Namen — wer nur
     hineinklickt, sucht einen Typ. Deshalb erscheinen die Pillen beim Klick
     ins Feld und verschwinden, sobald ein Buchstabe fällt. */
  let searchOpen = $state(false);
  let categoryFilter = $state<DeviceCategory | null>(null);
  let view = $state<'devices' | 'immersion' | 'background' | 'advanced'>('devices');
  let wizardOpen = $state(false);
  let selectedLightId = $state('');
  let backgroundInput = $state<HTMLInputElement>();
  let backgroundBusy = $state(false);
  let backgroundMessage = $state<string | null>(null);
  let backgroundError = $state(false);
  let libraryOpen = $state(false);
  let moveDeviceId = $state<string | null>(null);
  const roomLights = $derived((room?.lights ?? []).filter((device) => (device.category ?? 'light') === 'light'));
  const placements = $derived(roomLightPlacements(room?.id));
  const selectedPlacement = $derived(placements[selectedLightId]);
  const background = $derived(roomHeroConfig(room?.id));
  const backgroundUrl = $derived(background
    ? `/assets/room-images/${background.assetId}/light.avif`
    : `${import.meta.env.BASE_URL}hero/${room?.id}-light.avif`);
  /* Die Lampen werden auf dem unbeleuchteten Nachtbild platziert — dort sieht
     man, wo Licht fehlt. Es muss dasselbe Bildset sein wie auf der Bühne, sonst
     zeigt der Editor die Projektfassung und die gesetzten Punkte passen nicht
     zum eigenen Bild. */
  const immersionUrl = $derived(background
    ? `/assets/room-images/${background.assetId}/dark-off.avif`
    : `${import.meta.env.BASE_URL}hero/${room?.id}-dark-off.avif`);

  // Vorschläge erst ab Eingabe: bestes Präfix-Match zuerst, dann Name-Substring,
  // dann entity_id/Domain. Geräte, die schon im Raum liegen, tauchen nicht auf.
  const addable = $derived.by(() => {
    if (!room) return [];
    const inRoom = new Set(room.lights.map((l) => l.entityId));
    return deviceManager.catalog.filter((item) => !inRoom.has(item.entityId));
  });

  /* Nur Typen, die es hier auch zu holen gibt — eine Pille „Mäher" ohne Mäher
     wäre ein leeres Versprechen. Die Reihenfolge kommt aus CATEGORY_LABELS,
     damit Licht vorn steht und die Leiste nicht bei jedem Öffnen springt. */
  const categoryPills = $derived.by(() => {
    const counts = new Map<DeviceCategory, number>();
    for (const item of addable) {
      const category = categoryOf(item.domain);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return (Object.keys(CATEGORY_LABELS) as DeviceCategory[])
      .filter((category) => counts.has(category))
      .map((category) => ({ category, count: counts.get(category)! }));
  });

  /* Ein Griff auf „Sensor" kann dreihundert Zeilen bedeuten — so viele Kacheln
     auf einen Schlag ruckeln am Wandpanel. Die Liste bleibt deshalb kurz und
     sagt, wie viel noch dahinter liegt; wer mehr will, tippt. */
  const FILTER_LIMIT = 30;
  const filtered = $derived(categoryFilter
    ? addable
      .filter((item) => categoryOf(item.domain) === categoryFilter)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    : []);
  const hiddenByLimit = $derived(query.trim() ? 0 : Math.max(0, filtered.length - FILTER_LIMIT));

  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filtered.slice(0, FILTER_LIMIT);
    return addable
      .map((item) => ({ item, rank: matchRank(item, q) }))
      .filter((s) => s.rank > 0)
      .sort((a, b) => b.rank - a.rank || a.item.name.localeCompare(b.item.name, 'de'))
      .slice(0, 6)
      .map((s) => s.item);
  });

  // Anzeigename eines Sensors aus dem Katalog; unbekannt → die entity_id.
  function sensorName(entityId: string): string {
    return deviceManager.catalog.find((item) => item.entityId === entityId)?.name ?? entityId;
  }

  /* Kontakt an-/abwählen. Die erste Abweichung von der HA-Zuordnung friert die
     aktuelle Auswahl ein — ab dann zählt nur noch die eigene Liste. */
  function toggleContact(roomId: string, kind: RoomContactKind, entityId: string): void {
    const current = new Set(contactIdsFor(roomId, kind));
    if (current.has(entityId)) current.delete(entityId);
    else current.add(entityId);
    setContactIds(roomId, kind, [...current]);
  }

  function matchRank(item: EntityCatalogItem, q: string): number {
    const name = item.name.toLowerCase();
    if (name.startsWith(q)) return 3;
    if (name.includes(q)) return 2;
    if (item.entityId.toLowerCase().includes(q) || item.domain.includes(q)) return 1;
    return 0;
  }

  // Herkunfts-Hinweis im Vorschlag: liegt das Gerät gerade in einem anderen Raum?
  function locatedIn(entityId: string): string | null {
    return appState.rooms.find((r) => r.lights.some((l) => l.entityId === entityId))?.name ?? null;
  }

  /* Ein hinzugefügtes Gerät feiert kurz (wie die iOS-App): das Plus springt
     zum goldenen Haken, sechs Funken fliegen auf, dann zieht es in den Raum. */
  const CELEBRATE_MS = 420;
  let celebrating = $state<string | null>(null);
  function add(item: EntityCatalogItem) {
    if (!room || celebrating) return;
    if (prefersReducedMotion()) { commitAdd(item); return; }
    celebrating = item.entityId;
    setTimeout(() => { celebrating = null; commitAdd(item); }, CELEBRATE_MS);
  }
  function commitAdd(item: EntityCatalogItem) {
    if (!room) return;
    addDeviceToRoom(item.entityId, room.id, room.lights.map((l) => l.entityId));
    query = '';
    searchEl?.focus();
  }

  /* Reihenfolge der Raumgeräte: Konfig-Overlay-Standard (actions/dragreorder) —
     derselbe Neun-Punkte-Griff wie in der Raumliste und im Szenen-Editor. */
  let dragEntityId = $state<string | null>(null);
  let dragOffset = $state(0);
  let orderListEl = $state<HTMLElement>();

  /* Die gezogene Zeile hängt am Finger (Versatz aus der Action), die anderen
     gleiten per FLIP auf ihren neuen Platz. Die gezogene selbst bekommt keine
     FLIP-Dauer — sonst zöge die Animation gegen den Finger. */
  const flipMs = $derived(prefersReducedMotion() ? 0 : tokenDuration(orderListEl ?? null, 'normal'));
  /* Beim Entfernen rücken die Nachbarn erst nach, wenn die Zeile sichtbar
     weggeflogen ist — sonst gleiten sie durch sie hindurch. Beim Ziehen
     darf nichts nachhängen, dort bleibt die Verzögerung null. */
  const REMOVE_LEAD_MS = 90;
  let removing = $state(false);
  function rowFlip(id: string) {
    return { duration: id === dragEntityId ? 0 : flipMs, delay: removing ? REMOVE_LEAD_MS : 0 };
  }
  /* Die abgehende Zeile verlässt den Fluss (siehe popAway) und weiß dann
     nicht mehr, wo sie stand — die Stelle wird beim Klick gemessen. */
  let removedFrom = $state<{ top: number; left: number } | null>(null);
  function removeDevice(entityId: string, trigger: HTMLElement) {
    const row = trigger.closest<HTMLElement>('[data-reorder-row], [data-reorder-tile]');
    removedFrom = row ? { top: row.offsetTop, left: row.offsetLeft } : null;
    removing = true;
    hideDevice(entityId);
    setTimeout(() => { removing = false; }, REMOVE_LEAD_MS + flipMs + 100);
  }

  function moveDevice(entityId: string, targetIndex: number) {
    if (!room) return;
    const ids = room.lights.map((l) => l.entityId);
    const from = ids.indexOf(entityId);
    const to = Math.max(0, Math.min(ids.length - 1, targetIndex));
    if (from < 0 || from === to) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setRoomDeviceOrder(room.id, ids);
  }

  // Jedes Öffnen startet frisch — in der Ansicht, mit der es aufgerufen wurde.
  $effect(() => {
    const opening = roomEdit.mode === 'open';
    const requestedView = roomEdit.view;
    void roomEdit.roomId;
    if (!opening) return;
    query = '';
    searchOpen = false;
    categoryFilter = null;
    adding = false;
    releaseSearchLift();
    view = requestedView;
    selectedLightId = '';
    backgroundMessage = null;
    backgroundError = false;
  });

  /* Szenen-Editor ist ein eigenes Overlay (gleicher Modal-Tier): das Raum-
     Overlay geht dafür zu, sonst stapelten zwei Scrims übereinander. */
  function openScenes() {
    if (!room) return;
    const roomId = room.id;
    closeRoomEdit(true);
    // Ohne Szenen öffnet der Editor leer und bietet direkt „Neue Szene“ an.
    openSceneEdit(roomId, scenes(roomId)[0]?.id ?? 'gemuetlich');
  }

  function openImmersionEditor() {
    view = 'immersion';
    selectedLightId = roomLights[0]?.entityId ?? '';
  }

  function openBackgroundEditor() {
    view = 'background';
    selectedLightId = '';
    backgroundMessage = null;
    backgroundError = false;
  }

  async function chooseBackground(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!room || !file || backgroundBusy) return;
    backgroundBusy = true;
    backgroundMessage = null;
    backgroundError = false;
    try {
      await uploadRoomBackground(room.id, file);
      backgroundMessage = m.room_background_saved();
    } catch (error) {
      backgroundError = true;
      backgroundMessage = error instanceof Error ? error.message : m.room_background_failed();
    } finally {
      backgroundBusy = false;
    }
  }

  async function restoreBackground() {
    if (!room || !background || backgroundBusy) return;
    backgroundBusy = true;
    backgroundMessage = null;
    backgroundError = false;
    try {
      await removeRoomBackground(room.id);
      backgroundMessage = m.room_background_restored();
    } catch (error) {
      backgroundError = true;
      backgroundMessage = error instanceof Error ? error.message : m.room_background_failed();
    } finally {
      backgroundBusy = false;
    }
  }

  /* Longpress auf eine Geraetezeile verschiebt das Geraet in einen anderen Raum.
     addDeviceToRoom haengt es ans Ende der Zielraum-Reihenfolge. */
  function moveDeviceToRoom(targetRoomId: string) {
    const entityId = moveDeviceId;
    moveDeviceId = null;
    if (!entityId) return;
    const targetOrder = appState.rooms.find((entry) => entry.id === targetRoomId)?.lights.map((light) => light.entityId) ?? [];
    addDeviceToRoom(entityId, targetRoomId, targetOrder);
  }

  function placeSelected(event: MouseEvent) {
    if (!room || !selectedLightId) return;
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    if (!rect) return;
    setLightPlacement(room.id, selectedLightId, {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      radius: selectedPlacement?.radius ?? 0.16,
    });
  }

  function setSelectedRadius(event: Event) {
    if (!room || !selectedLightId || !selectedPlacement) return;
    const radius = Number((event.currentTarget as HTMLInputElement).value);
    setLightPlacement(room.id, selectedLightId, { ...selectedPlacement, radius });
  }

  // animationend-Fallback (deckt prefers-reduced-motion: 0ms ab)
  $effect(() => {
    if (roomEdit.mode !== 'closing') return;
    const t = setTimeout(finishRoomEditClose, 250);
    return () => clearTimeout(t);
  });

  // Initial-Fokus beim Öffnen (A11y): einmal auf das Panel.
  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (roomEdit.mode === 'open' && panelEl) panelEl.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && roomEdit.mode === 'open') closeRoomEdit();
  }

  /* Die Wischgeste gehört dem Telefon: am Wandpanel steht dasselbe Overlay
     mittig im Bild, dort wäre ein Zug nach unten sinnlos. */
  let onPhone = $state(false);
  $effect(() => {
    onPhone = typeof document !== 'undefined'
      && document.querySelector('[data-shell="phone"]') !== null;
  });

  /* ── Gespiegelte Ansicht (Telefon) ──
     Die Geräte-Ansicht steht am Telefon wie das Raumblatt: derselbe Kopf,
     dieselbe Szenen-Leiste, dasselbe Kachelraster, darunter Kamera und Klima —
     jedes Gerät bleibt beim Überblenden an seinem Platz. Halten und Ziehen
     ordnet die Kacheln, das Minus an der Ecke nimmt heraus, die Plus-Kachel
     hinter dem letzten Gerät öffnet die Suche; der Schnelleinstieg folgt
     darunter. Dieselben Klassen wie im Raumblatt tragen das Aussehen. */
  const mirrored = $derived(onPhone && view === 'devices');
  /* Eine Kachel in der Hand gehört dem Ordnen — dort greifen weder Raumwechsel noch Schließen. */
  const MIRROR_SWIPE_IGNORE = `${SHEET_SWIPE_IGNORE}, [data-reorder-tile]`;
  /* Wie das Raumblatt: die Demo hat Kameras ohne Bild und zeigt sie deshalb nicht. */
  const IS_DEMO_BUILD = import.meta.env?.VITE_DEMO === '1';
  let adding = $state(false);
  const tileDevices = $derived((room?.lights ?? []).filter((device) => device.category !== 'camera'));
  const cameraDevices = $derived(IS_DEMO_BUILD ? [] : (room?.lights ?? []).filter((device) => device.category === 'camera'));

  /* Raum umbenennen (wie die iOS-App): ein Tipp auf den Stift am Namen, Enter
     oder Verlassen speichert, Escape verwirft. */
  let renaming = $state(false);
  let renameDraft = $state('');
  let renameFailed = $state(false);
  function startRename(): void {
    if (!room) return;
    renameDraft = room.name;
    renameFailed = false;
    renaming = true;
  }
  async function finishRename(save: boolean): Promise<void> {
    if (!renaming || !room) return;
    renaming = false;
    const next = cleanRoomName(renameDraft);
    if (!save || !next || next === room.name) return;
    renameFailed = !(await renameRoom(room.id, next));
  }
  function renameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') { event.preventDefault(); void finishRename(true); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void finishRename(false); }
  }
  function focusSelect(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }
  const roomScenes = $derived(room ? scenes(room.id) : []);
  const roomClimate = $derived(room ? mergedClimate(room.id) : null);
  let tileGridEl = $state<HTMLElement>();
  let tileDragId = $state<string | null>(null);
  let tileOffset = $state({ x: 0, y: 0 });

  function tileFlip(id: string) {
    return { duration: id === tileDragId ? 0 : flipMs, delay: removing ? REMOVE_LEAD_MS : 0 };
  }
  /* Die Kacheln sind eine Teilfolge der Raumgeräte (ohne Kameras): das Ziel
     ist der Platz, den die dortige Kachel in der Gesamtreihenfolge hat. */
  /* Kamerakarten vor oder hinter den Kacheln (wie die iOS-App): der Platz
     folgt der Gerätereihenfolge — vor die erste Kachel oder ans Ende. */
  const cameraPlaces = $derived(cardsAroundTiles(room?.lights ?? [], cameraDevices, tileDevices));
  function placeCard(entityId: string, before: boolean) {
    if (!room) return;
    const firstTile = room.lights.findIndex((device) => device.entityId === tileDevices[0]?.entityId);
    const from = room.lights.findIndex((device) => device.entityId === entityId);
    if (from < 0 || firstTile < 0) return;
    moveDevice(entityId, before ? (from < firstTile ? firstTile - 1 : firstTile) : room.lights.length - 1);
  }
  function moveTile(entityId: string, targetTileIndex: number) {
    const target = tileDevices[targetTileIndex];
    if (!room || !target) return;
    moveDevice(entityId, room.lights.findIndex((device) => device.entityId === target.entityId));
  }
  function openSceneFromRow(sceneId: string) {
    if (!room) return;
    const roomId = room.id;
    closeRoomEdit(true);
    openSceneEdit(roomId, sceneId);
  }
  async function startAdding() {
    adding = true;
    await tick();
    searchEl?.focus();
  }
  function stopAdding() {
    adding = false;
    query = '';
    categoryFilter = null;
    searchOpen = false;
    releaseSearchLift();
  }

  /* Der Grund ist die Blaupause des Raums — aus dem Tagbild gerechnet, mit
     demselben Bildausschnitt wie das Raumblatt, damit sie deckungsgleich
     darüber liegt. */
  let blueprint = $state<{ url: string; position: string } | null>(null);
  let blueprintKey = '';
  $effect(() => {
    if (!onPhone || roomEdit.mode === 'hidden' || !room) return;
    const roomId = room.id;
    const config = roomHeroConfig(roomId);
    const key = [roomId, JSON.stringify(config)].join('|');
    if (key === blueprintKey) return;
    blueprintKey = key;
    blueprint = null;
    void (async () => {
      const [resolution, { loadRoomHero }] = await Promise.all([
        resolvePhoneHero(import.meta.env.BASE_URL, roomId, 'light', config),
        import('./room-hero-assets.ts'),
      ]);
      const candidate = await loadRoomHero(resolution, undefined, () => blueprintKey === key);
      if (!candidate || blueprintKey !== key) return;
      const url = await roomBlueprint(candidate.url);
      if (url && blueprintKey === key) blueprint = { url, position: candidate.position };
    })().catch(() => {});
  });

  /* Wisch nach links oder rechts wechselt den Raum (Owner-Wunsch 2026-09-12),
     mit derselben Toleranz wie im Raumblatt; der Inhalt klebt am Finger, der
     nächste Raum gleitet von der Wischseite herein und beginnt bei seinen
     Geräten. Im Lampen-Editor bleibt der Finger dem Bild vorbehalten. */
  let dragLeft = $state(0);
  let dragRight = $state(0);
  let dragging = $state(false);
  const dragX = $derived(dragLeft + dragRight);
  let slideFrom = 0;
  const roomSwipeEnabled = $derived(onPhone && view !== 'immersion');
  function endRoomDrag(): void { dragLeft = 0; dragRight = 0; dragging = false; }
  function switchRoom(delta: 1 | -1): void {
    const ids = appState.rooms.map((entry) => entry.id);
    const index = ids.indexOf(roomEdit.roomId);
    if (index < 0 || ids.length < 2) return;
    slideFrom = delta;
    view = 'devices';
    selectedLightId = '';
    query = '';
    categoryFilter = null;
    releaseSearchLift();
    if (panelEl) panelEl.scrollTop = 0;
    roomEdit.roomId = ids[(index + delta + ids.length) % ids.length];
  }
  function roomEnter(node: HTMLElement) {
    const from = slideFrom * 40;
    slideFrom = 0;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      duration: reduced || from === 0 ? 0 : 180,
      css: (t: number) => `opacity:${t};transform:translateX(${(1 - t) * from}px)`,
    };
  }

  /* Suchen heißt tippen, und die Tastatur nimmt die untere Hälfte des Bildes.
     Beim Fokus rückt das Suchfeld deshalb an den oberen Rand des Panels —
     darunter bleibt genug Platz für die Vorschläge. Fehlt dem Panel dafür
     Auslauf (die Liste ist noch leer), bekommt es ihn vorübergehend. */
  /* Während der Suche ist „oben" nicht mehr null, sondern die Stelle, an die
     das Suchfeld gehoben wurde: von dort führt ein Wisch nach unten wieder
     hinaus, ohne dass man erst zurückscrollen muss. Was hinzugefügt wurde,
     steht ohnehin schon im Raum — Schließen übernimmt, nichts geht verloren. */
  let searchAnchor = $state(0);

  function liftSearchField(): void {
    const panel = panelEl;
    const field = searchEl;
    if (!panel || !field) return;
    const distance = field.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    if (distance <= 1) return;
    /* Der bereits geliehene Auslauf wird herausgerechnet statt zurückgegeben:
       ein Zurückgeben mitten in der weichen Fahrt ließe die Liste springen.
       Gemessen wird gegen den echten Inhalt, der Auslauf ersetzt sich. */
    const loaned = Number.parseFloat(panel.style.paddingBottom) || 0;
    const rest = panel.scrollHeight - loaned - panel.scrollTop - panel.clientHeight;
    panel.style.paddingBottom = distance > rest ? `${distance - rest}px` : '';
    const top = panel.scrollTop + distance;
    /* Weich statt hart (Owner-Befund 2026-09-12): das Feld fährt nach oben. */
    panel.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    searchAnchor = top;
  }

  /* Der geliehene Auslauf geht erst zurück, wenn die Suche wirklich vorbei
     ist — nicht beim Blur: am Wandpanel bekommt eine getippte Filterpille
     keinen Fokus, `relatedTarget` ist dann leer, und das Zurückgeben verschob
     den Abschnitt zwischen Drücken und Loslassen; der erste Tipp ging ins
     Leere und die Ansicht sprang zurück (Owner-Befund 2026-09-12). */
  function releaseSearchLift(): void {
    if (panelEl) panelEl.style.paddingBottom = '';
    searchAnchor = 0;
  }

  function onSearchFocus(): void {
    searchOpen = true;
    liftSearchField();
    // Zweiter Anlauf, wenn die eingeblendete Tastatur den sichtbaren Bereich
    // verkleinert hat — vorher stimmt die gerechnete Strecke noch nicht.
    setTimeout(liftSearchField, 300);
  }

  /* Tippen schlägt Filtern: die Pillen weichen der Eingabe und geben ihre
     Auswahl mit ab, sonst suchte man unsichtbar eingeschränkt weiter. */
  function onSearchInput(): void {
    if (query.trim()) categoryFilter = null;
  }

  function toggleCategory(category: DeviceCategory): void {
    categoryFilter = categoryFilter === category ? null : category;
  }

  /* Am Wandpanel (Fully Kiosk, Android-WebView) nimmt die Tastatur die
     untere Hälfte und verkleinert dabei das Layout. Ein Tipp auf eine Pille
     oder einen Vorschlag nahm dem Suchfeld den Fokus, die Tastatur klappte
     zu, die Fläche wuchs, und die Liste rutschte nach unten — der Tipp ging
     dabei ins Leere (Owner-Befund 2026-09-12, zweiter Anlauf). Der Fokus
     bleibt deshalb im Feld: kein Fokuswechsel beim Drücken, der Klick kommt
     trotzdem an. */
  function keepSearchFocus(event: PointerEvent): void {
    if (document.activeElement === searchEl) event.preventDefault();
  }

  /* Klappt die Tastatur trotzdem zu (Zurück-Taste), während das Feld den
     Fokus hat, wächst die Fläche und das Feld sackt ab — dann fährt es
     wieder hoch. */
  function onViewportResize(): void {
    if (searchOpen && document.activeElement === searchEl) liftSearchField();
  }

  /* Der geliehene Auslauf darf erst zurück, wenn die Suche wirklich verlassen
     wird. Wandert der Fokus nur auf eine Filterpille oder einen Vorschlag,
     bliebe der Griff sonst ins Leere: das Zurückgeben verschiebt den Abschnitt
     noch zwischen Drücken und Loslassen, und der Klick landet daneben. */
  function onSearchBlur(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof HTMLElement && next.closest('.re-add-section')) return;
    /* Ohne Ziel (Tipp am Panel) bleibt der Auslauf stehen; nur ein Fokus
       außerhalb des Abschnitts — Tastatur, anderes Feld — beendet die Suche. */
    if (!(next instanceof HTMLElement)) return;
    releaseSearchLift();
  }
</script>

<svelte:window onkeydown={onKeydown} onresize={onViewportResize} />

<div class="room-edit" class:is-open={roomEdit.mode === 'open'} class:is-phone={onPhone}
     class:is-from-sheet={roomEdit.origin === 'sheet'}
     class:is-closing={roomEdit.mode === 'closing'} hidden={roomEdit.mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={() => closeRoomEdit()}></div>
  <div class="room-edit-panel overlay-panel on-image" class:is-immersion={view === 'immersion'} class:is-background={view === 'background'}
       class:is-blueprint={onPhone} class:has-blueprint={blueprint !== null}
       style:--re-blueprint={blueprint ? `url("${blueprint.url}")` : undefined}
       style:--re-blueprint-focus={blueprint?.position}
       role="dialog" aria-modal="true"
       aria-label={m.room_edit_devices_label({ room: room?.name ?? '' })} tabindex="-1" bind:this={panelEl}
       use:swipedown={{ onSwipe: () => closeRoomEdit(), surface: () => panelEl,
                        atTop: (t) => Boolean(t?.closest('.ld-header'))
                                      || (panelEl?.scrollTop ?? 0) <= searchAnchor,
                        ignore: MIRROR_SWIPE_IGNORE, enabled: onPhone }}
       use:swipeleft={{ onSwipe: () => switchRoom(1), move: false, threshold: 48, angle: 60,
                        enabled: roomSwipeEnabled, ignore: MIRROR_SWIPE_IGNORE,
                        onDrag: (travel) => { dragging = true; dragLeft = travel; },
                        onDragEnd: endRoomDrag }}
       use:swipeleft={{ onSwipe: () => switchRoom(-1), move: false, threshold: 48, angle: 60, direction: 'right',
                        enabled: roomSwipeEnabled, ignore: MIRROR_SWIPE_IGNORE,
                        onDrag: (travel) => { dragging = true; dragRight = travel; },
                        onDragEnd: endRoomDrag }}
       onanimationend={(e) => { if (roomEdit.mode === 'closing' && e.target === e.currentTarget) finishRoomEditClose(); }}>
    {#if room}
      {#key room.id}
        <div class="re-room" class:is-following={dragging} in:roomEnter
             style:transform={dragX === 0 ? undefined : `translateX(${dragX * 0.5}px)`}>
        {#if mirrored && !adding}
        <!-- Derselbe Kopf wie im Raumblatt: der Name bleibt stehen, aus den drei Punkten wird das Kreuz. -->
        <div class="room-sheet-head re-mirror-head">
          {#if renaming}
            <input class="room-sheet-title re-rename-input" type="text" maxlength={ROOM_NAME_MAX} aria-label={m.room_rename()}
                   bind:value={renameDraft} use:focusSelect onkeydown={renameKeydown} onblur={() => void finishRename(true)} />
          {:else}
            <button class="re-rename pressable" type="button" aria-label={m.room_rename()} onclick={startRename}>
              <h2 class="room-sheet-title">{room.name}</h2>
              <Icon name="i-pencil" cls="icon icon-sm" />
            </button>
          {/if}
          <button class="room-sheet-more pressable" type="button" aria-label={m.common_close()} onclick={() => closeRoomEdit()}>
            <Icon name="i-close" cls="icon icon-md" />
          </button>
        </div>
        {:else}
        <header class="ld-header">
          {#if view !== 'devices'}
            <button class="re-btn pressable" type="button" aria-label={m.room_back_to_devices()}
                    onclick={() => { view = 'devices'; selectedLightId = ''; }}>
              <Icon name="i-chevron-left" cls="icon icon-md" />
            </button>
          {:else if adding}
            <!-- Aus „Gerät hinzufügen" führt der Pfeil zurück in die Konfiguration; das Kreuz schließt sie ganz. -->
            <button class="re-btn pressable" type="button" aria-label={m.room_back_to_devices()} onclick={stopAdding}>
              <Icon name="i-chevron-left" cls="icon icon-md" />
            </button>
          {/if}
          <h2 class="ld-title">
            {#if renaming}
              <input class="re-rename-input" type="text" maxlength={ROOM_NAME_MAX} aria-label={m.room_rename()}
                     bind:value={renameDraft} use:focusSelect onkeydown={renameKeydown} onblur={() => void finishRename(true)} />
            {:else}
              <button class="re-rename pressable" type="button" aria-label={m.room_rename()} onclick={startRename}>{room.name}<Icon name="i-pencil" cls="icon icon-sm" /></button>
            {/if}
            <span class="re-subtitle">{view === 'immersion' ? m.room_immersion_light() : view === 'background' ? m.room_background() : view === 'advanced' ? m.room_advanced() : m.room_devices()}</span></h2>
          <button class="ld-close pressable" type="button" aria-label={m.common_close()}
                  onclick={() => closeRoomEdit()}>×</button>
        </header>
        {/if}
        {#if renameFailed}<p class="re-empty re-rename-failed" role="alert">{m.room_rename_failed()}</p>{/if}

        <div class="ld-body">
          {#snippet quickSection()}
          <!-- Schnelleinstieg: die vier Einstiege als 2×2-Raster, damit die
               Geräteliste darunter ohne Scrollen sichtbar bleibt. -->
          <section class="ld-section">
            <span class="caps-label">{m.room_quick_setup()}</span>
            {#if cameraDevices.length > 1}
              {@const together = cameraSplit(room.id)}
              <!-- Mehrere Kameras: zusammen im geteilten Bild oder jede einzeln
                   (wie die iOS-App, derselbe Schalter). -->
              <div class="re-row re-metric-head">
                <span class="re-icon" aria-hidden="true"><Icon name="i-view-grid" /></span>
                <span class="re-label">
                  <span class="re-name">{m.room_camera_split()}</span>
                  <small class="re-meta">{together ? m.room_camera_split_on({ count: String(cameraDevices.length) }) : m.room_camera_split_off()}</small>
                </span>
                <button class="re-toggle pressable" type="button" role="switch" aria-checked={together}
                        class:is-on={together} aria-label={m.room_camera_split()}
                        onclick={() => setCameraSplit(room.id, !together)}>
                  <span class="re-toggle-knob"></span>
                </button>
              </div>
            {/if}
            <div class="re-quick-grid">
              <button class="re-quick-entry pressable" type="button" onclick={openBackgroundEditor}>
                <span class="re-icon" aria-hidden="true"><Icon name="i-image" /></span>
                <span class="re-label">
                  <span class="re-name">{m.room_background()}</span>
                  <small class="re-meta">{background ? m.room_background_custom() : m.room_background_default()}</small>
                </span>
                <Icon name="i-chevron-right" cls="icon icon-md" />
              </button>
              <button class="re-quick-entry pressable" type="button" onclick={openScenes}>
                <span class="re-icon" aria-hidden="true"><Icon name="i-palette" /></span>
                <span class="re-label">
                  <span class="re-name">{m.room_edit_scenes()}</span>
                  <small class="re-meta">{m.room_edit_scenes_hint()}</small>
                </span>
                <Icon name="i-chevron-right" cls="icon icon-md" />
              </button>
              <button class="re-quick-entry pressable" type="button" onclick={openImmersionEditor}>
                <span class="re-icon" aria-hidden="true"><Icon name="i-bulb" /></span>
                <span class="re-label">
                  <span class="re-name">{m.room_assign_lamps()}</span>
                  <small class="re-meta">{m.room_set_light_positions()}</small>
                </span>
                <Icon name="i-chevron-right" cls="icon icon-md" />
              </button>
              <button class="re-quick-entry pressable" type="button" onclick={() => view = 'advanced'}>
                <span class="re-icon" aria-hidden="true"><Icon name="i-tune" /></span>
                <span class="re-label">
                  <span class="re-name">{m.room_advanced()}</span>
                  <small class="re-meta">{m.room_advanced_hint()}</small>
                </span>
                <Icon name="i-chevron-right" cls="icon icon-md" />
              </button>
            </div>
          </section>
          {/snippet}
          {#if view === 'devices'}
          {#if mirrored && !adding}
          <!-- Gespiegelte Ansicht: Aufbau und Klassen des Raumblatts, damit jede
               Kachel genau dort steht, wo man sie bedient. -->
          <div class="room-sheet on-image re-mirror">
            <div class="room-controls">
              {#if roomScenes.length > 0}
                <section class="detail-section">
                  <div class="scene-row">
                    {#each roomScenes as s (s.id)}
                      <!-- Die Leiste bleibt an ihrem Platz, schaltet hier aber nichts: ein Tipp öffnet die Szene. -->
                      <button class="scene-btn re-mirror-scene pressable" type="button" onclick={() => openSceneFromRow(s.id)}>
                        <Icon name="i-pencil" cls="icon icon-sm" />{s.label}
                      </button>
                    {/each}
                  </div>
                </section>
              {/if}

              {#snippet mirrorCameras(list: typeof cameraDevices, before: boolean)}
                {#each list as camera (camera.entityId)}
                  <!-- Die Kamera hält ihren Platz als ruhende Karte im Maß der Steuerung;
                       der Pfeil legt sie vor oder hinter die Kacheln (wie die iOS-App). -->
                  <section class="detail-section re-mirror-card" out:popAway={{ from: removedFrom }} data-reorder-row={camera.entityId}>
                    <figure class="camera-feed" inert>
                      <figcaption class="camera-feed-caption"><span>{camera.name}</span></figcaption>
                      <div class="camera-feed-frame"><Icon name={camera.icon ?? 'i-camera'} cls="icon icon-lg" /></div>
                    </figure>
                    <button class="re-mirror-remove pressable" type="button"
                            aria-label="{camera.name} aus {room.name} entfernen"
                            onclick={(event) => removeDevice(camera.entityId, event.currentTarget)}>
                      <span class="re-mirror-badge"><Icon name="i-minus" cls="icon icon-sm" /></span>
                    </button>
                    {#if tileDevices.length > 0}
                      <button class="re-mirror-move pressable" type="button"
                              aria-label={before ? m.room_card_after() : m.room_card_before()}
                              onclick={() => placeCard(camera.entityId, !before)}>
                        <span class="re-mirror-badge"><Icon name={before ? 'i-arrow-down' : 'i-arrow-up'} cls="icon icon-sm" /></span>
                      </button>
                    {/if}
                  </section>
                {/each}
              {/snippet}

              {@render mirrorCameras(cameraPlaces.before, true)}

              <section class="detail-section">
                <div class="light-list" bind:this={tileGridEl}>
                  {#each tileDevices as device (device.entityId)}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex
                         — der Platz ist selbst der Griff und nimmt Pfeiltasten zum Ordnen an (actions/tilereorder) -->
                    <div class="re-mirror-slot" class:is-held={tileDragId === device.entityId}
                         data-reorder-tile={device.entityId} role="group" tabindex="0"
                         aria-label={m.scene_reorder({ name: device.name })}
                         style:transform={tileDragId === device.entityId
                           ? `translate3d(${tileOffset.x}px, ${tileOffset.y}px, 0) scale(1.04)` : undefined}
                         animate:flip={tileFlip(device.entityId)}
                         out:popAway={{ from: removedFrom }}
                         use:tilereorder={{
                           id: device.entityId,
                           grid: () => tileGridEl,
                           enabled: tileDevices.length > 1,
                           onReorder: moveTile,
                           onDragChange: (dragging) => { tileDragId = dragging ? device.entityId : null; },
                           onDragOffset: (offset) => { tileOffset = offset; },
                         }}>
                      <div class="light-tile re-mirror-tile">
                        <span class="light-tile-icon" aria-hidden="true"><Icon name={device.icon ?? 'i-bulb'} /></span>
                        <span class="light-tile-label">
                          <span class="light-tile-name">{device.name}</span>
                        </span>
                      </div>
                      <button class="re-mirror-remove pressable" type="button"
                              aria-label="{device.name} aus {room.name} entfernen"
                              onclick={(event) => removeDevice(device.entityId, event.currentTarget)}>
                        <span class="re-mirror-badge"><Icon name="i-minus" cls="icon icon-sm" /></span>
                      </button>
                    </div>
                  {/each}
                  <!-- Hinter dem letzten Gerät: die Plus-Kachel öffnet die Suche mit ihren Filtern. -->
                  <button class="light-tile is-placeholder re-mirror-add pressable" type="button" onclick={startAdding}>
                    <span class="light-tile-icon" aria-hidden="true"><Icon name="i-plus" /></span>
                    <span class="light-tile-label">
                      <span class="light-tile-name">{m.room_add_device()}</span>
                    </span>
                  </button>
                </div>
              </section>

              {@render mirrorCameras(cameraPlaces.after, false)}

              {#if roomClimate}
                <section class="detail-section climate-section re-mirror-card" inert>
                  <ClimateCard {room} stacked />
                </section>
              {/if}
            </div>
          </div>
          {@render quickSection()}
          {:else}
          {#if !mirrored}
          {@render quickSection()}
          <section class="ld-section">
            <span class="caps-label">{m.room_order_label()} · {room.lights.length}</span>
            {#if room.lights.length === 0}
              <p class="re-empty">{m.room_no_devices()}</p>
            {:else}
              <ul class="re-list" bind:this={orderListEl}>
                {#each room.lights as device (device.entityId)}
                  <li class="re-row" class:is-dragging={dragEntityId === device.entityId}
                      data-reorder-row={device.entityId}
                      style:transform={dragEntityId === device.entityId && dragOffset !== 0
                        ? `translate3d(0, ${dragOffset}px, 0)` : undefined}
                      animate:flip={rowFlip(device.entityId)}
                      out:popAway={{ from: removedFrom }}
                      use:longpress={{ onLongPress: () => moveDeviceId = device.entityId }}>
                    <span class="re-icon" aria-hidden="true"><Icon name={device.icon ?? 'i-bulb'} /></span>
                    <span class="re-label">
                      <span class="re-name">{device.name}</span>
                      <small class="re-meta">{device.entityId}</small>
                    </span>
                    <span class="re-actions">
                      <button class="cfg-handle" type="button"
                              aria-label={m.scene_reorder({ name: device.name })}
                              disabled={room.lights.length < 2}
                              use:dragreorder={{
                                id: device.entityId,
                                list: () => orderListEl,
                                enabled: room.lights.length > 1,
                                onReorder: moveDevice,
                                onDragChange: (dragging) => { dragEntityId = dragging ? device.entityId : null; },
                                onDragOffset: (offset) => { dragOffset = offset; },
                              }}>
                        <Icon name="i-dots-grid" cls="icon icon-md" />
                      </button>
                      <button class="re-btn re-remove pressable" type="button"
                              aria-label="{device.name} aus {room.name} entfernen"
                              onclick={(event) => removeDevice(device.entityId, event.currentTarget)}>
                        <Icon name="i-minus" cls="icon icon-md" />
                      </button>
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          {/if}
          <section class="ld-section re-add-section">
            <span class="caps-label">{m.room_add_device()}</span>
            <input class="re-search" type="search" bind:value={query} bind:this={searchEl}
                   placeholder={m.room_search_placeholder()}
                   onfocus={onSearchFocus} onblur={onSearchBlur} oninput={onSearchInput}
                   aria-label={m.room_search_device()} autocomplete="off" spellcheck="false" />
            {#if searchOpen && !query.trim() && categoryPills.length > 0}
              <div class="re-filters" role="group" aria-label={m.room_add_device()} onpointerdown={keepSearchFocus}>
                {#each categoryPills as pill (pill.category)}
                  <button class="re-filter pressable" type="button"
                          class:is-active={categoryFilter === pill.category}
                          aria-pressed={categoryFilter === pill.category}
                          onclick={() => toggleCategory(pill.category)}>
                    {CATEGORY_LABELS[pill.category]}
                    <span class="re-filter-count">{pill.count}</span>
                  </button>
                {/each}
              </div>
            {/if}
            {#if query.trim() || categoryFilter}
              {#if suggestions.length === 0}
                <p class="re-empty">{m.room_no_matches()}</p>
              {:else}
                <ul class="re-list re-suggest" onpointerdown={keepSearchFocus}>
                  {#each suggestions as item (item.entityId)}
                    {@const origin = locatedIn(item.entityId)}
                    <li>
                      <button class="re-row re-suggest-btn pressable" type="button" onclick={() => add(item)}
                              class:is-celebrating={celebrating === item.entityId}>
                        <span class="re-icon re-icon-add" aria-hidden="true">
                          {#if celebrating === item.entityId}
                            <Icon name="i-check" cls="icon icon-md" />
                            {#each [0, 1, 2, 3, 4, 5] as spark (spark)}<span class="re-spark" style={`--spark:${spark}`}></span>{/each}
                          {:else}
                            <Icon name="i-plus" cls="icon icon-md" />
                          {/if}
                        </span>
                        <span class="re-label">
                          <span class="re-name">{item.name}</span>
                          <small class="re-meta">{item.entityId}</small>
                        </span>
                        <!-- Kategorie-Chip: bei 9 Domänen sieht man, WAS man hinzufügt -->
                        <span class="re-tag">{CATEGORY_LABELS[categoryOf(item.domain)]}</span>
                        {#if origin}<span class="re-tag">in {origin}</span>{/if}
                      </button>
                    </li>
                  {/each}
                </ul>
                {#if hiddenByLimit > 0}
                  <p class="re-empty">{m.ambient_more_count({ count: hiddenByLimit })}</p>
                {/if}
              {/if}
            {/if}
          </section>
          {/if}
          {:else if view === 'immersion'}
            <div class="re-immersion-editor">
              <aside class="re-immersion-lights" aria-label={m.room_pick_lamps()}>
                <p class="re-empty">{m.room_pick_lamp_hint()}</p>
                {#if roomLights.length === 0}
                  <p class="re-empty">{m.room_no_lamps()}</p>
                {:else}
                  <ul class="re-list">
                    {#each roomLights as light (light.entityId)}
                      <li>
                        <button class="re-row re-light-choice pressable"
                                class:is-selected={selectedLightId === light.entityId}
                                class:is-placed={!!placements[light.entityId]}
                                type="button" onclick={() => selectedLightId = light.entityId}>
                          <span class="re-icon" aria-hidden="true"><Icon name={light.icon ?? 'i-bulb'} /></span>
                          <span class="re-label">
                            <span class="re-name">{light.name}</span>
                            <small class="re-meta">{placements[light.entityId] ? m.room_position_set() : m.room_not_assigned()}</small>
                          </span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if selectedPlacement}
                  <label class="re-radius">
                    <span>{m.room_light_radius()}</span>
                    <input type="range" min="0.06" max="0.32" step="0.01"
                           value={selectedPlacement.radius} oninput={setSelectedRadius} />
                  </label>
                  <button class="re-unassign pressable" type="button"
                          onclick={() => room && removeLightPlacement(room.id, selectedLightId)}>
                    {m.room_unassign_light()}
                  </button>
                {/if}
              </aside>
              <button class="re-immersion-preview" type="button" onclick={placeSelected}
                      disabled={!selectedLightId}
                      style:background-image={`url("${immersionUrl}")`}
                      aria-label={selectedLightId ? m.room_set_position() : m.room_pick_lamp_first()}>
                {#each Object.entries(placements) as [entityId, placement] (entityId)}
                  <span class="re-light-marker" class:is-selected={selectedLightId === entityId}
                        style:left={`${placement.x * 100}%`} style:top={`${placement.y * 100}%`}></span>
                {/each}
              </button>
            </div>
          {:else if view === 'advanced'}
            <!-- Was die Raum-Kachel auf dem Home-Screen zeigt. Der Sensor kommt
                 automatisch aus der HA-Bereichszuordnung; die Auswahl ist nur
                 nötig, wenn mehrere infrage kommen oder HA nichts weiß. -->
            <section class="ld-section">
              {#each ['temperature', 'humidity'] as const as metric (metric)}
                {@const candidates = roomSensorCandidates(room.id, metric)}
                {@const others = otherSensorCandidates(room.id, metric)}
                {@const auto = autoSensorId(room.id, metric)}
                {@const chosen = sensorIdFor(room.id, metric)}
                {@const shown = showsMetric(room.id, metric)}
                <div class="re-metric-box">
                  <div class="re-row re-metric-head">
                    <span class="re-icon" aria-hidden="true">
                      <Icon name={metric === 'temperature' ? 'i-thermometer' : 'i-water-percent'} />
                    </span>
                    <span class="re-label">
                      <span class="re-name">{metric === 'temperature' ? m.room_display_temp() : m.room_display_humidity()}</span>
                      <small class="re-meta">
                        {metric === 'temperature' ? m.room_display_temp_hint() : m.room_display_humidity_hint()}
                      </small>
                    </span>
                    <button class="re-toggle pressable" type="button" role="switch" aria-checked={shown}
                            class:is-on={shown}
                            aria-label={metric === 'temperature' ? m.room_display_temp() : m.room_display_humidity()}
                            onclick={() => setShowsMetric(room.id, metric, !shown)}>
                      <span class="re-toggle-knob"></span>
                    </button>
                  </div>

                  {#if shown}
                    <label class="re-metric-sensor">
                      <span class="caps-label">{m.room_display_sensor()}</span>
                      {#if candidates.length === 0 && others.length === 0 && !chosen}
                        <p class="re-empty">{m.room_display_sensor_none()}</p>
                      {:else}
                        <select class="re-search" value={sensorIsAutomatic(room.id, metric) ? '' : chosen}
                                onchange={(e) => setSensorId(room.id, metric, e.currentTarget.value || undefined)}>
                          <option value="">
                            {m.room_display_sensor_auto()}{auto ? ` · ${sensorName(auto)}` : ''}
                          </option>
                          {#each candidates as item (item.entityId)}
                            <option value={item.entityId}>{item.name}</option>
                          {/each}
                          <!-- Der Rest des Hauses: ein selbst angelegter Raum hat
                               keinen HA-Bereich, sein Fühler hängt woanders. -->
                          {#if others.length > 0}
                            <optgroup label={m.room_display_sensor_others()}>
                              {#each others as item (item.entityId)}
                                <option value={item.entityId}>{item.name}{item.area ? ` · ${item.area}` : ''}</option>
                              {/each}
                            </optgroup>
                          {/if}
                        </select>
                      {/if}
                    </label>
                  {/if}
                </div>
              {/each}

              <!-- Kontakte und Melder (docs/06 §5): sie speisen die
                   Sicherheitsleiste der Tab-Bar. Auch hier kommt die Zuordnung
                   automatisch aus dem HA-Bereich; angehakt wird nur, wenn sie
                   abweichen soll. -->
              {#each ['window', 'presence'] as const as kind (kind)}
                {@const candidates = roomContactOptions(room.id, kind)}
                {@const chosen = contactIdsFor(room.id, kind)}
                <div class="re-metric-box">
                  <div class="re-row re-metric-head">
                    <span class="re-icon" aria-hidden="true">
                      <Icon name={kind === 'window' ? 'i-window' : 'i-motion-sensor'} />
                    </span>
                    <span class="re-label">
                      <span class="re-name">
                        {kind === 'window' ? m.room_contacts_window() : m.room_contacts_presence()}
                      </span>
                      <small class="re-meta">
                        {contactsAreAutomatic(room.id, kind)
                          ? m.room_contacts_auto()
                          : m.room_contacts_manual()}
                      </small>
                    </span>
                    {#if !contactsAreAutomatic(room.id, kind)}
                      <button class="secondary-btn pressable" type="button"
                              onclick={() => setContactIds(room.id, kind, undefined)}>
                        {m.room_contacts_reset()}
                      </button>
                    {/if}
                  </div>

                  {#if candidates.length === 0}
                    <p class="re-empty">{m.room_contacts_none()}</p>
                  {:else}
                    <ul class="re-contact-list">
                      {#each candidates as item (item.entityId)}
                        <li>
                          <label class="re-contact">
                            <input type="checkbox" checked={chosen.includes(item.entityId)}
                                   onchange={() => toggleContact(room.id, kind, item.entityId)} />
                            <span class="re-name">{item.name}</span>
                            <small class="re-meta">{item.entityId}</small>
                          </label>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}
            </section>
          {:else}
            <section class="re-background-editor">
              <div class="re-background-preview" style:background-image={`url("${backgroundUrl}")`}
                   aria-label={m.room_background_preview()}></div>
              <div class="re-background-actions">
                <p class="re-empty">{m.room_background_hint()}</p>
                <input bind:this={backgroundInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/avif"
                       onchange={chooseBackground} />
                <button class="secondary-btn pressable" type="button" disabled={backgroundBusy}
                        onclick={() => backgroundInput?.click()}>
                  {backgroundBusy ? m.room_background_saving() : background ? m.room_background_replace() : m.room_background_choose()}
                </button>
                <button class="secondary-btn pressable" type="button" disabled={backgroundBusy}
                        onclick={() => libraryOpen = true}>{m.rimg_lib_from_library()}</button>
                <button class="secondary-btn pressable" type="button" disabled={backgroundBusy}
                        onclick={() => wizardOpen = true}>{m.rimg_wizard_entry()}</button>
                {#if background}
                  <button class="re-unassign pressable" type="button" disabled={backgroundBusy}
                          onclick={restoreBackground}>{m.room_background_restore()}</button>
                {/if}
                {#if backgroundBusy}
                  <p class="re-background-message" role="status">{m.room_background_saving_hint()}</p>
                {:else if backgroundMessage}
                  <p class="re-background-message" class:is-error={backgroundError} role="status">{backgroundMessage}</p>
                {/if}
              </div>
            </section>
          {/if}
        </div>
        </div>
      {/key}
    {/if}
  </div>
</div>

{#if room && moveDeviceId}
  {@const moving = room.lights.find((entry) => entry.entityId === moveDeviceId)}
  <div class="re-move-layer" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) moveDeviceId = null; }}>
    <div class="re-move-sheet" role="dialog" aria-modal="true" aria-label={m.rimg_move_label()}>
      <h3>{m.rimg_move_title({ device: moving?.name ?? '' })}</h3>
      <p>{m.rimg_move_question()}</p>
      <div class="re-move-rooms">
        {#each appState.rooms.filter((entry) => entry.id !== room.id) as target (target.id)}
          <button class="secondary-btn pressable" type="button"
                  onclick={() => moveDeviceToRoom(target.id)}>{target.name}</button>
        {/each}
      </div>
      <button class="secondary-btn pressable" type="button" onclick={() => moveDeviceId = null}>{m.rimg_cancel()}</button>
    </div>
  </div>
{/if}

{#if room}
  <RoomImageLibrary open={libraryOpen} targetRoomId={room.id}
                    onclose={() => libraryOpen = false}
                    onassigned={() => { backgroundError = false; backgroundMessage = m.room_background_saved(); }} />
  <RoomImageWizard open={wizardOpen} roomId={room?.id ?? null} onclose={() => wizardOpen = false} />
{/if}
