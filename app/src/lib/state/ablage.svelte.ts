export interface AblageDocument {
  id: number;
  title: string;
  created: string | null;
  added: string | null;
  archiveSerialNumber: number | null;
  originalFileName: string | null;
}

interface AblageResponse {
  count: number;
  next: boolean;
  previous: boolean;
  results: AblageDocument[];
}

export interface AblageProcessingTask {
  id: string;
  fileName: string | null;
  status: 'PENDING' | 'RECEIVED' | 'STARTED' | 'RETRY';
}

interface AblageTasksResponse {
  processing: AblageProcessingTask[];
}

export const ablage = $state({
  configured: true,
  unlocked: false,
  loading: false,
  error: null as string | null,
  documents: [] as AblageDocument[],
  count: 0,
  page: 1,
  next: false,
  previous: false,
  importing: false,
  importCompleted: 0,
  importTotal: 0,
  importMessage: null as string | null,
  processing: [] as AblageProcessingTask[],
  processingError: false,
});

export const ABLAGE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.tif,.tiff,.webp,.heic,.bmp,.gif,.txt,.text,.csv,.srt';
const ABLAGE_EXTENSIONS = new Set(ABLAGE_ACCEPT.split(','));
const ABLAGE_FILE_MAX = 52428800;

let generation = 0;
let processingGeneration = 0;

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    return typeof payload?.error === 'string' ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

export async function enterAblage(): Promise<void> {
  generation += 1;
  processingGeneration += 1;
  ablage.unlocked = false;
  ablage.loading = false;
  ablage.error = null;
  ablage.documents = [];
  ablage.count = 0;
  ablage.page = 1;
  ablage.importing = false;
  ablage.importCompleted = 0;
  ablage.importTotal = 0;
  ablage.importMessage = null;
  ablage.processing = [];
  ablage.processingError = false;
  try {
    const response = await fetch('/api/ablage/lock', { method: 'POST' });
    if (!response.ok) throw new Error(await responseError(response, 'Ablage konnte nicht gesperrt werden'));
    const status = await fetch('/api/ablage/status');
    const payload = await status.json();
    ablage.configured = Boolean(payload.configured);
  } catch (error) {
    ablage.error = error instanceof Error ? error.message : 'Ablage ist nicht erreichbar';
  }
}

export async function leaveAblage(): Promise<void> {
  generation += 1;
  processingGeneration += 1;
  ablage.unlocked = false;
  ablage.documents = [];
  ablage.importing = false;
  ablage.importMessage = null;
  ablage.processing = [];
  ablage.processingError = false;
  try { await fetch('/api/ablage/lock', { method: 'POST', keepalive: true }); } catch { /* Server-Session läuft zusätzlich ab. */ }
}

export async function unlockAblage(pin: string): Promise<boolean> {
  ablage.loading = true;
  ablage.error = null;
  try {
    const response = await fetch('/api/ablage/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!response.ok) throw new Error(await responseError(response, 'Ablage konnte nicht entsperrt werden'));
    ablage.unlocked = true;
    return true;
  } catch (error) {
    ablage.error = error instanceof Error ? error.message : 'Ablage konnte nicht entsperrt werden';
    return false;
  } finally {
    ablage.loading = false;
  }
}

export interface AblageDateRange {
  from: string;
  to: string;
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

export function isAblageFileSupported(file: Pick<File, 'name' | 'size'>): boolean {
  return file.size <= ABLAGE_FILE_MAX && ABLAGE_EXTENSIONS.has(fileExtension(file.name));
}

export async function importAblageFiles(files: File[]): Promise<number> {
  if (!files.length || ablage.importing) return 0;
  const unsupported = files.find((file) => !isAblageFileSupported(file));
  if (unsupported) {
    ablage.error = unsupported.size > ABLAGE_FILE_MAX
      ? `${unsupported.name} ist größer als 50 MiB.`
      : `${unsupported.name} hat ein nicht unterstütztes Dateiformat.`;
    return 0;
  }

  ablage.importing = true;
  ablage.importCompleted = 0;
  ablage.importTotal = files.length;
  ablage.importMessage = null;
  ablage.error = null;
  try {
    for (const file of files) {
      const form = new FormData();
      form.append('document', file, file.name);
      const response = await fetch('/api/ablage/documents/import', { method: 'POST', body: form });
      if (response.status === 401) {
        ablage.unlocked = false;
        ablage.documents = [];
        throw new Error('Sitzung abgelaufen. Bitte PIN erneut eingeben.');
      }
      if (!response.ok) throw new Error(await responseError(response, `${file.name} konnte nicht importiert werden`));
      ablage.importCompleted += 1;
    }
    const count = ablage.importCompleted;
    ablage.importMessage = `${count} ${count === 1 ? 'Datei wurde' : 'Dateien wurden'} zur Verarbeitung übergeben.`;
    return count;
  } catch (error) {
    ablage.error = error instanceof Error ? error.message : 'Dateien konnten nicht importiert werden';
    return ablage.importCompleted;
  } finally {
    ablage.importing = false;
  }
}

export async function refreshAblageProcessing(): Promise<void> {
  if (!ablage.unlocked) return;
  const requestGeneration = ++processingGeneration;
  try {
    const response = await fetch('/api/ablage/tasks', { cache: 'no-store' });
    if (response.status === 401) {
      ablage.unlocked = false;
      ablage.documents = [];
      throw new Error('Sitzung abgelaufen');
    }
    if (!response.ok) throw new Error('Verarbeitungsstatus nicht verfügbar');
    const payload = await response.json() as AblageTasksResponse;
    if (requestGeneration !== processingGeneration) return;
    const processing = Array.isArray(payload.processing) ? payload.processing : [];
    const previous = ablage.processing.map((task) => `${task.id}:${task.status}:${task.fileName ?? ''}`).join('|');
    const next = processing.map((task) => `${task.id}:${task.status}:${task.fileName ?? ''}`).join('|');
    if (previous !== next) ablage.processing = processing;
    ablage.processingError = false;
  } catch {
    if (requestGeneration !== processingGeneration) return;
    ablage.processing = [];
    ablage.processingError = true;
  }
}

export async function searchAblage(query: string, page = 1, range?: AblageDateRange): Promise<void> {
  const requestGeneration = ++generation;
  ablage.loading = true;
  ablage.error = null;
  try {
    const params = new URLSearchParams({ query: query.trim(), page: String(page) });
    if (range?.from) params.set('from', range.from);
    if (range?.to) params.set('to', range.to);
    const response = await fetch(`/api/ablage/documents?${params}`);
    if (response.status === 401) {
      ablage.unlocked = false;
      throw new Error('Sitzung abgelaufen. Bitte PIN erneut eingeben.');
    }
    if (!response.ok) throw new Error(await responseError(response, 'Dokumente konnten nicht geladen werden'));
    const payload = await response.json() as AblageResponse;
    if (requestGeneration !== generation) return;
    ablage.documents = payload.results;
    ablage.count = payload.count;
    ablage.page = page;
    ablage.next = payload.next;
    ablage.previous = payload.previous;
  } catch (error) {
    if (requestGeneration !== generation) return;
    ablage.error = error instanceof Error ? error.message : 'Dokumente konnten nicht geladen werden';
  } finally {
    if (requestGeneration === generation) ablage.loading = false;
  }
}
