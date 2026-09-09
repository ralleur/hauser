/* Fernzugriff im System-Screen (Plan 21, Stufe 2): Zustand des tsnet-Sidecars
   und die eigene Adresse für Haushalte mit Reverse-Proxy. */
import { apiGet, apiRequest } from '../api/client.ts';
import type { RemoteStatusResponse } from '../api/types.ts';
import { sharedStorage } from './shared-config.ts';

export const REMOTE_OWN_URL_KEY = 'hmi:remote-url';

export const remoteUi = $state({
  status: null as RemoteStatusResponse | null,
  ownUrl: '',
});

export async function loadRemoteStatus(): Promise<void> {
  const data = await apiGet('remoteStatus');
  if (data) {
    remoteUi.status = data;
    remoteUi.ownUrl = data.ownUrl ?? '';
  }
}

export function setOwnRemoteUrl(value: string): void {
  const v = value.trim().replace(/\/+$/, '');
  remoteUi.ownUrl = v;
  try {
    if (v) sharedStorage.setItem(REMOTE_OWN_URL_KEY, v);
    else sharedStorage.removeItem(REMOTE_OWN_URL_KEY);
  } catch { /* best-effort */ }
}

export async function resetRemote(): Promise<void> {
  await apiRequest('remoteReset');
  await loadRemoteStatus();
}
