/* ============================================
   AI Customizing (pure Logik) — Protokoll zwischen Panel und dem Hermes-Agent
   (Profil hmi-customizing, OpenAI-kompatibler API-Server, Port 8642).
   Der Agent hängt Marker-Zeilen `<<HMI:{...}>>` ans Antwortende; hier leben
   Marker-Parsing, der SSE-Zeilenparser und die Session-Konventionen.
   Reaktiver Zustand und fetch-Aufrufe: ai-customizing.svelte.ts.
   Protokoll-Spezifikation: docs/11-ai-customizing.md.
   ============================================ */

export const LS_SESSION = 'hmi:ai-session';
export const LS_DRAFT = 'hmi:ai-draft';
export const LS_ACTIVE_RUN = 'hmi:ai-active-run';
export const INTERNAL_IMPLEMENTATION_CONTINUE = '[HMI-INTERN] Setze den bereits angefragten Feature-Auftrag jetzt vollständig um. Wiederhole den Titelmarker nicht und beende erst mit einem terminalen Ergebnis-Marker.';

/* Session-IDs des Panels tragen ein Prefix, damit die Historie sie von
   anderen api_server-Sessions (z. B. Test-Clients) unterscheiden kann. */
const SESSION_PREFIX = 'hmi_';

export function newSessionId(now = Date.now()): string {
  return `${SESSION_PREFIX}${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isHmiSession(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(SESSION_PREFIX);
}

export function sessionTitle(text: string): string {
  const cleaned = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? 'Titel wird ermittelt…' : 'Neues Feature';
}

export function isInternalRunMessage(text: string): boolean {
  return text.startsWith('[HMI-INTERN]');
}

export function shouldArchiveResumedSession(
  state: Pick<TranscriptState, 'deployed' | 'rolledBack'>,
  hasActiveRun: boolean,
): boolean {
  return !hasActiveRun && (state.deployed || state.rolledBack);
}

export type ActivityPhase = 'starting' | 'working' | 'finishing';

const WHIMSICAL_ACTIVITIES: Record<ActivityPhase, readonly string[]> = {
  starting: [
    'Der Bauplan wird aufgeklappt…',
    'Die Ideen sortieren sich…',
    'Die Pixel nehmen ihre Plätze ein…',
    'Die Werkbank wird vorbereitet…',
    'Ein frischer Plan nimmt Form an…',
    'Die App zieht ihren Werkzeugkittel an…',
    'Die ersten Zahnräder greifen ineinander…',
    'Der Wunsch wird in Bauteile zerlegt…',
    'Die digitale Werkstatt öffnet ihre Türen…',
    'Ein paar gute Ideen werden eingesammelt…',
    'Die Komponenten stimmen sich ab…',
    'Der Startknopf glimmt verheißungsvoll…',
  ],
  working: [
    'Die Pixel schrauben konzentriert weiter…',
    'Im Maschinenraum wird fleißig getüftelt…',
    'Die App probiert ihre neuen Schuhe an…',
    'Ein paar Ecken werden sorgfältig vermessen…',
    'Die Zahnräder drehen ihre Runden…',
    'Der Code bekommt eine ruhige Hand…',
    'Die Bauteile finden Stück für Stück zusammen…',
    'Hinter den Kulissen wird weiter gewerkelt…',
    'Die Ideen werden gerade wetterfest gemacht…',
    'Die Pixel diskutieren über Details…',
    'Die Werkstatt bleibt angenehm beschäftigt…',
    'Das neue Verhalten wird in Form gebracht…',
  ],
  finishing: [
    'Der Endspurt läuft…',
    'Die letzten Schrauben werden nachgezogen…',
    'Das Ziel kommt in Sicht…',
    'Die letzten Kanten werden poliert…',
    'Der Schlusscheck dreht seine Runde…',
    'Die letzten Pixel rücken gerade…',
    'Fast am Ziel — die App prüft noch einmal nach…',
    'Die letzten Handgriffe sitzen…',
    'Der Feinschliff macht seine Abschlussrunde…',
    'Die Zielgerade ist erreicht…',
    'Noch ein letzter Blick unter die Haube…',
    'Die letzten Häkchen werden gesetzt…',
  ],
};

export function whimsicalActivity(phase: ActivityPhase, step: number): string {
  const pool = WHIMSICAL_ACTIVITIES[phase];
  return pool[Math.abs(step) % pool.length];
}

export function activityPhaseForTool(toolName: string, preview: string): ActivityPhase {
  if (toolName !== 'terminal') return 'working';
  const command = preview.toLowerCase();
  return /(?:npm run (?:check|test|build)|git (?:commit|push)|redeploy\.sh|launchctl|produktive assets)/.test(command)
    ? 'finishing'
    : 'working';
}

export interface RawTranscriptRow {
  role?: unknown;
  content?: unknown;
}

const FILE_MUTATION_VERIFIER = '\n\n⚠️ File-mutation verifier:';

export function projectVisibleTranscriptRows(
  rows: readonly RawTranscriptRow[],
): { role: 'user' | 'assistant'; content: string }[] {
  const visible: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const row of rows) {
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string') continue;
    const content = (row.role === 'assistant'
      ? row.content.split(FILE_MUTATION_VERIFIER, 1)[0]
      : row.content).trim();
    if (!content) continue;
    const previous = visible[visible.length - 1];
    if (row.role === 'assistant' && previous?.role === 'assistant' && previous.content === content) continue;
    visible.push({ role: row.role, content });
  }
  return visible;
}

/* ── Marker-Protokoll (Agent → Panel) ──
   Jeder Marker steht als eigene Zeile am Antwortende: <<HMI:{"type":…}>>
   Kaputtes JSON oder unbekannte Typen werden ignoriert — der Text bleibt
   dann einfach sichtbar, nichts bricht. */

export type AiMarker =
  | { type: 'feature'; name: string }
  | { type: 'new_feature'; name: string; current: string }
  | { type: 'deployed'; commits: string[] }
  | { type: 'failed'; stage: string; detail: string }
  | { type: 'rolled_back'; commits: string[] };

const MARKER_LINE = /^<<HMI:(\{.*\})>>\s*$/;

function toMarker(raw: unknown): AiMarker | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  switch (m.type) {
    case 'feature': {
      const name = str(m.name).trim();
      return name ? { type: 'feature', name } : null;
    }
    case 'new_feature': {
      const name = str(m.name).trim();
      return name ? { type: 'new_feature', name, current: str(m.current).trim() } : null;
    }
    case 'deployed': return { type: 'deployed', commits: list(m.commits) };
    case 'failed': return { type: 'failed', stage: str(m.stage), detail: str(m.detail) };
    case 'rolled_back': return { type: 'rolled_back', commits: list(m.commits) };
    default: return null;
  }
}

export interface ParsedReply {
  cleanText: string;
  markers: AiMarker[];
}

export function parseMarkers(text: string): ParsedReply {
  const kept: string[] = [];
  const markers: AiMarker[] = [];
  for (const line of text.split('\n')) {
    const match = MARKER_LINE.exec(line);
    if (match) {
      try {
        const marker = toMarker(JSON.parse(match[1]));
        if (marker) { markers.push(marker); continue; }
      } catch { /* kein valides JSON → Zeile als Text behalten */ }
    }
    kept.push(line);
  }
  return { cleanText: kept.join('\n').trim(), markers };
}

export function isTitleOnlyResponse(text: string): boolean {
  const parsed = parseMarkers(text);
  return parsed.cleanText.trim() === ''
    && parsed.markers.length === 1
    && parsed.markers[0]?.type === 'feature';
}

/* Während des Streamings: Marker-Zeilen ausblenden, auch wenn die letzte
   Zeile erst ein Anfangsstück des Sentinels ist (Chunk-Grenze mitten im
   Marker). Endgültig geparst wird erst der komplette Text. */
export function hideMarkerLines(streamText: string): string {
  const lines = streamText.split('\n');
  const visible = lines.filter((line, i) => {
    if (line.startsWith('<<HMI:')) return false;
    const isLast = i === lines.length - 1;
    if (isLast && line.length > 0 && '<<HMI:'.startsWith(line)) return false;
    return true;
  });
  return visible.join('\n');
}

/* ── SSE-Zeilenparser ──
   Der Hermes-Stream sendet Frames `event: <name>\ndata: <json>\n\n` sowie
   Keepalive-Kommentare `: keepalive`. fetch liefert beliebig geschnittene
   Chunks — der Parser puffert und emittiert nur vollständige Frames. */

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export function createSseParser(onEvent: (ev: SseEvent) => void): { push: (chunk: string) => void } {
  let buffer = '';
  return {
    push(chunk: string): void {
      buffer += chunk;
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue; // Keepalive/Kommentar
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        try {
          const data = JSON.parse(dataLines.join('\n')) as unknown;
          if (typeof data === 'object' && data !== null) {
            const record = data as Record<string, unknown>;
            const embeddedEvent = typeof record.event === 'string' ? record.event : null;
            onEvent({ event: embeddedEvent ?? event, data: record });
          }
        } catch { /* unvollständige/kaputte data-Zeile → Frame verwerfen */ }
      }
    },
  };
}

export type RunStatusClass = 'busy' | 'completed' | 'failed';
export type RunPollHttpDecision = 'read_status' | 'unauthorized' | 'missing' | 'retry';

export function shouldResetMissingSession(status: number): boolean {
  return status === 404;
}

export function decideRunPollHttp(status: number): RunPollHttpDecision {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'missing';
  if (status >= 200 && status < 300) return 'read_status';
  return 'retry';
}

export function classifyRunStatus(status: unknown): RunStatusClass {
  if (status === 'queued' || status === 'running' || status === 'waiting_for_approval' || status === 'stopping') {
    return 'busy';
  }
  return status === 'completed' ? 'completed' : 'failed';
}

export interface NormalizedRunEvent {
  type: string;
  delta: string;
  output: string;
  toolName: string;
  error: string;
}

export function normalizeRunEvent(payload: Record<string, unknown>): NormalizedRunEvent {
  const nested = typeof payload.data === 'object' && payload.data !== null
    ? payload.data as Record<string, unknown>
    : {};
  const stringValue = (key: string): string => {
    const value = payload[key] ?? nested[key];
    return typeof value === 'string' ? value : '';
  };
  return {
    type: stringValue('event'),
    delta: stringValue('delta') || stringValue('content'),
    output: stringValue('output'),
    toolName: stringValue('tool') || stringValue('tool_name') || stringValue('name'),
    error: stringValue('error') || stringValue('message'),
  };
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
  wireText: string;
  markers: AiMarker[];
}

export interface TranscriptState {
  featureName: string | null;
  rolledBack: boolean;
  deployed: boolean;
  failed: { stage: string; detail: string } | null;
  pendingChoice: { name: string; current: string; originalText: string } | null;
  lastUserText: string;
}

export function deriveTranscriptState(messages: TranscriptMessage[]): TranscriptState {
  const state: TranscriptState = {
    featureName: null,
    rolledBack: false,
    deployed: false,
    failed: null,
    pendingChoice: null,
    lastUserText: '',
  };
  let precedingUserText = '';
  for (const message of messages) {
    if (message.role === 'user') {
      precedingUserText = message.text;
      state.lastUserText = message.text;
      state.pendingChoice = null;
      state.deployed = false;
      state.failed = null;
      continue;
    }
    for (const marker of message.markers) {
      if (marker.type === 'feature') state.featureName = marker.name;
      else if (marker.type === 'new_feature') {
        state.pendingChoice = {
          name: marker.name,
          current: marker.current || state.featureName || 'aktuelles Feature',
          originalText: precedingUserText,
        };
      } else if (marker.type === 'deployed') {
        state.deployed = true;
        state.failed = null;
      } else if (marker.type === 'failed') {
        state.deployed = false;
        state.failed = { stage: marker.stage, detail: marker.detail };
      } else if (marker.type === 'rolled_back') {
        state.rolledBack = true;
        state.deployed = false;
        state.failed = null;
      }
    }
  }
  return state;
}

/* ── Session-Status für die Historie ── */

export type AiSessionStatus = 'active' | 'rolled_back';

export const AI_SESSION_STATUS_LABEL: Record<AiSessionStatus, string> = {
  active: 'Aktiv',
  rolled_back: 'Zurückgerollt',
};

export function sessionStatus(endReason: string | null | undefined): AiSessionStatus {
  return endReason === 'rolled_back' ? 'rolled_back' : 'active';
}

/* ── Nachrichten-Konventionen (Panel → Agent, im SOUL.md gespiegelt) ── */

/* Die erste Nachricht trägt die Session-ID als Kontextzeile — der Agent
   braucht sie für den Commit-Trailer `AI-Session: <id>`. */
export function firstMessage(sessionId: string, text: string): string {
  return `[Session-ID: ${sessionId}]\n\n${text}`;
}

/* Override nach der Neues-Feature-Rückfrage: mit diesem Präfix setzt der
   Agent ohne erneute Rückfrage um. */
export const CONTINUE_PREFIX = 'Bitte doch als Teil des aktuellen Features umsetzen: ';

export function rollbackMessage(sessionId: string): string {
  return `Rollback: Mache dieses Feature vollständig rückgängig (./tools/ai-rollback.sh ${sessionId}) und deploye.`;
}
