import { afterEach, describe, expect, it, vi } from 'vitest';

/* Geprüft wird der Gastablauf im Client: Bestätigung vor dem Senden, keine
   Verdopplung, sofortige Neutralisierung — und dass der Gastpfad anonym bleibt. */

async function freshStore() {
  vi.resetModules();
  return await import('../state/hotel-checkout.svelte.ts');
}

function stubFetch(responses: unknown[] = [{ ok: true, status: 200 }]) {
  const calls: { url: string; init: any }[] = [];
  const impl = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const response = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Gast-Checkout im Client', () => {
  it('verlangt erst die Bestätigung, bevor irgendetwas gesendet wird', async () => {
    const calls = stubFetch();
    const store = await freshStore();

    expect(store.hotelCheckout.phase).toBe('idle');
    store.askHotelCheckout();
    expect(store.hotelCheckout.phase).toBe('confirming');
    expect(calls).toEqual([]);

    store.cancelHotelCheckout();
    expect(store.hotelCheckout.phase).toBe('idle');
    expect(calls).toEqual([]);
  });

  it('schickt den bestätigten Checkout anonym an den Gastpfad', async () => {
    const calls = stubFetch();
    const getItem = vi.fn(() => 'ha-token');
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn(), removeItem: vi.fn() });
    const store = await freshStore();

    store.askHotelCheckout();
    expect(await store.confirmHotelCheckout()).toBe(true);

    expect(calls[0].url).toBe(store.HOTEL_CHECKOUT_ENDPOINT);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('omit');
    expect(getItem).not.toHaveBeenCalled();
    expect(store.hotelCheckout.phase).toBe('done');
  });

  it('verdoppelt nichts, wenn ein zweiter Klick kommt', async () => {
    const calls = stubFetch();
    const store = await freshStore();

    const first = store.confirmHotelCheckout();
    const second = store.confirmHotelCheckout();

    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(calls.length).toBe(1);

    // Auch danach bleibt es bei genau einem Request.
    expect(await store.confirmHotelCheckout()).toBe(false);
    expect(calls.length).toBe(1);
  });

  it('lässt einen abgelehnten Checkout wiederholbar, statt ihn als Erfolg zu zeigen', async () => {
    const calls = stubFetch([{ ok: false, status: 503 }, { ok: true, status: 200 }]);
    const store = await freshStore();

    expect(await store.confirmHotelCheckout()).toBe(false);
    expect(store.hotelCheckout.phase).toBe('failed');

    expect(await store.confirmHotelCheckout()).toBe(true);
    expect(store.hotelCheckout.phase).toBe('done');
    expect(calls.length).toBe(2);
  });

  it('behandelt einen Netzwerkausfall wie eine Ablehnung', async () => {
    stubFetch([new Error('offline')]);
    const store = await freshStore();

    expect(await store.confirmHotelCheckout()).toBe(false);
    expect(store.hotelCheckout.phase).toBe('failed');
  });

  it('bietet nach dem Checkout keinen weiteren an', async () => {
    stubFetch();
    const store = await freshStore();

    await store.confirmHotelCheckout();
    store.askHotelCheckout();

    expect(store.hotelCheckout.phase).toBe('done');
  });
});
