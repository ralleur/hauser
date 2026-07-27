import {
  ambientGenerationFingerprint,
  analyzeAmbientContext,
  buildAmbientCopyMessages,
  generateAmbientCopy,
  sanitizeAmbientLlmCopy,
  type AmbientAnalysis,
} from './ambient-copy.ts';
import type { CalendarEvent } from './calendar.ts';
import type { OutdoorReading } from './weather.ts';

export const AMBIENT_LLM_DEFAULT_URL = '/ambient-llm/v1';
export const AMBIENT_LLM_DEFAULT_MODEL = 'gpt-5.6-luna';
export const AMBIENT_HISTORY_KEY = 'hmi:ambient-copy-history-v2';
const CACHE_KEY = 'hmi:ambient-copy-cache-v2';
const MAX_AGE_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 90_000;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AmbientCopyClientState {
  lines: readonly string[];
  source: 'cache' | 'llm' | 'fallback';
  fingerprint: string;
  generatedAt: number;
}

interface ClientOptions {
  fetcher?: typeof fetch;
  storage?: KeyValueStorage | null;
  url?: () => string;
  model?: () => string;
}

interface CachedCopy {
  lines: string[];
  fingerprint: string;
  generatedAt: number;
}

function parseHistory(storage: KeyValueStorage | null): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(AMBIENT_HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(-20)
      : [];
  } catch { return []; }
}

function parseCache(storage: KeyValueStorage | null): CachedCopy | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(CACHE_KEY) ?? 'null') as Partial<CachedCopy> | null;
    if (!parsed || !Array.isArray(parsed.lines) || !parsed.lines.every((line) => typeof line === 'string')) return null;
    if (typeof parsed.fingerprint !== 'string' || typeof parsed.generatedAt !== 'number') return null;
    return { lines: parsed.lines, fingerprint: parsed.fingerprint, generatedAt: parsed.generatedAt };
  } catch { return null; }
}

function save(storage: KeyValueStorage | null, state: AmbientCopyClientState, history: string[]): void {
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({
      lines: state.lines, fingerprint: state.fingerprint, generatedAt: state.generatedAt,
    }));
    storage.setItem(AMBIENT_HISTORY_KEY, JSON.stringify(history.slice(-20)));
  } catch { /* Cache ist best-effort. */ }
}

export function createAmbientCopyClient(options: ClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const storage = options.storage === undefined
    ? (typeof localStorage === 'undefined' ? null : localStorage)
    : options.storage;
  const url = options.url ?? (() => AMBIENT_LLM_DEFAULT_URL);
  const model = options.model ?? (() => AMBIENT_LLM_DEFAULT_MODEL);
  const cached = parseCache(storage);
  const state: AmbientCopyClientState = cached
    ? { ...cached, source: 'cache' }
    : { lines: [], source: 'fallback', fingerprint: '', generatedAt: 0 };
  let history = parseHistory(storage);
  let inflightFingerprint: string | null = null;

  async function request(context: AmbientAnalysis, retry: boolean): Promise<string | null> {
    const response = await fetcher(`${url().replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: model(),
        stream: false,
        temperature: 0.85,
        top_p: 0.9,
        max_tokens: 80,
        messages: buildAmbientCopyMessages(context, history, retry),
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : null;
  }

  async function refresh(
    events: readonly CalendarEvent[],
    weather: OutdoorReading,
    now = new Date(),
  ): Promise<void> {
    const context = analyzeAmbientContext(events, weather, now);
    const fingerprint = `${ambientGenerationFingerprint(context)}|${url()}|${model()}`;
    const fallback = generateAmbientCopy(events, weather, now).lines;
    if (state.lines.length === 0) {
      state.lines = fallback;
      state.source = 'fallback';
      state.fingerprint = fingerprint;
    }
    if (state.fingerprint === fingerprint && now.getTime() - state.generatedAt <= MAX_AGE_MS) return;
    if (inflightFingerprint === fingerprint) return;
    inflightFingerprint = fingerprint;

    try {
      let raw = await request(context, false);
      let lines = raw ? sanitizeAmbientLlmCopy(raw, history, context) : null;
      if (!lines) {
        raw = await request(context, true);
        lines = raw ? sanitizeAmbientLlmCopy(raw, history, context) : null;
      }
      if (!lines) {
        state.lines = fallback;
        state.source = 'fallback';
        state.fingerprint = fingerprint;
        state.generatedAt = now.getTime();
        return;
      }
      const text = lines.join('\n');
      history = [...history.filter((old) => old !== text), text].slice(-20);
      state.lines = lines;
      state.source = 'llm';
      state.fingerprint = fingerprint;
      state.generatedAt = now.getTime();
      save(storage, state, history);
    } catch {
      state.lines = fallback;
      state.source = 'fallback';
      state.fingerprint = fingerprint;
      state.generatedAt = now.getTime();
    } finally {
      inflightFingerprint = null;
    }
  }

  return { state, refresh };
}
