import { describe, it, expect } from 'vitest';
import {
  buildDeviceProfile,
  selectMediaSource,
  resolveStreamUrl,
  type PlaybackInfoResponse,
} from './jellyfin-playback.ts';

describe('buildDeviceProfile', () => {
  it('bewirbt H.264/AAC-DirectPlay und HLS-Transcode', () => {
    const p = buildDeviceProfile();
    const dp = p.DirectPlayProfiles[0];
    expect(dp.VideoCodec).toContain('h264');
    expect(dp.AudioCodec).toContain('aac');
    const tp = p.TranscodingProfiles[0];
    expect(tp.Protocol).toBe('hls');
    expect(tp.VideoCodec).toBe('h264');
    expect(tp.Container).toBe('ts');
  });

  it('übernimmt die maximale Bitrate', () => {
    const p = buildDeviceProfile(8_000_000);
    expect(p.MaxStreamingBitrate).toBe(8_000_000);
  });
});

describe('selectMediaSource', () => {
  it('nimmt die erste Quelle mit Id und trägt die PlaySessionId', () => {
    const info: PlaybackInfoResponse = {
      PlaySessionId: 'sess-1',
      MediaSources: [{ Id: 'ms-a', SupportsDirectPlay: true }],
    };
    const sel = selectMediaSource(info)!;
    expect(sel.mediaSourceId).toBe('ms-a');
    expect(sel.playSessionId).toBe('sess-1');
    expect(sel.playMethod).toBe('DirectPlay');
  });

  it('stuft eine TranscodingUrl als Transcode ein', () => {
    const info: PlaybackInfoResponse = {
      PlaySessionId: 'sess-2',
      MediaSources: [{ Id: 'ms-b', SupportsTranscoding: true, TranscodingUrl: '/videos/ms-b/master.m3u8?x=1' }],
    };
    expect(selectMediaSource(info)!.playMethod).toBe('Transcode');
  });

  it('ohne kompatible Quelle → null', () => {
    expect(selectMediaSource({ MediaSources: [] })).toBeNull();
    expect(selectMediaSource({})).toBeNull();
  });
});

describe('resolveStreamUrl', () => {
  const common = { base: 'http://jf.test:8096', itemId: 'item-1', deviceId: 'dev-9', token: 'tok-xyz' };

  it('macht die relative TranscodingUrl absolut und ergänzt api_key', () => {
    const url = resolveStreamUrl({
      ...common,
      selection: {
        source: { Id: 'ms', TranscodingUrl: '/videos/item-1/master.m3u8?PlaySessionId=s&mediaSourceId=ms' },
        mediaSourceId: 'ms',
        playSessionId: 's',
        playMethod: 'Transcode',
      },
    });
    expect(url).toBe('http://jf.test:8096/videos/item-1/master.m3u8?PlaySessionId=s&mediaSourceId=ms&api_key=tok-xyz');
  });

  it('dupliziert api_key nicht, wenn Jellyfin ihn schon gesetzt hat', () => {
    const url = resolveStreamUrl({
      ...common,
      selection: {
        source: { Id: 'ms', TranscodingUrl: '/videos/item-1/master.m3u8?api_key=already' },
        mediaSourceId: 'ms',
        playSessionId: 's',
        playMethod: 'Transcode',
      },
    });
    expect(url).toBe('http://jf.test:8096/videos/item-1/master.m3u8?api_key=already');
  });

  it('baut ohne TranscodingUrl die master.m3u8 mit allen Parametern', () => {
    const url = resolveStreamUrl({
      ...common,
      selection: { source: { Id: 'ms' }, mediaSourceId: 'ms', playSessionId: 'sess', playMethod: 'DirectStream' },
    });
    expect(url).toContain('http://jf.test:8096/Videos/item-1/master.m3u8?');
    expect(url).toContain('mediaSourceId=ms');
    expect(url).toContain('playSessionId=sess');
    expect(url).toContain('deviceId=dev-9');
    expect(url).toContain('api_key=tok-xyz');
    expect(url).toContain('container=ts');
  });

  it('lässt eine absolute TranscodingUrl unverändert (nur api_key ergänzt)', () => {
    const url = resolveStreamUrl({
      ...common,
      selection: {
        source: { Id: 'ms', TranscodingUrl: 'http://other:8096/videos/x/master.m3u8?a=1' },
        mediaSourceId: 'ms',
        playSessionId: 's',
        playMethod: 'Transcode',
      },
    });
    expect(url).toBe('http://other:8096/videos/x/master.m3u8?a=1&api_key=tok-xyz');
  });
});
