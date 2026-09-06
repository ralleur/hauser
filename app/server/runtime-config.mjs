/* ── Laufzeitwerte als Objekt statt als Import (Paket 11, ADR-030) ──

   Die Servermodule lasen ihre Grenzwerte und Pfade bisher direkt aus
   `runtime-env`. Das ist bequem, macht aber jeden Test von der Umgebung des
   ausführenden Rechners abhängig: wer ein anderes Limit prüfen will, muss die
   Umgebungsvariable setzen und den Modulcache leeren.

   `createRuntimeConfig` bündelt die Werte zu einem Objekt, das
   `createHmiServer` einmal baut und an die Module weiterreicht. Die
   Voreinstellung bleibt exakt das, was `runtime-env` liefert — der Unterschied
   ist nur, dass ein Aufrufer sie überschreiben kann. */

import {
  AMBIENT_BODY_MAX,
  AMBIENT_MAP_HA_BODY_MAX,
  AMBIENT_MAP_HA_TIMEOUT_MS,
  AMBIENT_MODEL,
} from './runtime-env.mjs';

/** @typedef {{ ambientBodyMax: number, ambientModel: string, ambientMapHaBodyMax: number, ambientMapHaTimeoutMs: number }} RuntimeConfig */

/** @returns {RuntimeConfig} */
export function createRuntimeConfig(overrides = {}) {
  return Object.freeze({
    ambientBodyMax: AMBIENT_BODY_MAX,
    ambientModel: AMBIENT_MODEL,
    ambientMapHaBodyMax: AMBIENT_MAP_HA_BODY_MAX,
    ambientMapHaTimeoutMs: AMBIENT_MAP_HA_TIMEOUT_MS,
    ...overrides,
  });
}

/** Voreinstellung für Aufrufer ohne eigene Konfiguration. */
export const DEFAULT_RUNTIME_CONFIG = createRuntimeConfig();
