/* ============================================
   Demo-Raumbilder — der Assistent und die Bildset-Bibliothek mit
   vorbereiteten Daten (docs/12).

   Der Raumbild-Assistent ruft im Betrieb OpenAI auf. Die öffentliche Demo hat
   weder Companion-Server noch Konto, soll den Ablauf aber vollständig zeigen.
   Deshalb wird hier nicht `fetch` abgefangen wie im übrigen Demo-Modus: die
   Zwischenstände sind Bild-URLs, die als `<img src>` gerendert werden und am
   Shim vorbeilaufen. Stattdessen liefert dieses Modul dieselbe API-Oberfläche
   aus statischen Projekt-Assets.

   Statt eines eigenen Uploads wählt der Besucher eines der mitgelieferten
   Beispielfotos; als „erzeugtes" Bildset dienen die Projekt-Hintergründe
   desselben Raums.
   ============================================ */

import { m } from '../../paraglide/messages.js';
import type {
  RoomImageApi,
  RoomImageAsset,
  RoomImageCapability,
  RoomImageCapabilityDetails,
  RoomImageFocus,
  RoomImageJob,
  RoomImageJobKind,
  RoomImageJobPhase,
  RoomImageJobStatus,
  RoomImageUpload,
} from '../state/room-image-client.ts';
import type { RoomImageLibrary, RoomImageLibraryAsset } from '../state/room-image-library-client.ts';

const BASE = import.meta.env.BASE_URL;

const DEMO_ROOMS = ['wohnzimmer', 'kueche', 'bad', 'schlafzimmer', 'kinderzimmer', 'flur'] as const;
type DemoRoom = (typeof DEMO_ROOMS)[number];

const ROOM_LABEL: Readonly<Record<DemoRoom, () => string>> = {
  wohnzimmer: m.demo_room_wohnzimmer,
  kueche: m.demo_room_kueche,
  bad: m.demo_room_bad,
  schlafzimmer: m.demo_room_schlafzimmer,
  kinderzimmer: m.demo_room_kinderzimmer,
  flur: m.demo_room_flur,
};

export interface DemoRoomImageSource {
  id: DemoRoom;
  label: string;
  url: string;
}

function sourceUrl(room: DemoRoom): string {
  return `${BASE}rooms/${room}.webp`;
}

function variantUrls(room: DemoRoom): { light: string; dark: string; darkOff: string } {
  return {
    light: `${BASE}hero/${room}-light.avif`,
    dark: `${BASE}hero/${room}-dark.avif`,
    darkOff: `${BASE}hero/${room}-dark-off.avif`,
  };
}

/** Auswahlliste für den Assistenten anstelle des Datei-Uploads. */
export function demoRoomImageSources(): DemoRoomImageSource[] {
  return DEMO_ROOMS.map((id) => ({ id, label: ROOM_LABEL[id](), url: sourceUrl(id) }));
}

let selectedRoom: DemoRoom = DEMO_ROOMS[0];

/** Der Assistent meldet die getroffene Wahl, bevor er das Foto „hochlädt". */
export function selectDemoRoomImageSource(id: string): void {
  if ((DEMO_ROOMS as readonly string[]).includes(id)) selectedRoom = id as DemoRoom;
}

/* ── Kennungen im Format des echten Dienstes, damit die UI unverändert bleibt ── */

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
let idCounter = 0;

function opaqueId(): string {
  idCounter += 1;
  const seed = `demo${idCounter}`;
  let value = seed;
  while (value.length < 43) value += ID_ALPHABET[(value.length * 7 + idCounter) % ID_ALPHABET.length];
  return value.slice(0, 43);
}

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

/* ── Simulierter Job ── */

interface DemoJob {
  job: RoomImageJob;
  room: DemoRoom;
  timers: ReturnType<typeof setTimeout>[];
}

interface DemoStep {
  afterMs: number;
  status: RoomImageJobStatus;
  phase: RoomImageJobPhase;
  started: number;
  completed: number;
}

const MAIN_STEPS: readonly DemoStep[] = [
  { afterMs: 700, status: 'running', phase: 'generating_composition', started: 1, completed: 0 },
  { afterMs: 1_900, status: 'running', phase: 'generating_style_1', started: 2, completed: 1 },
  { afterMs: 3_200, status: 'succeeded', phase: 'complete', started: 2, completed: 2 },
];

const FINAL_STEPS: readonly DemoStep[] = [
  { afterMs: 700, status: 'running', phase: 'generating_dark', started: 1, completed: 0 },
  { afterMs: 1_800, status: 'running', phase: 'generating_dark_off', started: 2, completed: 1 },
  { afterMs: 2_600, status: 'running', phase: 'validating_set', started: 2, completed: 2 },
  { afterMs: 3_300, status: 'awaiting_confirmation', phase: 'awaiting_confirmation', started: 2, completed: 2 },
];

const jobs = new Map<string, DemoJob>();

function counters(planned: number, started: number, completed: number): RoomImageJob['providerCalls'] {
  const aggregate = { plannedCount: planned, startedCount: started, completedCount: completed, outcomeUnknownCount: 0 };
  return {
    attempt: { confirmedCount: planned, ...aggregate },
    lineage: { ...aggregate },
    wizard: { ...aggregate },
  };
}

function baseJob(kind: RoomImageJobKind, clientRequestId: string, planned: number): RoomImageJob {
  return {
    jobId: opaqueId(),
    kind,
    clientRequestId,
    attemptId: opaqueId(),
    parentAttemptId: null,
    lineageId: opaqueId(),
    status: 'queued',
    phase: 'queued',
    createdAt: iso(),
    updatedAt: iso(),
    expiresAt: iso(60 * 60 * 1_000),
    cancellable: true,
    retryable: false,
    discardable: false,
    retry: null,
    supersededByJobId: null,
    providerCalls: counters(planned, 0, 0),
    candidates: [],
    asset: null,
    error: null,
  };
}

function schedule(entry: DemoJob, steps: readonly DemoStep[], planned: number, onFinal: (job: RoomImageJob) => void): void {
  for (const step of steps) {
    entry.timers.push(setTimeout(() => {
      entry.job.status = step.status;
      entry.job.phase = step.phase;
      entry.job.updatedAt = iso();
      entry.job.providerCalls = counters(planned, step.started, step.completed);
      entry.job.cancellable = step.status === 'running' || step.status === 'queued';
      if (step === steps[steps.length - 1]) onFinal(entry.job);
    }, step.afterMs));
  }
}

function clearTimers(entry: DemoJob): void {
  for (const timer of entry.timers) clearTimeout(timer);
  entry.timers = [];
}

/* ── Bibliothek ── */

const DEFAULT_FOCUS: RoomImageFocus = { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } };

function libraryAsset(room: DemoRoom, focus: RoomImageFocus, ageDays: number): RoomImageLibraryAsset {
  return {
    assetId: `demo-${room}`,
    variants: variantUrls(room),
    focus,
    createdAt: iso(-ageDays * 24 * 60 * 60 * 1_000),
    byteLength: 2_400_000,
    assignedRoomIds: [],
  };
}

const library: RoomImageLibraryAsset[] = [
  libraryAsset('wohnzimmer', DEFAULT_FOCUS, 12),
  libraryAsset('kueche', DEFAULT_FOCUS, 5),
];

function snapshot(): RoomImageLibrary {
  return {
    assets: library.map((asset) => ({ ...asset, assignedRoomIds: [...asset.assignedRoomIds] })),
    totalByteLength: library.reduce((sum, asset) => sum + asset.byteLength, 0),
    householdEtag: `"demo-${library.length}"`,
  };
}

export function demoRoomImageLibrary(): RoomImageLibrary {
  return snapshot();
}

export function demoAssignRoomImage(roomId: string, assetId: string | null): void {
  for (const asset of library) {
    asset.assignedRoomIds = asset.assignedRoomIds.filter((id) => id !== roomId);
    if (assetId && asset.assetId === assetId) asset.assignedRoomIds.push(roomId);
  }
}

export function demoDeleteRoomImageAsset(assetId: string): void {
  const index = library.findIndex((asset) => asset.assetId === assetId);
  if (index >= 0) library.splice(index, 1);
}

/* ── API-Oberfläche ── */

const CAPABILITY: RoomImageCapability = { enabled: true, imageCapability: 'ready', reasonCode: null };

const CAPABILITY_DETAILS: RoomImageCapabilityDetails = {
  enabled: true,
  provider: 'openai',
  credentialConfigured: true,
  credentialSource: 'stored',
  credentialMode: 'chatgpt',
  imageCapability: 'ready',
  reasonCode: null,
  model: 'gpt-image-2',
  probe: { modelVisible: true, checkedAt: iso() },
  limits: {
    maxUploadBytes: 12_582_912,
    maxDecodedPixels: 40_000_000,
    maxMainCandidates: 2,
    maxConcurrentProviderCalls: 1,
    maxQueuedJobs: 3,
  },
};

async function imageSize(data: Blob | ArrayBuffer): Promise<{ width: number; height: number }> {
  try {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 1_600, height: 900 };
  }
}

export function createDemoRoomImageApi(): RoomImageApi {
  return {
    getCapability: async () => ({ ...CAPABILITY }),
    getCapabilityDetails: async () => ({ ...CAPABILITY_DETAILS }),
    probeCapability: async () => ({ ...CAPABILITY_DETAILS }),

    upload: async (data, mimeType): Promise<RoomImageUpload> => {
      const { width, height } = await imageSize(data);
      return { uploadId: opaqueId(), width, height, mimeType, expiresAt: iso(30 * 60 * 1_000) };
    },
    deleteUpload: async () => { /* Der Demo-Upload hält nichts vor. */ },

    createJob: async (request) => {
      const room = selectedRoom;
      if (request.kind === 'main_candidates') {
        const job = baseJob('main_candidates', request.clientRequestId, 2);
        const entry: DemoJob = { job, room, timers: [] };
        jobs.set(job.jobId, entry);
        schedule(entry, MAIN_STEPS, 2, (final) => {
          final.cancellable = false;
          final.candidates = [{
            candidateId: opaqueId(),
            previewUrl: variantUrls(room).light,
            suggestedRoomId: null,
          }];
        });
        return { ...job };
      }
      const parent = jobs.get(request.parentJobId);
      const job = baseJob('variant_set', request.clientRequestId, 2);
      const entry: DemoJob = { job, room: parent?.room ?? room, timers: [] };
      jobs.set(job.jobId, entry);
      schedule(entry, FINAL_STEPS, 2, (final) => {
        final.cancellable = false;
        final.temporaryVariants = variantUrls(entry.room);
        final.focus = request.focus;
      });
      return { ...job };
    },

    getJob: async (jobId) => {
      const entry = jobs.get(jobId);
      if (!entry) throw new Error('Der Demo-Auftrag ist abgelaufen.');
      return { ...entry.job };
    },

    retryJob: async (jobId, request) => {
      const entry = jobs.get(jobId);
      if (!entry) throw new Error('Der Demo-Auftrag ist abgelaufen.');
      clearTimers(entry);
      const job = baseJob(entry.job.kind, request.clientRequestId, 2);
      const retried: DemoJob = { job, room: entry.room, timers: [] };
      jobs.set(job.jobId, retried);
      const steps = entry.job.kind === 'main_candidates' ? MAIN_STEPS : FINAL_STEPS;
      schedule(retried, steps, 2, (final) => {
        final.cancellable = false;
        if (entry.job.kind === 'main_candidates') {
          final.candidates = [{
            candidateId: opaqueId(),
            previewUrl: variantUrls(retried.room).light,
            suggestedRoomId: null,
          }];
        } else {
          final.temporaryVariants = variantUrls(retried.room);
          final.focus = DEFAULT_FOCUS;
        }
      });
      return { ...job };
    },

    cancelJob: async (jobId) => {
      const entry = jobs.get(jobId);
      if (!entry) throw new Error('Der Demo-Auftrag ist abgelaufen.');
      clearTimers(entry);
      entry.job.status = 'cancelled';
      entry.job.phase = 'complete';
      entry.job.cancellable = false;
      entry.job.discardable = true;
      entry.job.candidates = [];
      entry.job.updatedAt = iso();
      entry.job.error = { code: 'CANCELLED', message: m.rimg_term_cancelled() };
      return { ...entry.job };
    },

    discardJob: async (jobId) => {
      const entry = jobs.get(jobId);
      if (entry) clearTimers(entry);
      jobs.delete(jobId);
    },

    publishJob: async (jobId): Promise<RoomImageAsset> => {
      const entry = jobs.get(jobId);
      if (!entry) throw new Error('Der Demo-Auftrag ist abgelaufen.');
      const focus = entry.job.focus ?? DEFAULT_FOCUS;
      const asset: RoomImageAsset = {
        assetId: `demo-${entry.room}`,
        variants: variantUrls(entry.room),
        focus,
      };
      if (!library.some((existing) => existing.assetId === asset.assetId)) {
        library.unshift(libraryAsset(entry.room, focus, 0));
      }
      entry.job.status = 'succeeded';
      entry.job.phase = 'complete';
      entry.job.cancellable = false;
      entry.job.asset = asset;
      delete entry.job.temporaryVariants;
      delete entry.job.focus;
      entry.job.updatedAt = iso();
      return asset;
    },
  };
}
