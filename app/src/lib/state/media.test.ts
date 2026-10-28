// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  value: { playing: false, source: 'HDMI', sources: ['HDMI', 'Radio'] },
  dispatch: vi.fn(), storage: new Map<string, string>(),
}));
vi.mock('../adapter/runtime.svelte.ts', () => ({ runtime: { merged: () => fixture.value, dispatch: fixture.dispatch } }));
vi.mock('./entities.ts', () => ({ mediaEntityId: () => 'media_player.living_room' }));
vi.mock('./app.svelte.ts', () => ({ MEDIA_SEED: [] }));
vi.mock('./shared-config.ts', () => ({ sharedStorage: {
  getItem: (key: string) => fixture.storage.get(key) ?? null,
  setItem: (key: string, value: string) => fixture.storage.set(key, value),
} }));

import { playPreset, selectMediaSource } from './media.svelte.ts';
import { loadMediaPresets, parseMediaPresets, saveMediaPresets } from './media-presets.ts';

beforeEach(() => { fixture.dispatch.mockClear(); fixture.storage.clear(); });

describe('Home Assistant media controls', () => {
  it('sends playable IDs and the content type without demo-only fields or an invented source', () => {
    playPreset('living', { label: 'Morning', value: 'media-source://radio_browser/station/123', contentType: 'music' });
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'media_player', service: 'play_media',
      data: { media_content_id: 'media-source://radio_browser/station/123', media_content_type: 'music' },
    }), { playing: true });
    playPreset('living', { label: 'My list', value: 'spotify:playlist:123', contentType: 'playlist' });
    expect(fixture.dispatch.mock.calls[1][0].data.media_content_type).toBe('playlist');
  });

  it('selects an advertised source and ignores an unknown one', () => {
    selectMediaSource('living', 'Radio');
    selectMediaSource('living', 'Missing');
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      service: 'select_source', data: { source: 'Radio' },
    }), { source: 'Radio' });
  });

  it('reads native presets and round-trips playlist types without dummy presets', () => {
    expect(parseMediaPresets(null)).toEqual([]);
    expect(parseMediaPresets('{broken')).toEqual([]);
    const presets = parseMediaPresets(JSON.stringify({ version: 1, presets: [
      { name: 'Radio', url: 'https://radio.example/stream' },
      { name: 'List', url: 'spotify:playlist:123', type: 'playlist' },
      { name: '', url: '' }, null,
    ] }));
    expect(presets).toEqual([
      { label: 'Radio', value: 'https://radio.example/stream', contentType: 'music' },
      { label: 'List', value: 'spotify:playlist:123', contentType: 'playlist' },
    ]);
    saveMediaPresets(presets);
    expect(loadMediaPresets()).toEqual(presets);
  });
});
