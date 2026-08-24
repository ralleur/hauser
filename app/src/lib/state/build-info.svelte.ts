/* ── Lizenz- und Quellcode-Herkunft für die Oberfläche ──
   Die Build-Werte stecken im Bundle (Vite `define`), damit auch eine rein
   statische Auslieferung ohne HMI-Server Version, Revision und Source-URL
   zeigen kann. Läuft der HMI-Server, gewinnen dessen Werte feldweise — nur so
   kann ein Deployment `HMI_SOURCE_URL` auf seinen eigenen Fork umbiegen.

   Kein externer Abruf, keine Telemetrie: die Anzeige ist offline vollständig. */

import {
  mergeBuildInfo,
  parseBuildInfo,
  resolveBuildInfo,
  type BuildInfo,
} from '../config/build-info.ts';

/* Von vite.config.ts zur Bauzeit ersetzt; in reinen Node-Kontexten (Tests,
   Server) nicht definiert. */
declare const __HAUSER_BUILD_INFO__: { version?: string; revision?: string; sourceUrl?: string } | undefined;

const EMBEDDED: BuildInfo = resolveBuildInfo(
  typeof __HAUSER_BUILD_INFO__ === 'undefined' ? null : __HAUSER_BUILD_INFO__,
);

export const buildInfo = $state<BuildInfo>({ ...EMBEDDED });

let loaded = false;

export async function loadBuildInfo(): Promise<void> {
  if (loaded) return;
  loaded = true;
  let served: BuildInfo | null = null;
  try {
    const response = await fetch('/api/build-info', {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) served = parseBuildInfo(await response.json());
  } catch {
    served = null;
  }
  Object.assign(buildInfo, mergeBuildInfo(EMBEDDED, served));
}
