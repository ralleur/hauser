/* ============================================
   Verbindungszustand für die UI (ADR-017 Addendum, docs/02 Offline/Reconnect).
   Liest den reaktiven connectionStatus aus der Runtime und leitet Label, Dot und
   Banner-Text ab. Die UI kennt nur diese Sicht — nicht Backend oder ConnectionLayer.
   ============================================ */

import { runtime } from '../adapter/runtime.svelte.ts';
import type { ConnectionStatus } from '../adapter/types.ts';
import { m } from '../../paraglide/messages.js';

interface ConnectionView {
  status: ConnectionStatus;
  online: boolean;       // Commands möglich?
  disconnected: boolean; // harte Trennung → Controls deaktivieren
  label: string;         // Status-Dot-Text (StatusBar)
  dot: string;           // Dot-Klasse
  banner: string | null; // schmales Banner, null = kein Banner
}

export function connection(): ConnectionView {
  const status = runtime.connectionStatus;
  const online = status === 'connected';
  const disconnected = status === 'disconnected';
  const copy = m.connection_status_copy().split('|');
  const index = online ? 0 : status === 'connecting' ? 1 : status === 'reconnecting' ? 2 : 3;
  return {
    status,
    online,
    disconnected,
    label: copy[index],
    dot: online ? 'dot-online' : disconnected ? 'dot-offline' : 'dot-warning',
    banner: online ? null : copy[index],
  };
}
