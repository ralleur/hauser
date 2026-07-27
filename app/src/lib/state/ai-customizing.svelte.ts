/* ============================================
   AI Customizing (reaktiver Zustand) — Browser-Client für Hermes v0.18.2.
   Agentläufe verwenden die entkoppelte Runs-API; Sessions bleiben die
   serverseitige Source of Truth für Transkript und Marker.
   ============================================ */

import {
  AI_SESSION_STATUS_LABEL,
  CONTINUE_PREFIX,
  INTERNAL_IMPLEMENTATION_CONTINUE,
  LS_ACTIVE_RUN,
  LS_DRAFT,
  LS_SESSION,
  activityPhaseForTool,
  classifyRunStatus,
  createSseParser,
  decideRunPollHttp,
  deriveTranscriptState,
  firstMessage,
  isHmiSession,
  isInternalRunMessage,
  isTitleOnlyResponse,
  newSessionId,
  normalizeRunEvent,
  parseMarkers,
  projectVisibleTranscriptRows,
  rollbackMessage,
  sessionTitle,
  shouldArchiveResumedSession,
  shouldResetMissingSession,
  whimsicalActivity,
  type ActivityPhase,
  type AiSessionStatus,
  type TranscriptMessage,
} from './ai-customizing.ts';
import { settingsUi } from './settings.svelte.ts';

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Storage blockiert/voll: best-effort */ }
}

// Migration vom früheren Browser-Bearer-Design: alte Werte aktiv entfernen.
lsSet('hmi:ai-hermes-key', null);
lsSet('hmi:ai-hermes-url', null);

interface ActiveRunBinding { sessionId: string; runId: string }

function readActiveRun(): ActiveRunBinding | null {
  const raw = lsGet(LS_ACTIVE_RUN);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (isHmiSession(value.sessionId as string) && typeof value.runId === 'string' && value.runId.trim()) {
      return { sessionId: value.sessionId as string, runId: value.runId };
    }
  } catch { /* beschädigter Storage-Wert */ }
  lsSet(LS_ACTIVE_RUN, null);
  return null;
}

let activeRun = readActiveRun();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let activityTimer: ReturnType<typeof setInterval> | null = null;
let lastUserText = '';
let activityStep = 0;
let activityPhase: ActivityPhase = 'starting';
let persistedFeatureTitle = '';
let automaticContinuationSessionId: string | null = null;

function persistActiveRun(binding: ActiveRunBinding | null): void {
  activeRun = binding;
  lsSet(LS_ACTIVE_RUN, binding ? JSON.stringify(binding) : null);
  aiChat.activeRunId = binding?.runId ?? null;
}

function stopPolling(): void {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  aiChat.polling = false;
}

export function hermesBaseUrl(): string {
  return '/hermes';
}

function authHeaders(): Record<string, string> {
  return {};
}

export const aiHealth = $state({
  status: 'unknown' as 'unknown' | 'ok' | 'offline' | 'unauthorized',
  checking: false,
});

export async function checkAiHealth(): Promise<void> {
  if (aiHealth.checking) return;
  aiHealth.checking = true;
  try {
    const health = await fetch(`${hermesBaseUrl()}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) { aiHealth.status = 'offline'; return; }
    const probe = await fetch(`${hermesBaseUrl()}/api/sessions?limit=1`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    aiHealth.status = probe.status === 401 ? 'unauthorized' : probe.ok ? 'ok' : 'offline';
  } catch {
    aiHealth.status = 'offline';
  } finally {
    aiHealth.checking = false;
  }
}

export interface AiFeatureSession {
  id: string;
  title: string;
  lastActive: string | null;
  status: AiSessionStatus;
  statusLabel: string;
  messageCount: number;
}

export const aiSessions = $state({
  list: [] as AiFeatureSession[],
  loading: false,
  error: null as string | null,
});

function messagesFromRows(rows: Record<string, unknown>[]): AiChatMessage[] {
  return projectVisibleTranscriptRows(rows)
    .map((message) => {
      const wireText = message.content;
      if (message.role === 'user') {
        return { role: 'user', text: displayUserText(wireText), wireText, markers: [] };
      }
      const { cleanText, markers } = parseMarkers(wireText);
      return { role: 'assistant', text: cleanText, wireText, markers };
    });
}

export async function loadAiSessions(): Promise<void> {
  aiSessions.loading = true;
  aiSessions.error = null;
  try {
    const response = await fetch(`${hermesBaseUrl()}/api/sessions?source=api_server&limit=200`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      aiSessions.error = response.status === 401 ? 'Server-Anmeldung fehlerhaft' : `Historie nicht ladbar (${response.status})`;
      return;
    }
    const body = await response.json() as { data?: Record<string, unknown>[] };
    const sessions = (body.data ?? []).filter((session) => isHmiSession(session.id as string));
    aiSessions.list = await Promise.all(sessions.map(async (session) => {
      let status: AiSessionStatus = 'active';
      try {
        const messagesResponse = await fetch(`${hermesBaseUrl()}/api/sessions/${session.id}/messages`, {
          headers: authHeaders(),
          signal: AbortSignal.timeout(8000),
        });
        if (messagesResponse.ok) {
          const messagesBody = await messagesResponse.json() as { data?: Record<string, unknown>[] };
          const transcript = deriveTranscriptState(messagesFromRows(messagesBody.data ?? []));
          status = transcript.rolledBack ? 'rolled_back' : 'active';
        }
      } catch { /* Fehler dieser Session isolieren; restliche Historie bleibt nutzbar */ }
      return {
        id: session.id as string,
        title: (session.title as string | null) || 'Unbenanntes Feature',
        lastActive: (session.last_active as string | null) ?? (session.started_at as string | null),
        status,
        statusLabel: AI_SESSION_STATUS_LABEL[status],
        messageCount: (session.message_count as number | null) ?? 0,
      };
    }));
  } catch {
    aiSessions.error = 'Hermes nicht erreichbar';
  } finally {
    aiSessions.loading = false;
  }
}

export interface AiChatMessage extends TranscriptMessage {}

const storedSession = activeRun?.sessionId ?? lsGet(LS_SESSION);
if (activeRun) lsSet(LS_SESSION, activeRun.sessionId);
export const aiChat = $state({
  sessionId: storedSession,
  featureName: null as string | null,
  rolledBack: false,
  messages: [] as AiChatMessage[],
  loading: false,
  streaming: false,
  polling: false,
  activeRunId: activeRun?.sessionId === storedSession ? activeRun.runId : null as string | null,
  streamText: '',
  activity: null as string | null,
  technicalActivity: null as string | null,
  debug: false,
  error: null as string | null,
  deployed: false,
  failed: null as { stage: string; detail: string } | null,
  pendingChoice: null as { name: string; current: string; originalText: string } | null,
  draft: lsGet(LS_DRAFT) ?? '',
});

export function aiChatBusy(): boolean {
  return aiChat.loading || aiChat.streaming || aiChat.polling || aiChat.activeRunId !== null;
}

export function setAiDraft(text: string): void {
  aiChat.draft = text;
  lsSet(LS_DRAFT, text || null);
}

export function setAiDebug(on: boolean): void {
  aiChat.debug = on;
}

function displayUserText(content: string): string {
  if (isInternalRunMessage(content)) return '';
  return content.replace(/^\[Session-ID: [^\]]+\]\n\n/, '');
}

function applyTranscriptState(fallbackTitle: string | null = aiChat.featureName, markReload = false): void {
  const state = deriveTranscriptState(aiChat.messages);
  aiChat.featureName = state.featureName ?? fallbackTitle;
  aiChat.rolledBack = state.rolledBack;
  aiChat.pendingChoice = state.pendingChoice;
  aiChat.deployed = state.deployed;
  aiChat.failed = state.failed;
  lastUserText = state.lastUserText;
  if (markReload && (state.deployed || state.rolledBack)) settingsUi.needsReload = true;
}

function stopActivityRotation(): void {
  if (activityTimer) { clearInterval(activityTimer); activityTimer = null; }
}

function advanceWhimsicalActivity(): void {
  aiChat.activity = whimsicalActivity(activityPhase, activityStep++);
}

function setActivityPhase(phase: ActivityPhase): void {
  if (activityPhase !== phase) {
    activityPhase = phase;
    activityStep = 0;
  }
  advanceWhimsicalActivity();
  if (!activityTimer) {
    activityTimer = setInterval(() => advanceWhimsicalActivity(), 8000);
  }
}

async function persistFeatureName(name: string): Promise<void> {
  const title = name.replace(/\s+/g, ' ').trim();
  const sessionId = aiChat.sessionId;
  if (!sessionId || !title || title === persistedFeatureTitle) return;
  persistedFeatureTitle = title;
  aiChat.featureName = title;
  try {
    const response = await fetch(`${hermesBaseUrl()}/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title }),
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) void loadAiSessions();
  } catch { /* Der abgeleitete Name bleibt im laufenden UI; Historie behält ihren Fallback. */ }
}

function applyFeatureMarkers(text: string): void {
  const feature = parseMarkers(text).markers.find((marker) => marker.type === 'feature');
  if (feature?.type === 'feature') void persistFeatureName(feature.name);
}

export function openAiSection(): void {
  void checkAiHealth();
  void loadAiSessions();
  if (aiChat.sessionId && !aiChat.messages.length && !aiChat.loading) {
    void resumeAiSession(aiChat.sessionId, true);
  }
}

export async function resumeAiSession(id: string, archiveTerminalOnLoad = false): Promise<void> {
  if (aiChatBusy() && aiChat.sessionId !== id) return;
  stopPolling();
  aiChat.sessionId = id;
  lsSet(LS_SESSION, id);
  aiChat.messages = [];
  aiChat.featureName = null;
  aiChat.rolledBack = false;
  aiChat.pendingChoice = null;
  aiChat.deployed = false;
  aiChat.failed = null;
  aiChat.error = null;
  aiChat.activeRunId = activeRun?.sessionId === id ? activeRun.runId : null;
  aiChat.loading = true;
  try {
    const [sessionResponse, messagesResponse] = await Promise.all([
      fetch(`${hermesBaseUrl()}/api/sessions/${id}`, { headers: authHeaders(), signal: AbortSignal.timeout(8000) }),
      fetch(`${hermesBaseUrl()}/api/sessions/${id}/messages`, { headers: authHeaders(), signal: AbortSignal.timeout(8000) }),
    ]);
    let serverTitle: string | null = null;
    if (sessionResponse.ok) {
      const body = await sessionResponse.json() as { session?: { title?: string | null } };
      serverTitle = body.session?.title || null;
    }
    if (shouldResetMissingSession(messagesResponse.status)) {
      if (activeRun?.sessionId === id) persistActiveRun(null);
      resetAiSessionState();
      return;
    }
    if (!messagesResponse.ok) {
      aiChat.error = messagesResponse.status === 401 ? 'Server-Anmeldung fehlerhaft' : `Verlauf nicht ladbar (${messagesResponse.status})`;
      return;
    }
    const body = await messagesResponse.json() as { data?: Record<string, unknown>[] };
    aiChat.messages = messagesFromRows(body.data ?? []);
    applyTranscriptState(serverTitle);
    persistedFeatureTitle = aiChat.featureName ?? '';
    if (archiveTerminalOnLoad && shouldArchiveResumedSession(aiChat, activeRun?.sessionId === id)) {
      resetAiSessionState();
      return;
    }
  } catch {
    aiChat.error = 'Hermes nicht erreichbar';
  } finally {
    aiChat.loading = false;
  }
  if (activeRun?.sessionId === id) startRunPolling(activeRun.runId, id, true);
}

function resetAiSessionState(): void {
  stopPolling();
  stopActivityRotation();
  aiChat.sessionId = null;
  aiChat.featureName = null;
  aiChat.rolledBack = false;
  aiChat.messages = [];
  aiChat.pendingChoice = null;
  aiChat.deployed = false;
  aiChat.failed = null;
  aiChat.error = null;
  aiChat.streaming = false;
  aiChat.streamText = '';
  aiChat.activity = null;
  aiChat.technicalActivity = null;
  aiChat.activeRunId = null;
  persistedFeatureTitle = '';
  automaticContinuationSessionId = null;
  lsSet(LS_SESSION, null);
}

export function closeAiSession(): void {
  if (aiChatBusy()) return;
  resetAiSessionState();
}

function conversationHistory(messages: AiChatMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  return messages.map((message) => ({ role: message.role, content: message.wireText }));
}

const RUN_PROTOCOL_INSTRUCTIONS = `Halte dich strikt an das HMI-Markerprotokoll aus SOUL.md.
Wenn die aktuelle Eingabe mit [HMI-INTERN] beginnt, wiederhole keinen feature-Marker, sondern
starte die bereits angefragte Umsetzung unmittelbar mit dem ersten passenden Werkzeugaufruf.
Andernfalls ist dies der Titel-Handshake: Leite einen kurzen deutschen Feature-Namen ab und
beende diese Antwort ausschließlich mit der alleinstehenden feature-Markerzeile. Die HMI
startet den Umsetzungs-Run danach automatisch und ohne weitere sichtbare Nutzernachricht.
Außer beim beschriebenen Titel-Handshake muss jede finale Antwort als letzte eigene Zeile genau den zum Ergebnis passenden Marker enthalten:
deployed nach erfolgreichem Push und Deploy, rolled_back nach erfolgreichem Rollback,
failed bei jedem Fehler oder new_feature bei einer erforderlichen Feature-Trennung.
Formuliere den sichtbaren Abschlusstext kurz und nichttechnisch: keine Dateinamen, Befehle,
Hashes, Toolnamen oder internen Warnungen. Lasse den Marker niemals wegen einer
nachgelagerten Verifikation oder Warnung weg.`;

export async function sendAiMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || aiChatBusy()) return;
  aiChat.error = null;

  let sessionId = aiChat.sessionId;
  let payloadText = trimmed;
  try {
    if (!sessionId) {
      sessionId = newSessionId();
      const title = sessionTitle(trimmed);
      const created = await fetch(`${hermesBaseUrl()}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: sessionId, title }),
        signal: AbortSignal.timeout(8000),
      });
      if (!created.ok) { aiChat.error = `Session nicht anlegbar (${created.status})`; return; }
      aiChat.sessionId = sessionId;
      aiChat.featureName = title;
      aiChat.rolledBack = false;
      aiChat.messages = [];
      lsSet(LS_SESSION, sessionId);
      payloadText = firstMessage(sessionId, trimmed);
    }
  } catch {
    aiChat.error = 'Hermes nicht erreichbar';
    return;
  }

  const history = conversationHistory(aiChat.messages);
  const priorMessages = aiChat.messages;
  lastUserText = trimmed;
  aiChat.messages = [...aiChat.messages, {
    role: 'user', text: displayUserText(payloadText), wireText: payloadText, markers: [],
  }];
  applyTranscriptState();
  setAiDraft('');
  activityStep = 0;
  activityPhase = 'starting';
  setActivityPhase('starting');
  aiChat.technicalActivity = 'Run wird gestartet…';

  try {
    const response = await fetch(`${hermesBaseUrl()}/v1/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        input: payloadText,
        session_id: sessionId,
        conversation_history: history,
        instructions: RUN_PROTOCOL_INSTRUCTIONS,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      aiChat.messages = priorMessages;
      applyTranscriptState();
      stopActivityRotation();
      aiChat.activity = null;
      aiChat.error = response.status === 401 ? 'Server-Anmeldung fehlerhaft' : `Run nicht startbar (${response.status})`;
      return;
    }
    const body = await response.json() as { run_id?: string; id?: string };
    const runId = body.run_id ?? body.id;
    if (!runId) {
      aiChat.messages = priorMessages;
      applyTranscriptState();
      stopActivityRotation();
      aiChat.activity = null;
      aiChat.error = 'Hermes lieferte keine Run-ID.';
      return;
    }
    persistActiveRun({ sessionId, runId });
    await streamRunEvents(runId, sessionId);
  } catch {
    aiChat.messages = priorMessages;
    applyTranscriptState();
    stopActivityRotation();
    aiChat.activity = null;
    aiChat.error = 'Hermes nicht erreichbar';
  }
}

function finishAssistantTurn(content: string): void {
  const canonical = projectVisibleTranscriptRows([{ role: 'assistant', content }])[0]?.content ?? '';
  if (!canonical) return;
  const last = aiChat.messages[aiChat.messages.length - 1];
  if (last?.role === 'assistant' && last.wireText === canonical) return;
  const { cleanText, markers } = parseMarkers(canonical);
  aiChat.messages = [...aiChat.messages, { role: 'assistant', text: cleanText, wireText: canonical, markers }];
  applyFeatureMarkers(canonical);
  applyTranscriptState(aiChat.featureName, true);
  if (markers.length) void loadAiSessions();
}

function clearRun(runId: string): void {
  stopPolling();
  stopActivityRotation();
  if (activeRun?.runId === runId) persistActiveRun(null);
  aiChat.streaming = false;
  aiChat.streamText = '';
  aiChat.activity = null;
  aiChat.technicalActivity = null;
}

async function streamRunEvents(runId: string, sessionId: string): Promise<void> {
  aiChat.streaming = true;
  aiChat.polling = false;
  aiChat.streamText = '';
  setActivityPhase('starting');
  aiChat.technicalActivity = 'Agent arbeitet…';
  let terminal = false;
  let continueAfterTitle = false;
  try {
    const response = await fetch(`${hermesBaseUrl()}/v1/runs/${runId}/events`, { headers: authHeaders() });
    if (!response.ok || !response.body) throw new Error('event stream unavailable');
    const parser = createSseParser((event) => {
      const normalized = normalizeRunEvent(event.data);
      if (normalized.type === 'message.delta') {
        aiChat.streamText += normalized.delta;
        applyFeatureMarkers(aiChat.streamText);
      } else if (normalized.type === 'tool.started') {
        const preview = typeof event.data.preview === 'string' ? event.data.preview : '';
        setActivityPhase(activityPhaseForTool(normalized.toolName, preview));
        aiChat.technicalActivity = `Führt aus: ${normalized.toolName || 'Werkzeug'}`;
      } else if (normalized.type === 'tool.completed') {
        advanceWhimsicalActivity();
        aiChat.technicalActivity = `Abgeschlossen: ${normalized.toolName || 'Werkzeug'}`;
      } else if (normalized.type === 'reasoning.available') {
        advanceWhimsicalActivity();
        aiChat.technicalActivity = 'Denkt nach…';
      } else if (normalized.type === 'approval.request') {
        aiChat.technicalActivity = 'Wartet auf Freigabe…';
      } else if (normalized.type === 'run.completed') {
        terminal = true;
        const output = normalized.output || aiChat.streamText;
        continueAfterTitle = isTitleOnlyResponse(output);
        finishAssistantTurn(output);
        clearRun(runId);
      } else if (normalized.type === 'run.failed' || normalized.type === 'run.cancelled') {
        terminal = true;
        aiChat.error = normalized.error || 'Agent-Run fehlgeschlagen.';
        clearRun(runId);
      }
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      if (terminal) break;
    }
  } catch { /* Der entkoppelte Run bleibt aktiv; Status-Recovery übernimmt sofort. */ }
  finally {
    aiChat.streaming = false;
    aiChat.streamText = '';
    if (!terminal && activeRun?.runId === runId && aiChat.sessionId === sessionId) {
      startRunPolling(runId, sessionId, true);
    }
  }
  if (continueAfterTitle) await continueImplementationAfterTitle(sessionId);
}

async function continueImplementationAfterTitle(sessionId: string): Promise<void> {
  if (aiChat.sessionId !== sessionId) return;
  if (automaticContinuationSessionId === sessionId) {
    aiChat.error = 'Der Agent hat die Umsetzung nicht gestartet.';
    return;
  }
  automaticContinuationSessionId = sessionId;
  await sendAiMessage(INTERNAL_IMPLEMENTATION_CONTINUE);
}

const POLL_INTERVAL_MS = 5000;

function startRunPolling(runId: string, sessionId: string, immediate = false): void {
  stopPolling();
  if (activeRun?.runId !== runId || aiChat.sessionId !== sessionId) return;
  aiChat.polling = true;
  if (activityPhase === 'starting') setActivityPhase('working');
  else advanceWhimsicalActivity();
  aiChat.technicalActivity = 'Run-Status wird geprüft…';
  const poll = async (): Promise<void> => {
    if (activeRun?.runId !== runId || aiChat.sessionId !== sessionId || aiChat.streaming) return;
    try {
      const response = await fetch(`${hermesBaseUrl()}/v1/runs/${runId}`, {
        headers: authHeaders(), signal: AbortSignal.timeout(8000),
      });
      const decision = decideRunPollHttp(response.status);
      if (decision === 'unauthorized') {
        aiChat.error = 'Server-Anmeldung fehlerhaft';
      } else if (decision === 'missing') {
        aiChat.error = 'Der aktive Run ist nach dem Gateway-Neustart nicht mehr verfügbar.';
        clearRun(runId);
        return;
      } else if (decision === 'retry') {
        advanceWhimsicalActivity();
        aiChat.technicalActivity = `Run-Status nicht abrufbar (${response.status}) — wird weiter überwacht…`;
      } else {
        const body = await response.json() as { status?: string; output?: string; error?: string };
        const statusClass = classifyRunStatus(body.status);
        if (statusClass === 'completed') {
          const output = body.output ?? '';
          const continueAfterTitle = isTitleOnlyResponse(output);
          finishAssistantTurn(output);
          clearRun(runId);
          if (continueAfterTitle) await continueImplementationAfterTitle(sessionId);
          return;
        }
        if (statusClass === 'failed') {
          aiChat.error = body.error || `Agent-Run beendet (${body.status ?? 'unbekannt'}).`;
          clearRun(runId);
          return;
        }
        advanceWhimsicalActivity();
        aiChat.technicalActivity = body.status === 'waiting_for_approval' ? 'Wartet auf Freigabe…' : 'Agent arbeitet…';
      }
    } catch {
      advanceWhimsicalActivity();
      aiChat.technicalActivity = 'Verbindung unterbrochen — Run wird weiter überwacht…';
    }
    pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  };
  pollTimer = setTimeout(() => void poll(), immediate ? 0 : POLL_INTERVAL_MS);
}

export function chooseNewSession(): void {
  const choice = aiChat.pendingChoice;
  if (!choice || aiChatBusy()) return;
  aiChat.pendingChoice = null;
  closeAiSession();
  void sendAiMessage(choice.originalText);
}

export function chooseContinueFeature(): void {
  const choice = aiChat.pendingChoice;
  if (!choice || aiChatBusy()) return;
  aiChat.pendingChoice = null;
  void sendAiMessage(CONTINUE_PREFIX + choice.originalText);
}

export async function requestAiRollback(id: string): Promise<void> {
  if (aiChatBusy()) return;
  if (aiChat.sessionId !== id) await resumeAiSession(id);
  if (aiChatBusy()) return;
  await sendAiMessage(rollbackMessage(id));
}
