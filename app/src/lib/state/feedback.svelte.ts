/* ============================================
   Rückmeldung aus der App (docs/23 R40).
   --------------------------------------------
   Das Fragezeichen oben rechts öffnet ein Blatt: Problem oder Wunsch, ein
   Satz, Senden. Hier lebt nur der Zustand und der Versand; das Blatt selbst
   wird erst geladen, wenn jemand den Knopf drückt.
   ============================================ */
import { IS_DEMO } from '../demo/demo-mode.ts';
import { connection } from './connection.svelte.ts';
import { localeState } from './locale.svelte.ts';
import { nav } from './nav.svelte.ts';

export type FeedbackKind = 'problem' | 'wish';
export type FeedbackOutcome = 'sent' | 'too-many' | 'failed';

export const feedback = $state({ active: false });

export function openFeedback(): void {
  feedback.active = true;
}

export function closeFeedback(): void {
  feedback.active = false;
}

/** Was neben dem Text mitgeht — der Melder sieht es vor dem Senden. */
export function feedbackClientInfo(): { language: string; viewport: string; userAgent: string; screen: string; connection: string } {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  return {
    language: localeState.current,
    viewport: typeof innerWidth === 'number' ? `${innerWidth}×${innerHeight} @${dpr}x` : '',
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    screen: String(nav.screen),
    connection: connection().label,
  };
}

/** Ein Eintrag des Fehlerbuchs, so wie er das Haus verlassen darf (R58). */
export interface ErrorBookEntry { fp: string; source: string; where: string; kind: string; detail: string; count: number; last: string }

/** Was „Fehler mitschicken" anhängen würde — leer in der Demo und ohne Server. */
export async function loadErrorBook(): Promise<ErrorBookEntry[]> {
  if (IS_DEMO) return [];
  try {
    const response = await fetch('/api/errors', { headers: { accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json() as { entries?: ErrorBookEntry[] };
    return Array.isArray(payload.entries) ? payload.entries : [];
  } catch {
    return [];
  }
}

export async function sendFeedback(input: { kind: FeedbackKind; text: string; contact: string; attachErrors?: boolean }): Promise<FeedbackOutcome> {
  /* Die Demo zeigt das Blatt, schickt aber nichts ab. */
  if (IS_DEMO) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return 'sent';
  }
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, ...feedbackClientInfo() }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return 'sent';
    return response.status === 429 ? 'too-many' : 'failed';
  } catch {
    return 'failed';
  }
}
