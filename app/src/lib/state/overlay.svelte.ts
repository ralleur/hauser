/* ── Geräte-Detail (zweite Ebene): eigenes Modal über der Kachel-Ebene ──
   Long-Press (bzw. Tap bei nicht-schaltbaren Kategorien) auf eine Kachel
   öffnet das kategoriespezifische Overlay (Licht: Helligkeit/Farbe/Farbtemp,
   temp: Solltemp/Modus, info: Wert, media: Play/Lautstärke). Eigene
   Zustandsmaschine (hidden → open → closing) neben dem Room-Overlay, damit
   beide unabhängig stapeln können. Trägt roomId+deviceId, weil die Kacheln in
   mehreren Kontexten (Inline-Panel, Room-Overlay) leben. */
export const deviceDetail = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
  roomId: '',
  deviceId: '',
});

export function openDeviceDetail(roomId: string, deviceId: string) {
  deviceDetail.roomId = roomId;
  deviceDetail.deviceId = deviceId;
  deviceDetail.mode = 'open';
}

export function closeDeviceDetail(instant = false) {
  if (deviceDetail.mode === 'hidden' || deviceDetail.mode === 'closing') return;
  deviceDetail.mode = instant ? 'hidden' : 'closing';
}

export function finishDeviceDetailClose() {
  if (deviceDetail.mode === 'closing') deviceDetail.mode = 'hidden';
}

/* ── Raum-Geräte-Editor: Long-Press auf eine Raum-Kachel (Home) öffnet das
   Bearbeiten-Modal (Reihenfolge, Hinzufügen per Suche, Entfernen). Gleiche
   Zustandsmaschine wie deviceDetail, eigener Stack-Slot. */
export type RoomEditView = 'devices' | 'immersion' | 'background';

export const roomEdit = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
  roomId: '',
  /* Womit das Overlay aufgeht: der Tap auf das Raumbild landet direkt beim
     Bild, alles andere bei der Geräteliste. */
  view: 'devices' as RoomEditView,
});

export function openRoomEdit(roomId: string, view: RoomEditView = 'devices') {
  roomEdit.roomId = roomId;
  roomEdit.view = view;
  roomEdit.mode = 'open';
}

export function closeRoomEdit(instant = false) {
  if (roomEdit.mode === 'hidden' || roomEdit.mode === 'closing') return;
  roomEdit.mode = instant ? 'hidden' : 'closing';
}

export function finishRoomEditClose() {
  if (roomEdit.mode === 'closing') roomEdit.mode = 'hidden';
}

/* ── Zentrale Klimasteuerung: Long-Press auf die Klima-Pille ──
   Dieselbe Zustandsmaschine, eigener Stack-Slot. Die Shells müssen nur wissen,
   OB das Overlay offen ist, um den lazy geladenen Editor zu rendern; die
   Konfigurationsoberfläche mit Gerätekatalog liegt in
   `climate-central-config.svelte.ts`. Wohnt hier statt in einem eigenen Modul,
   weil die Pille im Startpfad beider Shells liegt und der sonst einen Chunk
   mehr lädt (ADR-029). */
export const centralClimateEdit = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
});

export function openCentralClimateEdit(): void {
  centralClimateEdit.mode = 'open';
}

export function closeCentralClimateEdit(instant = false): void {
  if (centralClimateEdit.mode === 'hidden' || centralClimateEdit.mode === 'closing') return;
  centralClimateEdit.mode = instant ? 'hidden' : 'closing';
}

export function finishCentralClimateEditClose(): void {
  if (centralClimateEdit.mode === 'closing') centralClimateEdit.mode = 'hidden';
}

/* ── Schnellzugriff der Telefonleiste: Long-Press auf den Urlaubsknopf ──
   Dieselbe Zustandsmaschine, eigener Stack-Slot. Was dahinter liegt, hält
   `phone-action.svelte.ts`; hier steht nur, ob der Editor offen ist. */
export const phoneActionEdit = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
});

export function openPhoneActionEdit(): void {
  phoneActionEdit.mode = 'open';
}

export function closePhoneActionEdit(instant = false): void {
  if (phoneActionEdit.mode === 'hidden' || phoneActionEdit.mode === 'closing') return;
  phoneActionEdit.mode = instant ? 'hidden' : 'closing';
}

export function finishPhoneActionEditClose(): void {
  if (phoneActionEdit.mode === 'closing') phoneActionEdit.mode = 'hidden';
}

/* ── Klima des Raums: Tap auf die Klima-Kachel öffnet die Steuerung, langer
   Druck die Einstellungen der Kachel (Owner-Entscheidung 2026-09-11).
   Dieselbe Zustandsmaschine, eigener Stack-Slot; nur das Panel nutzt sie,
   das Telefon behält die Karte im Raum-Sheet. */
export type RoomClimateView = 'control' | 'settings';

export const roomClimate = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
  roomId: '',
  view: 'control' as RoomClimateView,
});

export function openRoomClimate(roomId: string, view: RoomClimateView = 'control'): void {
  roomClimate.roomId = roomId;
  roomClimate.view = view;
  roomClimate.mode = 'open';
}

export function closeRoomClimate(instant = false): void {
  if (roomClimate.mode === 'hidden' || roomClimate.mode === 'closing') return;
  roomClimate.mode = instant ? 'hidden' : 'closing';
}

export function finishRoomClimateClose(): void {
  if (roomClimate.mode === 'closing') roomClimate.mode = 'hidden';
}
