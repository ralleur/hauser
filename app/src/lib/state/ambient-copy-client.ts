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

function storageKey(base: string, locale: string): string {
  return locale === 'de' ? base : `${base}:${locale}`;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AmbientCopyClientState {
  lines: readonly string[];
  source: 'cache' | 'llm' | 'fallback';
  fingerprint: string;
  generatedAt: number;
  locale: string;
}

interface ClientOptions {
  fetcher?: typeof fetch;
  storage?: KeyValueStorage | null;
  url?: () => string;
  model?: () => string;
  locale?: () => string;
}

interface CachedCopy {
  lines: string[];
  fingerprint: string;
  generatedAt: number;
  locale: string;
}

function parseHistory(storage: KeyValueStorage | null, locale: string): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(AMBIENT_HISTORY_KEY, locale)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(-20)
      : [];
  } catch { return []; }
}

function parseCache(storage: KeyValueStorage | null, locale: string): CachedCopy | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(CACHE_KEY, locale)) ?? 'null') as Partial<CachedCopy> | null;
    if (!parsed || !Array.isArray(parsed.lines) || !parsed.lines.every((line) => typeof line === 'string')) return null;
    if (typeof parsed.fingerprint !== 'string' || typeof parsed.generatedAt !== 'number' || parsed.locale !== locale) return null;
    return { lines: parsed.lines, fingerprint: parsed.fingerprint, generatedAt: parsed.generatedAt, locale };
  } catch { return null; }
}

function save(storage: KeyValueStorage | null, state: AmbientCopyClientState, history: string[]): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey(CACHE_KEY, state.locale), JSON.stringify({
      lines: state.lines, fingerprint: state.fingerprint, generatedAt: state.generatedAt,
      locale: state.locale,
    }));
    storage.setItem(storageKey(AMBIENT_HISTORY_KEY, state.locale), JSON.stringify(history.slice(-20)));
  } catch { /* Cache ist best-effort. */ }
}

export function createAmbientCopyClient(options: ClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const storage = options.storage === undefined
    ? (typeof localStorage === 'undefined' ? null : localStorage)
    : options.storage;
  const url = options.url ?? (() => AMBIENT_LLM_DEFAULT_URL);
  const model = options.model ?? (() => AMBIENT_LLM_DEFAULT_MODEL);
  const locale = options.locale ?? (() => 'de');
  const initialLocale = locale();
  const cached = parseCache(storage, initialLocale);
  const state: AmbientCopyClientState = cached
    ? { ...cached, source: 'cache' }
    : { lines: [], source: 'fallback', fingerprint: '', generatedAt: 0, locale: initialLocale };
  let history = parseHistory(storage, initialLocale);
  let inflightFingerprint: string | null = null;

  async function request(context: AmbientAnalysis, retry: boolean, activeLocale: string): Promise<string | null> {
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
        messages: buildAmbientCopyMessages(context, history, retry, activeLocale),
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
    const activeLocale = locale();
    const context = analyzeAmbientContext(events, weather, now);
    const fingerprint = `${ambientGenerationFingerprint(context)}|${url()}|${model()}|${activeLocale}`;
    const fallback = generateAmbientCopy(events, weather, now, activeLocale).lines;
    if (state.locale !== activeLocale) {
      state.lines = fallback;
      state.source = 'fallback';
      state.fingerprint = '';
      state.generatedAt = 0;
      state.locale = activeLocale;
      history = parseHistory(storage, activeLocale);
    }
    if (state.lines.length === 0) {
      state.lines = fallback;
      state.source = 'fallback';
      state.fingerprint = fingerprint;
    }
    if (state.fingerprint === fingerprint && now.getTime() - state.generatedAt <= MAX_AGE_MS) return;
    if (inflightFingerprint === fingerprint) return;
    inflightFingerprint = fingerprint;

    try {
      let raw = await request(context, false, activeLocale);
      if (locale() !== activeLocale) return;
      let lines = raw ? sanitizeAmbientLlmCopy(raw, history, context) : null;
      if (!lines) {
        raw = await request(context, true, activeLocale);
        if (locale() !== activeLocale) return;
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
      if (locale() !== activeLocale) return;
      state.lines = fallback;
      state.source = 'fallback';
      state.fingerprint = fingerprint;
      state.generatedAt = now.getTime();
    } finally {
      if (inflightFingerprint === fingerprint) inflightFingerprint = null;
    }
  }

  return { state, refresh };
}
