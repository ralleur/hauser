/* ============================================
   Herkunft der laufenden Fassung — Lizenz, Version, Revision, Quellcode.

   AGPL-3.0-only verlangt, dass Benutzer den Corresponding Source *dieser*
   Fassung finden. Deshalb ist die Revision die vollständige Commit-SHA und die
   Source-URL überschreibbar: ein Fork oder ein verändertes Deployment muss auf
   seinen eigenen Quellcode zeigen dürfen, nicht auf den Upstream.

   Reine Funktionen ohne Abhängigkeiten: derselbe Vertrag gilt im Browser
   (eingebettete Build-Werte), im Server (`/api/build-info`) und im Build-Gate
   (`vite.config.ts`). Fehlende oder unplausible Werte werden zu `null` — die
   Oberfläche zeigt dann nichts, statt eine falsche Provenienz zu behaupten.
   ============================================ */

export const HAUSER_LICENSE = 'AGPL-3.0-only';

export interface BuildInfo {
  /* Semantische Version aus app/package.json */
  version: string | null;
  /* Vollständige Commit-SHA der laufenden Fassung */
  revision: string | null;
  license: string;
  /* Validierte URL zum Corresponding Source genau dieser Revision */
  sourceUrl: string | null;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/* Vollständige Git-SHA (sha1 oder sha256). Kurz-SHAs und Dirty-Pseudo-Hashes
   wie `abc1234-dirty` sind bewusst ungültig — sie identifizieren keinen
   auffindbaren Stand. */
const REVISION_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SOURCE_URL_MAX_LENGTH = 300;
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return VERSION_PATTERN.test(value) ? value : null;
}

export function normalizeRevision(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return REVISION_PATTERN.test(value) ? value : null;
}

/* Nur `https:` — im lokalen Entwicklungsbetrieb zusätzlich `http://localhost`.
   Der Rückgabewert ist die unveränderte Eingabe, damit eine konfigurierte
   Fork-URL exakt so verlinkt wird, wie der Betreiber sie gesetzt hat. */
export function normalizeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > SOURCE_URL_MAX_LENGTH) return null;
  if (CONTROL_OR_SPACE.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname)) return value;
  return null;
}

export function resolveBuildInfo(input: {
  version?: unknown;
  revision?: unknown;
  sourceUrl?: unknown;
} | null | undefined): BuildInfo {
  return {
    version: normalizeVersion(input?.version),
    revision: normalizeRevision(input?.revision),
    license: HAUSER_LICENSE,
    sourceUrl: normalizeSourceUrl(input?.sourceUrl),
  };
}

/* Antwort von `/api/build-info`. Eine fremde oder ältere Lizenzangabe wird
   verworfen, statt sie als eigene Fassung auszugeben. */
export function parseBuildInfo(raw: unknown): BuildInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.license !== HAUSER_LICENSE) return null;
  return resolveBuildInfo(record);
}

/* Serverwerte gewinnen feldweise: das Deployment darf Source-URL und Revision
   überschreiben, ohne die eingebauten Build-Werte zu verlieren, wenn es sie
   gar nicht setzt. */
export function mergeBuildInfo(embedded: BuildInfo, served: BuildInfo | null): BuildInfo {
  if (!served) return embedded;
  return {
    version: served.version ?? embedded.version,
    revision: served.revision ?? embedded.revision,
    license: HAUSER_LICENSE,
    sourceUrl: served.sourceUrl ?? embedded.sourceUrl,
  };
}

/* Release-Gate: ein publizierbares Artefakt ohne vollständige Revision oder
   ohne öffentlich erreichbare Source-URL wäre AGPL-widrig. `http://localhost`
   ist im Entwicklungsbetrieb erlaubt, als Release-Ziel aber wertlos. */
export function buildProvenanceProblems(info: BuildInfo): string[] {
  const problems: string[] = [];
  if (!info.version) problems.push('version');
  if (!info.revision) problems.push('revision');
  if (!info.sourceUrl || !info.sourceUrl.startsWith('https://')) problems.push('sourceUrl');
  return problems;
}

export interface LicenseSourceView {
  license: string;
  version: string | null;
  revision: string | null;
  /* Kurzform für die Zeile; die vollständige SHA bleibt daneben zugänglich. */
  revisionShort: string | null;
  sourceUrl: string | null;
  publishable: boolean;
}

export function licenseSourceView(info: BuildInfo): LicenseSourceView {
  return {
    license: info.license,
    version: info.version,
    revision: info.revision,
    revisionShort: info.revision ? info.revision.slice(0, 12) : null,
    sourceUrl: info.sourceUrl,
    publishable: buildProvenanceProblems(info).length === 0,
  };
}
