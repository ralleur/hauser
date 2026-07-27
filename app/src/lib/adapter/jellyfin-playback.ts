/* ============================================
   Jellyfin-Wiedergabe (Funktionsumfang 9, ADR-008/009 / docs/08) — reine
   Bausteine des kritischen Pfads: DeviceProfile fürs PlaybackInfo, Auswahl der
   MediaSource aus der Antwort und der Bau der HLS-Master-URL. Kein Netz, kein
   State, keine Seiteneffekte — analog jellyfin-map.ts. Der REST-Client
   (jellyfin.ts) ruft PlaybackInfo/Progress; diese Datei entscheidet nur, WAS
   gespielt wird und WIE die URL aussieht (Direct vs. Transcode).

   Warum HLS für ALLES: die HMI-Wiedergabe läuft über ein Browser-<video> +
   hls.js. Selbst wenn Jellyfin DirectPlay erlaubt (H.264/AAC-MP4), füttern wir
   den Player nicht mit einer .mp4, sondern mit `master.m3u8` — Jellyfin remuxt
   dann verlustfrei nach HLS (kein CPU-Transcode). Nur echte Nicht-Web-Codecs
   (HEVC-4K/DV/Lossless) lösen den VideoToolbox-Transcode aus (docs/08).
   ============================================ */

/* ── PlaybackInfo-DTOs (nur die Felder, die wir lesen) ── */
export interface MediaSourceInfo {
  Id: string;
  /** Von Jellyfin gebauter Transcode-/Remux-HLS-Pfad (relativ, mit allen
      Codec-/Bitraten-Parametern). Wenn gesetzt, ist es die fertige HLS-URL. */
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string; // 'hls'
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  Container?: string;
}

export interface PlaybackInfoResponse {
  MediaSources?: MediaSourceInfo[];
  PlaySessionId?: string;
  ErrorCode?: string; // z. B. 'NoCompatibleStream'
}

/** Ausgewählte Quelle + die Identifier, die Stream-URL und Reporting brauchen. */
export interface PlaybackSelection {
  source: MediaSourceInfo;
  mediaSourceId: string;
  playSessionId: string;
  /** Reporting-Feld (Sessions/Playing): so hat Jellyfin die Wiedergabe eingestuft. */
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
}

/* ── DeviceProfile ──
   Sagt Jellyfin, was das Browser-<video> direkt kann und wohin sonst
   transcodiert werden soll. Bewusst schmal: H.264/AAC direkt, alles andere →
   HLS (TS-Segmente, H.264/AAC) über den bestehenden VideoToolbox-Pfad. */
export interface DeviceProfile {
  MaxStreamingBitrate: number;
  MaxStaticBitrate: number;
  DirectPlayProfiles: Array<Record<string, string>>;
  TranscodingProfiles: Array<Record<string, unknown>>;
  SubtitleProfiles: Array<Record<string, string>>;
}

/** DeviceProfile fürs PlaybackInfo (docs/08). 120 Mbit deckt auch Remux-HLS
    von hohen Bitraten ab; der Transcode-Fall bleibt H.264/AAC-HLS. */
export function buildDeviceProfile(maxBitrate = 120_000_000): DeviceProfile {
  return {
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: maxBitrate,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v,mkv', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3,ac3' },
    ],
    TranscodingProfiles: [
      {
        Container: 'ts',
        Type: 'Video',
        Protocol: 'hls',
        VideoCodec: 'h264',
        AudioCodec: 'aac,mp3',
        Context: 'Streaming',
        MaxAudioChannels: '2',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'Hls' },
      { Format: 'srt', Method: 'External' },
    ],
  };
}

/* ── MediaSource-Auswahl ──
   Erste kompatible Quelle nehmen (Jellyfin sortiert nach Eignung). PlayMethod
   fürs Reporting aus den Support-Flags ableiten — eine TranscodingUrl bedeutet
   Transcode/Remux, sonst Direct*. */
export function selectMediaSource(info: PlaybackInfoResponse): PlaybackSelection | null {
  const sources = info.MediaSources ?? [];
  const source = sources.find((s) => !!s.Id);
  if (!source) return null;
  const playSessionId = info.PlaySessionId ?? '';
  const playMethod: PlaybackSelection['playMethod'] = source.TranscodingUrl
    ? 'Transcode'
    : source.SupportsDirectPlay
      ? 'DirectPlay'
      : 'DirectStream';
  return { source, mediaSourceId: source.Id, playSessionId, playMethod };
}

/* ── HLS-Master-URL ──
   Zwei Fälle (docs/08 Schritt 2):
   1. TranscodingUrl vorhanden → sie IST die fertige HLS-URL (relativ). Nur
      absolut machen und ggf. api_key ergänzen.
   2. Sonst (Direct-Remux) → `/Videos/{itemId}/master.m3u8` selbst bauen mit
      mediaSourceId/playSessionId/deviceId/api_key.
   Anders als imageUrl BRAUCHT die Stream-URL den Token (api_key) — sie wird vom
   <video>/hls.js ohne Authorization-Header geladen. */
export interface StreamUrlParams {
  base: string; // Basis-URL ohne Trailing-Slash
  itemId: string;
  selection: PlaybackSelection;
  deviceId: string;
  token: string;
}

export function resolveStreamUrl(p: StreamUrlParams): string {
  const base = p.base.replace(/\/+$/, '');
  const turl = p.selection.source.TranscodingUrl;
  if (turl) {
    const abs = isAbsoluteUrl(turl) ? turl : `${base}/${stripLeadingSlash(turl)}`;
    return withApiKey(abs, p.token);
  }
  const q = new URLSearchParams();
  q.set('mediaSourceId', p.selection.mediaSourceId);
  if (p.selection.playSessionId) q.set('playSessionId', p.selection.playSessionId);
  q.set('deviceId', p.deviceId);
  if (p.token) q.set('api_key', p.token);
  q.set('container', 'ts');
  return `${base}/Videos/${p.itemId}/master.m3u8?${q.toString()}`;
}

/* ── URL-Kleinformer ── */

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Führenden Slash entfernen, damit `${base}/${rest}` sauber zusammensetzt. */
function stripLeadingSlash(url: string): string {
  return url.replace(/^\/+/, '');
}

/** api_key nur anhängen, wenn Jellyfin ihn nicht schon in die URL geschrieben hat. */
function withApiKey(url: string, token: string): string {
  if (!token || /[?&]api_key=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(token)}`;
}
