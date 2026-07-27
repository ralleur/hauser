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
export const roomEdit = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
  roomId: '',
});

export function openRoomEdit(roomId: string) {
  roomEdit.roomId = roomId;
  roomEdit.mode = 'open';
}

export function closeRoomEdit(instant = false) {
  if (roomEdit.mode === 'hidden' || roomEdit.mode === 'closing') return;
  roomEdit.mode = instant ? 'hidden' : 'closing';
}

export function finishRoomEditClose() {
  if (roomEdit.mode === 'closing') roomEdit.mode = 'hidden';
}
