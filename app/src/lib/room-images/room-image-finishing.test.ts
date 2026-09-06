import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
import { createRoomImageFinisher } from '../../../server/room-image-finishing.mjs';

/* Paket 13: Nach dem Wizard sollen Flächen und trübe Fassung ohne Umweg über
   die Nacht entstehen. Geprüft wird, was dabei schiefgehen kann: doppelte
   Arbeit, Parallelaufrufe beim Anbieter, ein Fehlschlag, der den nächsten
   Schritt mitreißt. */

function storeWith(entries: Record<string, unknown>) {
  return { activeEntry: (assetId: string) => entries[assetId] ?? null };
}

describe('Feinschliff nach der Veröffentlichung', () => {
  it('erkennt Flächen und leitet die trübe Fassung ab', async () => {
    const detectRegions = vi.fn(async () => ({ ok: true }));
    const deriveOvercast = vi.fn(async () => ({ ok: true, status: 'written' }));
    const finisher = createRoomImageFinisher({
      assetStore: storeWith({ a: { assetId: 'a', files: {} } }),
      detectRegions,
      deriveOvercast,
    });

    const state = await finisher.finish('a');

    expect(state.regions).toBe('done');
    expect(state.overcast).toBe('done');
    expect(detectRegions).toHaveBeenCalledWith('a');
    expect(deriveOvercast).toHaveBeenCalledWith('a');
  });

  it('überspringt, was der Katalog schon hat', async () => {
    const detectRegions = vi.fn(async () => ({ ok: true }));
    const deriveOvercast = vi.fn(async () => ({ ok: true }));
    const finisher = createRoomImageFinisher({
      assetStore: storeWith({ a: { assetId: 'a', regions: { regions: [] }, files: { overcast: 'x.avif' } } }),
      detectRegions,
      deriveOvercast,
    });

    const state = await finisher.finish('a');

    expect(state.regions).toBe('already');
    expect(state.overcast).toBe('already');
    expect(detectRegions).not.toHaveBeenCalled();
    expect(deriveOvercast).not.toHaveBeenCalled();
  });

  it('lässt die trübe Fassung auch dann entstehen, wenn die Erkennung scheitert', async () => {
    const finisher = createRoomImageFinisher({
      assetStore: storeWith({ a: { assetId: 'a', files: {} } }),
      detectRegions: async () => ({ ok: false, code: 'PROVIDER_RATE_LIMITED' }),
      deriveOvercast: async () => ({ ok: true }),
    });

    const state = await finisher.finish('a');

    expect(state.regions).toBe('failed');
    expect(state.codes.regions).toBe('PROVIDER_RATE_LIMITED');
    expect(state.overcast).toBe('done');
  });

  it('fängt einen geworfenen Fehler ab, statt den Lauf zu sprengen', async () => {
    const finisher = createRoomImageFinisher({
      assetStore: storeWith({ a: { assetId: 'a', files: {} } }),
      detectRegions: async () => { throw new Error('Netz weg'); },
      deriveOvercast: async () => ({ ok: true }),
    });

    const state = await finisher.finish('a');

    expect(state.regions).toBe('failed');
    expect(state.codes.regions).toBe('FINISH_FAILED');
    expect(state.status).toBe('done');
  });

  it('arbeitet mehrere Sets nacheinander ab — nie zwei Anbieteraufrufe zugleich', async () => {
    let live = 0;
    let peak = 0;
    const busy = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return { ok: true };
    };
    const finisher = createRoomImageFinisher({
      assetStore: storeWith({
        a: { assetId: 'a', files: {} }, b: { assetId: 'b', files: {} }, c: { assetId: 'c', files: {} },
      }),
      detectRegions: busy,
      deriveOvercast: busy,
    });

    await Promise.all([finisher.finish('a'), finisher.finish('b'), finisher.finish('c')]);

    expect(peak).toBe(1);
  });

  it('teilt sich einen Durchgang, wenn dasselbe Set zweimal angestoßen wird', async () => {
    const detectRegions = vi.fn(async () => ({ ok: true }));
    const finisher = createRoomImageFinisher({
      assetStore: storeWith({ a: { assetId: 'a', files: {} } }),
      detectRegions,
      deriveOvercast: async () => ({ ok: true }),
    });

    const [first, second] = await Promise.all([finisher.finish('a'), finisher.finish('a')]);

    expect(first).toBe(second);
    expect(detectRegions).toHaveBeenCalledTimes(1);
  });

  it('macht nichts aus einem Set, das der Katalog nicht kennt', async () => {
    const detectRegions = vi.fn(async () => ({ ok: true }));
    const finisher = createRoomImageFinisher({
      assetStore: storeWith({}),
      detectRegions,
      deriveOvercast: async () => ({ ok: true }),
    });

    const state = await finisher.finish('weg');

    expect(state.regions).toBe('skipped');
    expect(detectRegions).not.toHaveBeenCalled();
  });

  it('meldet den laufenden Feinschliff, solange er hängt', async () => {
    let release: () => void = () => {};
    const finisher = createRoomImageFinisher({
      assetStore: storeWith({ a: { assetId: 'a', files: {} } }),
      detectRegions: () => new Promise((resolve) => { release = () => resolve({ ok: true }); }),
      deriveOvercast: async () => ({ ok: true }),
    });

    const done = finisher.finish('a');
    await Promise.resolve();
    expect(finisher.pending()).toEqual(['a']);

    release();
    await done;
    await finisher.idle();
    expect(finisher.pending()).toEqual([]);
    expect(finisher.state('a')?.status).toBe('done');
  });
});
