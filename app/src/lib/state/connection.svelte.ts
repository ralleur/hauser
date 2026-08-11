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
  const view: Record<ConnectionStatus, Omit<ConnectionView, 'status'>> = {
    connected:    { online: true,  disconnected: false, label: m.state_connected(),    dot: 'dot-online',  banner: null },
    connecting:   { online: false, disconnected: false, label: m.state_connecting(),   dot: 'dot-warning', banner: m.state_connecting() },
    reconnecting: { online: false, disconnected: false, label: m.state_reconnecting(), dot: 'dot-warning', banner: m.state_reconnecting() },
    disconnected: { online: false, disconnected: true,  label: m.state_disconnected(), dot: 'dot-offline', banner: m.state_connection_interrupted() },
  };
  return { status, ...view[status] };
}
