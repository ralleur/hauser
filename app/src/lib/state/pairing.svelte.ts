/* Kopplung eines Telefons aus dem System-Screen (Plan 21, Stufe 0). */
import { apiGet, apiRequest } from '../api/client.ts';
import type { PairedDevice, PairingStartResponse } from '../api/types.ts';

export const pairingUi = $state({
  /* Der QR-Knopf neben dem Lockup springt zu Dienste und startet sofort. */
  autoStart: false,
  active: null as PairingStartResponse | null,
  devices: [] as PairedDevice[],
  loading: false,
  error: false,
});

export async function startPairing(): Promise<void> {
  pairingUi.loading = true;
  pairingUi.error = false;
  const lan = typeof location === 'undefined' ? null : location.origin;
  const result = await apiRequest('pairingStart', { body: { lan } });
  pairingUi.loading = false;
  if (!result.ok) { pairingUi.error = true; return; }
  pairingUi.active = result.data;
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
