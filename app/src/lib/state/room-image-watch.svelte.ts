/* ── Der Assistent meldet sich selbst (Paket 13) ──

   Ein Bildset entsteht in Minuten, der Feinschliff danach in weiteren. Niemand
   soll dafür ein Fenster offen halten. Dieser Wächter läuft neben der
   Oberfläche und macht aus drei Zuständen je eine Meldung im
   Benachrichtigungszentrum:

     • Die Entwürfe liegen zur Auswahl bereit.
     • Der Satz liegt fertig zur Prüfung.
     • Fenster sind erkannt, das Wetter zieht draußen vorbei.

   Beide Meldungen führen zurück in den Assistenten. Beobachtet wird nur, was
   die Oberfläche ohnehin abfragen darf; der Server arbeitet unabhängig davon
   weiter. Was einmal gemeldet wurde, wird nicht erneut gemeldet — auch nach
   einem Neuladen nicht, deshalb der kleine Merkzettel im Gerätespeicher. */

import { m } from '../../paraglide/messages.js';
import { notifications } from './notifications.svelte.ts';
import { setRoomImageStage } from './room-image-activity.svelte.ts';
import { ROOM_IMAGE_RESUME_KEY } from './room-image-wizard-state.ts';

const SEEN_KEY = 'hmi:room-image-announced:v1';
const JOB_INTERVAL_MS = 15_000;
const FINISH_INTERVAL_MS = 20_000;
/* Der Feinschliff braucht ein bis zwei Minuten; nach einer Viertelstunde ist
   etwas anderes schiefgegangen, und der nächtliche Lauf übernimmt. */
const FINISH_TRIES = 45;

interface ResumeMarker { jobId?: unknown }

function announced(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []);
  } catch { return new Set(); }
}

function remember(key: string): boolean {
  const seen = announced();
  if (seen.has(key)) return false;
  seen.add(key);
  try {
    /* Nur die jüngsten Einträge behalten — der Zettel soll nicht wachsen. */
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-20)));
  } catch { /* Best-effort wie im Benachrichtigungszentrum. */ }
  return true;
}

function activeJobId(): string | null {
  try {
    const marker = JSON.parse(localStorage.getItem(ROOM_IMAGE_RESUME_KEY) ?? 'null') as ResumeMarker | null;
    return typeof marker?.jobId === 'string' ? marker.jobId : null;
  } catch { return null; }
}

function announce(key: string, title: string, message: string, icon: string): void {
  if (!remember(key)) return;
  notifications.pushLocal({
    id: key,
    source: 'room-image',
    sourceLabel: m.notif_rimg_source(),
    type: 'success',
    title,
    message,
    icon,
    priority: 60,
    createdAt: Date.now(),
    dedupeKey: key,
    action: 'room-image-wizard',
  });
}

/** Startet die Beobachtung. Gibt eine Funktion zum Anhalten zurück. */
export function watchRoomImageJobs(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick(): Promise<void> {
    if (stopped) return;
    const jobId = activeJobId();
    if (!jobId) refreshStage(false);
    if (jobId) {
      try {
        const response = await fetch(`/api/room-image-jobs/${jobId}`);
        if (response.ok) {
          const job = await response.json() as {
            kind?: string; status?: string; asset?: { assetId?: string } | null;
          };
          /* Solange etwas läuft, dreht sich das Zeichen in der Kopfzeile. */
          refreshStage(job.status === 'queued' || job.status === 'running');
          /* Zwei Wartepunkte, an denen der Assistent den Menschen braucht:
             die Entwürfe zur Auswahl und der fertige Satz zur Übernahme. */
          if (job.kind === 'main_candidates' && job.status === 'succeeded') {
            announce(`room-image:draft:${jobId}`, m.notif_rimg_draft_title(), m.notif_rimg_draft_msg(), 'i-creation');
          }
          if (job.status === 'awaiting_confirmation') {
            announce(`room-image:ready:${jobId}`, m.notif_rimg_ready_title(), m.notif_rimg_ready_msg(), 'i-creation');
          }
          if (job.asset?.assetId) void watchFinishing(job.asset.assetId);
        }
      } catch { /* Netz weg: der nächste Durchgang versucht es erneut. */ }
    }
    if (!stopped) timer = setTimeout(() => void tick(), JOB_INTERVAL_MS);
  }

  const finishing = new Set<string>();

  /* Der Feinschliff läuft weiter, nachdem der Auftrag abgeschlossen ist — er
     hat deshalb Vorrang vor dem Jobzustand. Ohne diese eine Stelle löschte der
     nächste Durchgang die Anzeige, während noch gearbeitet wird. */
  function refreshStage(jobRunning: boolean): void {
    setRoomImageStage(finishing.size > 0 ? 'regions' : jobRunning ? 'set' : null);
  }

  async function watchFinishing(assetId: string): Promise<void> {
    if (finishing.has(assetId) || announced().has(`room-image:finished:${assetId}`)) return;
    finishing.add(assetId);
    setRoomImageStage('regions');

    for (let attempt = 0; attempt < FINISH_TRIES && !stopped; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, FINISH_INTERVAL_MS));
      if (stopped) break;
      try {
        const response = await fetch('/api/room-image-assets');
        if (!response.ok) continue;
        const body = await response.json() as {
          assets?: { assetId: string; regions?: { regions?: unknown[] } | null }[];
        };
        const entry = body.assets?.find((asset) => asset.assetId === assetId);
        if ((entry?.regions?.regions?.length ?? 0) > 0) {
          announce(
            `room-image:finished:${assetId}`,
            m.notif_rimg_finished_title(),
            m.notif_rimg_finished_msg(),
            'i-weather-rainy',
          );
          break;
        }
      } catch { /* weiter versuchen */ }
    }
    finishing.delete(assetId);
    if (finishing.size === 0) refreshStage(false);
  }

  void tick();
  return () => {
    stopped = true;
    setRoomImageStage(null);
    if (timer !== undefined) clearTimeout(timer);
  };
}
