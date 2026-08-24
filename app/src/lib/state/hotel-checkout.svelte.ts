/* ── Gast-Checkout im Client ──
   Der Server ist die Wahrheit: er persistiert die Markierung, bevor irgendetwas
   anderes passiert. Dieser Store hält nur den lokalen Ablauf — Bestätigung,
   laufender Request und die sofortige Neutralisierung der Oberfläche.

   Ein Gast kann den Checkout nicht rückgängig machen; das Zurücknehmen der
   Markierung ist ausdrücklich Adminsache (docs/hotel-mode-plan.md §8). */

export const HOTEL_CHECKOUT_ENDPOINT = '/api/hotel-mode/checkout';
const HOTEL_CHECKOUT_TIMEOUT_MS = 6000;

export type HotelCheckoutPhase = 'idle' | 'confirming' | 'sending' | 'done' | 'failed';

export interface HotelCheckoutState {
  phase: HotelCheckoutPhase;
}

export const hotelCheckout = $state<HotelCheckoutState>({ phase: 'idle' });

export function askHotelCheckout(): void {
  if (hotelCheckout.phase === 'idle' || hotelCheckout.phase === 'failed') {
    hotelCheckout.phase = 'confirming';
  }
}

export function cancelHotelCheckout(): void {
  if (hotelCheckout.phase === 'confirming') hotelCheckout.phase = 'idle';
}

/**
 * Bestätigter Checkout. Ein zweiter Klick während des laufenden Requests
 * verdoppelt nichts, und der Server behandelt einen wiederholten Request
 * ohnehin idempotent.
 */
export async function confirmHotelCheckout(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (hotelCheckout.phase === 'sending' || hotelCheckout.phase === 'done') return false;
  hotelCheckout.phase = 'sending';
  try {
    const response = await fetchImpl(HOTEL_CHECKOUT_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      // Gastpfad: keine Adminsitzung, kein Token.
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(HOTEL_CHECKOUT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`hotel checkout ${response.status}`);
  } catch {
    hotelCheckout.phase = 'failed';
    return false;
  }
  hotelCheckout.phase = 'done';
  return true;
}
