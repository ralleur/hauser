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

/* Die Ursache in einem Satz. Mehr weiß die Oberfläche nicht: liegt das Gerät
   selbst offline, ist Home Assistant unerreichbar, egal ob es antworten
   würde — deshalb hat „Kein Netz" Vorrang. */
function outageReason(): string {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return offline ? m.conn_cause_offline() : m.conn_cause_unreachable();
}

export function connection(): ConnectionView {
  const status = runtime.connectionStatus;
  const online = status === 'connected';
  const disconnected = status === 'disconnected';
  const copy = m.connection_status_copy().split('|');
  const index = online ? 0 : status === 'connecting' ? 1 : status === 'reconnecting' ? 2 : 3;
  /* Banner nur einmal je Störung: der erste Verbindungsaufbau bekommt keins
     (er ist der Normalfall), und zwischen „reconnecting" und „disconnected"
     bleibt derselbe Satz stehen — sonst liefe die Einblendung bei jedem
     Backoff-Schritt neu an und aria-live meldete es erneut. */
  return {
    status,
    online,
    disconnected,
    label: copy[index],
    dot: online ? 'dot-online' : disconnected ? 'dot-offline' : 'dot-warning',
    banner: online || status === 'connecting' ? null : outageReason(),
  };
}

/** Sofort neu verbinden, statt auf den nächsten Backoff-Schritt zu warten. */
export function retryConnection(): void {
  runtime.retryConnection();
}
