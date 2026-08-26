import { AMBIENT_LLM_DEFAULT_MODEL, AMBIENT_LLM_DEFAULT_URL, createAmbientCopyClient } from './ambient-copy-client.ts';
import type { CalendarEvent } from './calendar.ts';
import type { OutdoorReading } from './weather.ts';
import { localeState } from './locale.svelte.ts';

function configuredUrl(): string { return AMBIENT_LLM_DEFAULT_URL; }
function configuredModel(): string { return AMBIENT_LLM_DEFAULT_MODEL; }

const client = createAmbientCopyClient({ url: configuredUrl, model: configuredModel, locale: () => localeState.current });

export const ambientCopy = $state({
  lines: [...client.state.lines] as string[],
  source: client.state.source,
  locale: client.state.locale,
});

function syncState(): void {
  ambientCopy.lines = [...client.state.lines];
  ambientCopy.source = client.state.source;
  ambientCopy.locale = client.state.locale;
}

/* Startet nur best-effort im Hintergrund. Der Client setzt bei leerem Cache den
   lokalen Fallback synchron vor dem ersten await; die UI wartet nie auf Ollama. */
export function refreshAmbientCopy(
  events: readonly CalendarEvent[],
  weather: OutdoorReading,
  now = new Date(),
): void {
  const run = client.refresh(events, weather, now);
  syncState();
  void run.finally(syncState);
}
