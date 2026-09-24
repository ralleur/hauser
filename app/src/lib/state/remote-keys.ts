/* SPDX-License-Identifier: AGPL-3.0-only */

import { runtime } from '../adapter/runtime.svelte.ts';

/* ── Fernbedienung eines Fernsehers (wie die iOS-App) ──
   Home Assistant stellt einem Apple TV ein `remote.*` gleichen Namens zur
   Seite; gibt es das, bekommt der Medienspieler im Detail ein Steuerkreuz. */
export type RemoteKey = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'home' | 'play_pause';

export function remoteEntityFor(entityId: string, known: readonly { entityId: string }[]): string | null {
  if (!entityId.startsWith('media_player.')) return null;
  const remote = `remote.${entityId.slice('media_player.'.length)}`;
  return known.some((item) => item.entityId === remote) ? remote : null;
}

export function pressRemoteKey(remoteId: string, key: RemoteKey): void {
  /* Die Apple-TV-Fernbedienung in Home Assistant nennt „Zurück" `menu`. */
  runtime.dispatch({
    entityId: remoteId, domain: 'remote', service: 'send_command',
    data: { command: key === 'back' ? 'menu' : key }, queuedAt: Date.now(),
  }, {});
}
