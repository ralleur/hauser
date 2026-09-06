/* Native-Brücke der Companion-App (Plan 21, §10).

   Die App-Hülle stellt `window.HauserNative` bereit; im Browser und auf dem
   Wandpanel fehlt es. Jede Fähigkeit hat hier ein No-op, damit die Oberfläche
   überall gleich aufgerufen werden kann. Neue Fähigkeit = dieses Interface
   erweitern, in der App implementieren, `BRIDGE_VERSION` anheben. */

export const BRIDGE_VERSION = 1;

export type HapticKind = 'selection' | 'impact' | 'success' | 'warning';

export interface HauserNativeBridge {
  readonly version: number;
  readonly platform: 'ios' | 'android';
  haptic(kind: HapticKind): void;
  /** Öffnet die Kopplung neu, z. B. nach einem Widerruf. */
  unpair?(): void;
}

declare global {
  interface Window { HauserNative?: HauserNativeBridge }
}

const NOOP: HauserNativeBridge = Object.freeze({
  version: 0,
  platform: 'android',
  haptic() { /* im Browser gibt es keine Haptik */ },
});

export function nativeBridge(): HauserNativeBridge {
  if (typeof window === 'undefined') return NOOP;
  return window.HauserNative ?? NOOP;
}

export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && !!window.HauserNative;
}
