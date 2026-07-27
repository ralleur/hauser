/* ============================================
   Live-Wiedergabe-Session (Funktionsumfang 9, ADR-009 / docs/08) — die dünne,
   austauschbare Schnittstelle des VideoPlayers: „Quelle rein, Transport-Events
   raus" (ADR-009). Sie hält KEINE Transport-Wahrheit (das bleibt
   appState.playback in app.svelte.ts) — nur die HLS-Quelle + die Identifier
   fürs Jellyfin-Reporting. PlayerLayer.svelte füttert damit ein <video>.

   Bewusst hier statt in jellyfin.ts: Netz + Runes-State + hls.js-Anbindung.
   Die reinen Teile (DeviceProfile/Source-Auswahl/URL-Bau) liegen getestet in
   jellyfin-playback.ts; die REST-Aufrufe im JellyfinClient. Dieses Modul
   orchestriert nur und wird ausschließlich im Live-Modus angesprochen — der
   Fake-Pfad (openPlayer/1-Hz-Tick) fasst es nie an.
   ============================================ */

import { jellyfin } from '../adapter/jellyfin.ts';
import { selectMediaSource, type PlaybackSelection } from '../adapter/jellyfin-playback.ts';
import { secondsToTicks } from '../adapter/jellyfin-map.ts';
import type { PlaybackReport } from '../adapter/jellyfin.ts';

export interface LiveStream {
  itemId: string;
  selection: PlaybackSelection;
  url: string;
}

const session: { stream: LiveStream | null; loading: boolean; error: string | null } = $state({
  stream: null,
  loading: false,
  error: null,
});

/* ── Lesen (reaktiv im PlayerLayer) ── */
export function liveStream(): LiveStream | null {
  return session.stream;
}
export function liveLoading(): boolean {
  return session.loading;
}
export function liveError(): string | null {
  return session.error;
}

/* ── Session-Lebenszyklus ── */

/** PlaybackInfo abfragen, MediaSource wählen, HLS-URL bauen und Start melden.
    Ein Fehler (Netz/kein kompatibler Stream) setzt `error` statt zu werfen —
    PlayerLayer zeigt dann ein Fehler-Overlay statt eines toten <video>. */
export async function startLive(itemId: string, startPosSeconds: number): Promise<void> {
  session.loading = true;
  session.error = null;
  session.stream = null;
  try {
    const info = await jellyfin.postPlaybackInfo(itemId, {
      startPositionTicks: secondsToTicks(startPosSeconds),
    });
    const selection = selectMediaSource(info);
    if (!selection) throw new Error(info.ErrorCode ?? 'Keine spielbare Quelle');
    const url = jellyfin.streamUrl(itemId, selection);
    session.stream = { itemId, selection, url };
    jellyfin.reportStart(report(itemId, selection, startPosSeconds, false));
  } catch (err) {
    session.error = 'Wiedergabe konnte nicht gestartet werden';
    console.warn('[playback] Start fehlgeschlagen:', err);
  } finally {
    session.loading = false;
  }
}

/** Fortschritt melden (~alle 10 s + bei Pause/Seek). No-op ohne Session. */
export function reportLiveProgress(
  posSeconds: number,
  isPaused: boolean,
  eventName: PlaybackReport['EventName'] = 'timeupdate',
): void {
  const s = session.stream;
  if (!s) return;
  jellyfin.reportProgress({ ...report(s.itemId, s.selection, posSeconds, isPaused), EventName: eventName });
}

/** Wiedergabe beenden: finalen Resume-Punkt melden und Session verwerfen. */
export function stopLive(posSeconds: number): void {
  const s = session.stream;
  if (!s) return;
  jellyfin.reportStopped(report(s.itemId, s.selection, posSeconds, true));
  session.stream = null;
  session.error = null;
}

/* ── HLS-Anbindung ──
   Safari/iOS können HLS nativ (`canPlayType`), Chrome/Android brauchen hls.js
   (dynamisch importiert — die Lib landet nicht im Haupt-Bundle). Gibt eine
   Cleanup-Funktion zurück, die den Player wieder löst (Folgenwechsel/Schließen). */
export function attachHls(video: HTMLVideoElement, url: string): () => void {
  let destroyed = false;
  let hls: { destroy(): void } | null = null;

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  } else {
    void import('hls.js').then(({ default: Hls }) => {
      if (destroyed) return;
      if (Hls.isSupported()) {
        const inst = new Hls({ enableWorker: true });
        hls = inst;
        inst.loadSource(url);
        inst.attachMedia(video);
      } else {
        video.src = url; // letzter Fallback
      }
    });
  }

  return () => {
    destroyed = true;
    hls?.destroy();
    hls = null;
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      /* jsdom/kein Media-Element */
    }
  };
}

/* ── intern ── */

function report(
  itemId: string,
  selection: PlaybackSelection,
  posSeconds: number,
  isPaused: boolean,
): PlaybackReport {
  return {
    ItemId: itemId,
    PlaySessionId: selection.playSessionId,
    MediaSourceId: selection.mediaSourceId,
    PositionTicks: secondsToTicks(posSeconds),
    IsPaused: isPaused,
    PlayMethod: selection.playMethod,
    CanSeek: true,
  };
}
