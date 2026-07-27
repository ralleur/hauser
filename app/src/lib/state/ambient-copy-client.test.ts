import { describe, expect, it, vi } from 'vitest';
import { createAmbientCopyClient, type KeyValueStorage } from './ambient-copy-client.ts';
import type { CalendarEvent } from './calendar.ts';
import type { OutdoorReading } from './weather.ts';

const NOW = new Date('2026-07-16T15:00:00+02:00');
const WEATHER: OutdoorReading = {
  temp: 22, trend: 'steady', tempDelta: 0, condition: 'sunny', windSpeed: 5,
};

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function event(id: string, title = 'Schwimmkurs'): CalendarEvent {
  return {
    id, title,
    start: '2026-07-16T16:00:00+02:00', end: '2026-07-16T17:00:00+02:00',
    allDay: false, location: null, description: null,
  };
}

function response(text: string, ok = true): Response {
  return { ok, json: async () => ({ choices: [{ message: { content: text } }] }) } as Response;
}

describe('ambient copy client', () => {
  it('ruft bei normalen Refreshes nur einmal auf und regeneriert nach einer Stunde', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response('Später werden noch ein paar Bahnen verhandelt.'))
      .mockResolvedValueOnce(response('Der Nachmittag prüft später noch seine Wasserlage.'));
    const client = createAmbientCopyClient({ fetcher, storage: new MemoryStorage() });
    await client.refresh([event('a')], WEATHER, NOW);
    const firstText = client.state.lines.join(' ');
    await client.refresh([event('a')], WEATHER, new Date('2026-07-16T15:30:00+02:00'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.refresh([event('a')], WEATHER, new Date('2026-07-16T16:01:00+02:00'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.state.lines.join(' ')).not.toBe(firstText);
    expect(fetcher.mock.calls[0][0]).toBe('/ambient-llm/v1/chat/completions');
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe('system');
  });

  it('regeneriert, wenn sich der nächste Termin ändert', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response('Später werden noch ein paar Bahnen verhandelt.'))
      .mockResolvedValueOnce(response('Die Abstimmung übernimmt später den Kalender.'));
    const client = createAmbientCopyClient({ fetcher, storage: new MemoryStorage() });
    await client.refresh([event('a')], WEATHER, NOW);
    await client.refresh([event('b', 'Q3 Abstimmung')], WEATHER, NOW);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('behält bei Nichterreichbarkeit und Timeout unmittelbar den lokalen Fallback', async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const client = createAmbientCopyClient({ fetcher, storage: new MemoryStorage() });
    await client.refresh([], WEATHER, NOW);
    expect(client.state.lines.length).toBeGreaterThan(0);
    expect(client.state.source).toBe('fallback');
  });

  it('versucht eine ähnliche oder ungültige Antwort genau einmal neu', async () => {
    const storage = new MemoryStorage();
    storage.setItem('hmi:ambient-copy-history-v2', JSON.stringify([
      'Der Kalender hält sich heute auffällig zurück.',
    ]));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response('Der Kalender hält sich heute weiterhin zurück.'))
      .mockResolvedValueOnce(response('Wenig Termine. Der Nachmittag nimmt es persönlich.'));
    const client = createAmbientCopyClient({ fetcher, storage });
    await client.refresh([], WEATHER, NOW);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.state.lines.join(' ')).toContain('nimmt es persönlich');
    const secondBody = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(secondBody.messages.at(-1).content).toContain('Variation-Hinweis');
  });

  it('speichert höchstens 20 unterschiedliche Botschaften', async () => {
    const storage = new MemoryStorage();
    storage.setItem('hmi:ambient-copy-history-v2', JSON.stringify(
      Array.from({ length: 20 }, (_, index) => `Historische Zeile Nummer ${index}.`),
    ));
    const fetcher = vi.fn().mockResolvedValue(response('Heute verwaltet die Sonne den freien Kalender.'));
    const client = createAmbientCopyClient({ fetcher, storage });
    await client.refresh([], WEATHER, NOW);
    const history = JSON.parse(storage.getItem('hmi:ambient-copy-history-v2') ?? '[]');
    expect(history).toHaveLength(20);
    expect(history.at(-1)).toContain('Sonne');
  });
});
