/* ============================================
   Notion-Bridge (Schreib-Richtung) — die HMI darf die Notion-API nicht direkt
   aufrufen (CORS/Token im Browser). scripts/notion-bridge.py läuft deshalb im
   serve-Modus auf demselben Host und nimmt die Schreibbefehle als POST an.
   Nach jedem erfolgreichen Schreiben aktualisiert die Bridge die JSON-Dateien
   im public-Verzeichnis, sodass der folgende Refresh den Eintrag schon sieht.
   ============================================ */

const OVERRIDE_KEY = 'hmi:notion-bridge-url';

/* Standard: Same-Origin-Route des HMI-Servers. Das funktioniert sowohl im LAN
   als auch hinter HTTPS/Cloudflare, ohne Mixed Content oder einen zusätzlich
   exponierten Port. Override bleibt für lokale Entwicklung möglich. */
export function bridgeBaseUrl(): string {
  try {
    const override = localStorage.getItem(OVERRIDE_KEY);
    if (override) return override.replace(/\/$/, '');
  } catch { /* Storage blockiert → Default */ }
  return '/notion-bridge';
}

export class BridgeError extends Error {}

/* POST an die Bridge; wirft BridgeError mit sprechender Meldung, wenn die
   Bridge nicht läuft oder Notion den Eintrag ablehnt. */
export async function bridgePost(path: string, payload: unknown): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`${bridgeBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new BridgeError('Notion-Bridge nicht erreichbar');
  }
  const body = await resp.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!resp.ok || !body?.ok) {
    throw new BridgeError(body?.error ?? `Bridge-Fehler (${resp.status})`);
  }
}
