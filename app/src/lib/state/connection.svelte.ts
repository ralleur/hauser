/* ============================================
   Verbindungszustand für die UI (ADR-017 Addendum, docs/02 Offline/Reconnect).
   Liest den reaktiven connectionStatus aus der Runtime und leitet Label, Dot und
   Banner-Text ab. Die UI kennt nur diese Sicht — nicht Backend oder ConnectionLayer.
   ============================================ */

import { runtime } from '../adapter/runtime.svelte.ts';
import type { ConnectionStatus } from '../adapter/types.ts';

interface ConnectionView {
  status: ConnectionStatus;
  online: boolean;       // Commands möglich?
  disconnected: boolean; // harte Trennung → Controls deaktivieren
  label: string;         // Status-Dot-Text (StatusBar)
  dot: string;           // Dot-Klasse
  banner: string | null; // schmales Banner, null = kein Banner
}

const VIEW: Record<ConnectionStatus, Omit<ConnectionView, 'status'>> = {
  connected:    { online: true,  disconnected: false, label: 'Verbunden',      dot: 'dot-online',  banner: null },
  connecting:   { online: false, disconnected: false, label: 'Verbindet…',     dot: 'dot-warning', banner: 'Verbindung wird aufgebaut…' },
  reconnecting: { online: false, disconnected: false, label: 'Neu verbinden…', dot: 'dot-warning', banner: 'Neu verbinden…' },
  disconnected: { online: false, disconnected: true,  label: 'Getrennt',       dot: 'dot-offline', banner: 'Verbindung unterbrochen' },
};

export function connection(): ConnectionView {
  const status = runtime.connectionStatus;
  return { status, ...VIEW[status] };
}
