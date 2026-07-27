import { describe, expect, it } from 'vitest';
import { homePodAudioUrl, homePodEntityIds } from './songs.ts';

describe('Songausgabe auf HomePods', () => {
  it('liefert eine für Home Assistant und HomePods erreichbare LAN-URL', () => {
    expect(homePodAudioUrl('/api/songs/audio?path=%2Ftmp%2Fsong.mp3')).toBe(
      'http://localhost:4173/api/songs/audio?path=%2Ftmp%2Fsong.mp3',
    );
    expect(homePodAudioUrl('https://evil.invalid/song.mp3')).toBeNull();
    expect(homePodAudioUrl('/api/songs/library/550e8400-e29b-41d4-a716-446655440000/audio')).toBe(
      'http://localhost:4173/api/songs/library/550e8400-e29b-41d4-a716-446655440000/audio',
    );
  });

  it('adressiert die vorhandenen HA-HomePod-Entities', () => {
    expect(homePodEntityIds('wohnzimmer')).toEqual(['media_player.wohnzimmer_speaker']);
    expect(homePodEntityIds('kueche')).toEqual(['media_player.kueche_speaker']);
    expect(homePodEntityIds('both')).toEqual([
      'media_player.wohnzimmer_speaker', 'media_player.kueche_speaker',
    ]);
  });
});
