// SPDX-License-Identifier: AGPL-3.0-only
import type { Preset } from './media.svelte.ts';
import { sharedStorage } from './shared-config.ts';

const KEY = 'hmi:media-presets:v1';

export function parseMediaPresets(raw: string | null): Preset[] {
  try {
    const config = JSON.parse(raw ?? 'null');
    if (config?.version !== 1 || !Array.isArray(config.presets)) return [];
    return config.presets.filter((entry: Record<string, unknown>) => entry && typeof entry.name === 'string'
      && entry.name.trim() && typeof entry.url === 'string' && entry.url.trim())
      .map((entry: { name: string; url: string; type?: string }) => ({
        label: entry.name.trim(), value: entry.url.trim(), contentType: entry.type === 'playlist' ? 'playlist' : 'music',
      }));
  } catch { return []; }
}

export function loadMediaPresets(): Preset[] {
  return parseMediaPresets(sharedStorage.getItem(KEY));
}

export function saveMediaPresets(presets: readonly Preset[]): void {
  sharedStorage.setItem(KEY, JSON.stringify({ version: 1, presets: presets.map(preset => ({
    name: preset.label, url: preset.value, type: preset.contentType ?? 'music',
  })) }));
}
