/* Kopplung eines Telefons aus dem System-Screen (Plan 21, Stufe 0). */
import { apiGet, apiRequest } from '../api/client.ts';
import type { PairedDevice, PairingStartResponse } from '../api/types.ts';
import { nativeBridge } from '../native/bridge.ts';

export const pairingUi = $state({
  /* Der QR-Knopf neben dem Lockup springt zu Dienste und startet sofort. */
  autoStart: false,
  active: null as PairingStartResponse | null,
  devices: [] as PairedDevice[],
  loading: false,
  error: false,
  noStay: false,
});

export async function startPairing(guest = false): Promise<void> {
  pairingUi.loading = true;
  pairingUi.error = false;
  pairingUi.noStay = false;
  const lan = typeof location === 'undefined' ? null : location.origin;
  const result = await apiRequest('pairingStart', { body: { lan, guest } });
  pairingUi.loading = false;
  if (!result.ok) {
    if (result.status === 409) pairingUi.noStay = true; else pairingUi.error = true;
    return;
  }
  pairingUi.active = result.data;
}

/* NFC-Tag für einen Raum (Stufe 6): der Tag trägt den Deep-Link, das
   Telefon öffnet den Raum. Nur in der App vorhanden. */
export async function writeRoomTag(roomId: string): Promise<boolean> {
  const nfc = nativeBridge().nfc;
  if (!nfc) return false;
  return nfc.write(`hauser://open?screen=home&room=${encodeURIComponent(roomId)}`);
}

export function stopPairing(): void {
  pairingUi.active = null;
}

export async function loadDevices(): Promise<void> {
  const data = await apiGet('pairingDevices');
  if (data) pairingUi.devices = data.devices;
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const result = await apiRequest('pairingDeviceRevoke', { params: { deviceId } });
  if (result.ok) pairingUi.devices = pairingUi.devices.filter((d) => d.id !== deviceId);
}
