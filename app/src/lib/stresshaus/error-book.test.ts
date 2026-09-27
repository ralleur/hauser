import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTILE_ERRORS } from './hostile-home.ts';
// @ts-expect-error Native Node ESM Servermodul.
import { createErrorBook, scrubErrorText, startErrorReports } from '../../../server/error-book.mjs';

/* Das Fehlerbuch im Stresshaus (R58): was draußen schiefgeht, darf das Haus
   nur ohne Namen, Werte und Adressen verlassen, zählt bei Wiederholung hoch
   und wartet, wenn das Postfach nicht antwortet. */

type Entry = { fp: string; where: string; kind: string; detail: string; count: number };

describe('Fehlerbuch', () => {
  afterEach(() => { vi.useRealTimers(); });

  it.each(HOSTILE_ERRORS)('$name: haushaltsfrei im Buch', ({ where, kind, detail, keep, drop }) => {
    const book = createErrorBook();
    book.receive([{ where, kind, detail }], 'web');
    const [entry] = book.list() as Entry[];
    const text = `${entry.where} ${entry.kind} ${entry.detail}`;
    for (const word of keep) expect(text).toContain(word);
    for (const word of drop) expect(text).not.toContain(word);
    expect(entry.detail.length).toBeLessThanOrEqual(240);
  });

  it('tausendmal derselbe Fehler ist eine Zeile mit Zähler', () => {
    const book = createErrorBook();
    for (let i = 0; i < 1000; i += 1) book.note('ha:light', new TypeError(`Wert ${i}.5 ungültig`));
    const entries = book.list() as Entry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(1000);
  });

  it('ein volles Buch lässt den ältesten gehen, nicht den neuen', () => {
    let tick = 0;
    const book = createErrorBook({ max: 3, now: () => new Date(Date.UTC(2026, 8, 27, 0, 0, tick++)).toISOString() });
    for (const where of ['a', 'b', 'c', 'd']) book.note(where, new Error('x'));
    expect((book.list() as Entry[]).map((e) => e.where)).toEqual(['d', 'c', 'b']);
  });

  it('Postfach antwortet nicht: das Buch wartet und schickt beim nächsten Mal', async () => {
    vi.useFakeTimers();
    const book = createErrorBook();
    book.note('server', new Error('kaputt'));
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });
    const stop = startErrorReports(book, { mode: 'auto', send, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(book.unsent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(book.unsent()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(3);
    stop();
  });

  it('ohne HMI_ERROR_REPORTS=auto geht nichts von selbst hinaus', async () => {
    vi.useFakeTimers();
    const book = createErrorBook();
    book.note('server', new Error('kaputt'));
    const send = vi.fn();
    startErrorReports(book, { mode: undefined, send, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
  });

  it('Code bleibt lesbar', () => {
    expect(scrubErrorText("undefined is not an object (evaluating 'state.attributes.brightness')"))
      .toBe("undefined is not an object (evaluating 'state.attributes.brightness')");
  });
});
