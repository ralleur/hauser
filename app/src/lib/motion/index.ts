/* ── Motion-System ──

   Eine Stelle für Bewegung: Dauern und Kurven kommen aus den Design-Tokens
   (`design-tokens/tokens.css`, `--duration-*` und `--ease-*`), damit CSS,
   Svelte-Transitions, Web-Animations und View-Transitions dieselben Werte
   nutzen. `prefers-reduced-motion` ist bereits in den Tokens abgebildet (alle
   Dauern 0 ms); JS-Pfade prüfen zusätzlich `prefersReducedMotion()` und
   überspringen dann die Animation statt eine 0-ms-Animation zu starten.

   Bausteine:
   - `tokenDuration` / `tokenEasing`   Tokenwerte lesen (mit Fallback ohne DOM)
   - `withViewTransition`              Screen-/Ansichtswechsel als View Transition
   - `animateElement`                  Web-Animations mit Token-Dauer und -Kurve
   - `slideFade`                       Svelte-Transition für Screenwechsel (Phone)
   - `createSpring`                    Federphysik für Werte, die dem Finger folgen */

import { tick } from 'svelte';
import { cubicInOut, cubicOut } from 'svelte/easing';
import { Spring } from 'svelte/motion';
import type { TransitionConfig } from 'svelte/transition';

export type DurationToken = 'instant' | 'fast' | 'quick' | 'normal' | 'slow' | 'enter' | 'wobble' | 'correct' | 'tabfade';
export type EasingToken = 'out' | 'in' | 'in-out' | 'spring';

/* Fallbacks spiegeln design-tokens/tokens.css; sie greifen nur ohne DOM
   (Tests) oder wenn ein Token fehlt. */
export const DURATION_FALLBACK_MS: Record<DurationToken, number> = {
  instant: 0, fast: 80, quick: 120, normal: 180, slow: 240, enter: 300, wobble: 200, correct: 300, tabfade: 200,
};

export const EASING_FALLBACK: Record<EasingToken, string> = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  'in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Liest eine CSS-Custom-Property am Knoten (oder am Dokument). */
export function tokenValue(node: Element | null, name: string): string {
  if (typeof getComputedStyle !== 'function') return '';
  const target = node ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!target) return '';
  try { return getComputedStyle(target).getPropertyValue(name).trim(); } catch { return ''; }
}

export function parseDurationMs(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (text.endsWith('ms')) { const n = Number.parseFloat(text); return Number.isFinite(n) ? n : null; }
  if (text.endsWith('s')) { const n = Number.parseFloat(text); return Number.isFinite(n) ? n * 1000 : null; }
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

/** Dauer eines Tokens in Millisekunden; unter reduced motion liefern die Tokens 0. */
export function tokenDuration(node: Element | null, token: DurationToken): number {
  return parseDurationMs(tokenValue(node, `--duration-${token}`)) ?? DURATION_FALLBACK_MS[token];
}

/** Kurve eines Tokens als CSS-Wert (für Web Animations und Inline-Styles). */
export function tokenEasing(node: Element | null, token: EasingToken): string {
  return tokenValue(node, `--ease-${token}`) || EASING_FALLBACK[token];
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void> };
};

export interface ViewTransitionOptions {
  /** Erzwingt den Sofortpfad (z. B. während eines Drags). */
  skip?: boolean;
  doc?: Document | null;
}

/** Führt `update` innerhalb einer View Transition aus, wenn der Browser sie
    kann und der Nutzer Bewegung nicht reduziert hat; sonst sofort. Die
    Rückgabe wartet in beiden Fällen, bis das DOM den neuen Zustand zeigt. */
export function withViewTransition(update: () => void | Promise<void>, options: ViewTransitionOptions = {}): Promise<void> {
  const doc = (options.doc === undefined ? (typeof document === 'undefined' ? null : document) : options.doc) as ViewTransitionDocument | null;
  if (options.skip || !doc?.startViewTransition || prefersReducedMotion()) {
    const result = update();
    return Promise.resolve(result).then(() => tick());
  }
  try {
    return doc.startViewTransition(update).finished.catch(() => undefined);
  } catch {
    const result = update();
    return Promise.resolve(result).then(() => tick());
  }
}

export interface AnimateOptions {
  duration?: DurationToken | number;
  easing?: EasingToken | string;
  fill?: FillMode;
  delay?: number;
}

/** Web-Animations-Helfer: Token-Dauer und -Kurve, respektiert reduced motion,
    löst auf, wenn die Animation fertig ist (oder sofort, wenn keine läuft). */
export function animateElement(node: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, options: AnimateOptions = {}): Promise<void> {
  const duration = typeof options.duration === 'number' ? options.duration : tokenDuration(node, options.duration ?? 'normal');
  if (duration <= 0 || prefersReducedMotion() || typeof (node as HTMLElement).animate !== 'function') return Promise.resolve();
  const easing = options.easing && options.easing in EASING_FALLBACK ? tokenEasing(node, options.easing as EasingToken) : (options.easing ?? tokenEasing(node, 'out'));
  const animation = (node as HTMLElement).animate(keyframes, { duration, easing, fill: options.fill ?? 'both', delay: options.delay ?? 0 });
  return animation.finished.then(() => undefined, () => undefined);
}

export interface SlideFadeOptions {
  /** +1 schiebt von rechts herein, −1 von links; 0 nur Fade. */
  direction?: number;
  /** Spacing-Token für die Strecke. */
  distanceToken?: string;
  duration?: DurationToken;
}

/** Svelte-Transition für Screenwechsel: Opacity plus kurzer Versatz in
    Wischrichtung. Für `in:` und `out:` gleichermaßen; `out` läuft mit
    negiertem Versatz, damit der alte Screen in dieselbe Richtung weicht. */
export function slideFade(node: Element, options: SlideFadeOptions = {}): TransitionConfig {
  const direction = options.direction ?? 0;
  const shift = Number.parseFloat(tokenValue(node, options.distanceToken ?? '--space-6')) || 0;
  return {
    duration: tokenDuration(node, options.duration ?? 'slow'),
    easing: cubicInOut,
    css: (t, u) => `opacity:${t};transform:translate3d(${direction * u * shift}px,0,0)`,
  };
}

/** Sanfter Fade für kleine Zustandswechsel (Badges, Hinweise). */
export function fade(node: Element, options: { duration?: DurationToken } = {}): TransitionConfig {
  return {
    duration: tokenDuration(node, options.duration ?? 'normal'),
    easing: cubicOut,
    css: (t) => `opacity:${t}`,
  };
}

export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  precision?: number;
}

/* Voreinstellungen: `touch` folgt dem Finger ohne sichtbares Nachschwingen,
   `settle` darf beim Loslassen leicht überschwingen (wie --ease-spring). */
export const SPRING_PRESETS = {
  touch: { stiffness: 0.3, damping: 0.9, precision: 0.01 },
  settle: { stiffness: 0.15, damping: 0.6, precision: 0.01 },
} as const satisfies Record<string, Required<SpringOptions>>;

/** Federwert für Gesten; unter reduced motion springt er ohne Physik ans Ziel. */
export function createSpring(initial: number, options: SpringOptions | keyof typeof SPRING_PRESETS = 'settle'): Spring<number> {
  const resolved = typeof options === 'string' ? SPRING_PRESETS[options] : { ...SPRING_PRESETS.settle, ...options };
  const spring = new Spring(initial, resolved);
  if (prefersReducedMotion()) { spring.stiffness = 1; spring.damping = 1; }
  return spring;
}
