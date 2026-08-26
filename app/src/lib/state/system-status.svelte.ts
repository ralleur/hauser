// SPDX-License-Identifier: AGPL-3.0-only

import { runtime } from '../adapter/runtime.svelte.ts';
import type { SystemUpdate } from '../adapter/types.ts';
import { IS_DEMO } from '../demo/demo-mode.ts';
import { appState } from './app.svelte.ts';

export const systemStatus = $state({
  updates: (IS_DEMO
    ? appState.system.updates.map((update, index): SystemUpdate => ({
        entityId: `demo.update_${index}`,
        name: update.name,
        installedVersion: update.from,
        latestVersion: update.to,
      }))
    : []) as SystemUpdate[],
  loading: false,
  failed: false,
});

let requestSequence = 0;

export async function refreshSystemStatus(): Promise<void> {
  if (IS_DEMO) return;
  const sequence = ++requestSequence;
  systemStatus.loading = true;
  systemStatus.failed = false;
  try {
    const updates = await runtime.listSystemUpdates();
    if (sequence !== requestSequence) return;
    systemStatus.updates = updates;
  } catch {
    if (sequence !== requestSequence) return;
    systemStatus.updates = [];
    systemStatus.failed = true;
  } finally {
    if (sequence === requestSequence) systemStatus.loading = false;
  }
}
