/*
 * Ortssuche für den Ambient-Stadtplan.
 *
 * Koordinaten einzutippen ist eine Zumutung; „Dortmund" einzugeben nicht.
 * Gefragt wird Nominatim, der Geokodierer von OpenStreetMap — dieselbe
 * Datenquelle wie die Karte selbst, ohne Konto und ohne Schlüssel.
 *
 * Datenschutzlich ist die Suche HARMLOSER als das Rendern: hinaus geht ein
 * Suchbegriff, nicht ein Rechteck um das eigene Zuhause. Die Anfrage stellt
 * der Server, nicht der Browser — so hängt sie nicht an der IP des Geräts und
 * der von Nominatim geforderte Kontakt-Header ist zuverlässig gesetzt.
 *
 * Nominatims Nutzungsrichtlinie erlaubt höchstens eine Anfrage pro Sekunde.
 * Diese Grenze wird hier serverseitig durchgesetzt, nicht der Oberfläche
 * überlassen: ein Client, der zu schnell tippt, darf den Dienst nicht
 * überlasten — und ein zweiter Client auch nicht.
 */

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
export const GEOCODE_TIMEOUT_MS = 8_000;
export const GEOCODE_RESPONSE_LIMIT_BYTES = 256 * 1_024;
export const GEOCODE_MIN_INTERVAL_MS = 1_100;
export const GEOCODE_MAX_RESULTS = 5;
export const GEOCODE_QUERY_MAX_LENGTH = 120;
export const GEOCODE_USER_AGENT =
  'Hauser/0.6 ambient-map-geocode (+https://github.com/ralleur/hauser)';

export const GEOCODE_ERROR_CODES = Object.freeze({
  INVALID_QUERY: 'GEOCODE_INVALID_QUERY',
  RATE_LIMITED: 'GEOCODE_RATE_LIMITED',
  UPSTREAM_FAILED: 'GEOCODE_UPSTREAM_FAILED',
});

export class AmbientMapGeocodeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AmbientMapGeocodeError';
    this.code = code;
  }
}

export function normalizeGeocodeQuery(value) {
  if (typeof value !== 'string') return null;
  /* Steuerzeichen raus, Leerraum zusammenfassen: der Begriff geht an einen
     fremden Dienst und gehört vorher aufgeräumt. */
  const text = value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text.length < 2 || text.length > GEOCODE_QUERY_MAX_LENGTH) return null;
  return text;
}

/** Genau die Felder, die die Oberfläche braucht — alles andere aus der
 *  Nominatim-Antwort (OSM-IDs, Bounding-Boxen, Adressdetails) verfällt. */
export function projectGeocodeResults(payload) {
  if (!Array.isArray(payload)) throw new AmbientMapGeocodeError(GEOCODE_ERROR_CODES.UPSTREAM_FAILED);
  const results = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const latitude = Number(entry.lat);
    const longitude = Number(entry.lon);
    const label = typeof entry.display_name === 'string' ? entry.display_name.trim() : '';
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) continue;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) continue;
    if (!label || label.length > 200) continue;
    results.push({ label, latitude, longitude });
    if (results.length >= GEOCODE_MAX_RESULTS) break;
  }
  return results;
}

async function readLimited(response, limitBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limitBytes) {
    throw new AmbientMapGeocodeError(GEOCODE_ERROR_CODES.UPSTREAM_FAILED);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > limitBytes) {
    throw new AmbientMapGeocodeError(GEOCODE_ERROR_CODES.UPSTREAM_FAILED);
  }
  return text;
}

/**
 * Erzeugt die Suchfunktion. Der Mindestabstand zwischen zwei Anfragen wird
 * prozessweit gehalten — die Richtlinie gilt pro Dienst, nicht pro Benutzer.
 */
export function createAmbientMapGeocoder({
  fetchImpl = fetch,
  endpoint = NOMINATIM_ENDPOINT,
  timeoutMs = GEOCODE_TIMEOUT_MS,
  responseLimitBytes = GEOCODE_RESPONSE_LIMIT_BYTES,
  minIntervalMs = GEOCODE_MIN_INTERVAL_MS,
  now = () => Date.now(),
  acceptLanguage = 'en',
} = {}) {
  let lastRequestAt = Number.NEGATIVE_INFINITY;

  return async function geocode(rawQuery) {
    const query = normalizeGeocodeQuery(rawQuery);
    if (!query) throw new AmbientMapGeocodeError(GEOCODE_ERROR_CODES.INVALID_QUERY);

    const elapsed = now() - lastRequestAt;
    if (elapsed < minIntervalMs) {
      throw new AmbientMapGeocodeError(GEOCODE_ERROR_CODES.RATE_LIMITED);
    }
    lastRequestAt = now();

    const url = `${endpoint}?${new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: String(GEOCODE_MAX_RESULTS),
      addressdetails: '0',
    })}`;

    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'accept-language': acceptLanguage,
          'user-agent': GEOCODE_USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AmbientMapGeocodeError(GEOCODE_ERROR_CODES.UPSTREAM_FAILED);
    }
    if (!response?.ok) throw new AmbientMapGeocodeError(GEOCODE_ERROR_CODES.UPSTREAM_FAILED);

    const text = await readLimited(response, responseLimitBytes);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AmbientMapGeocodeError(GEOCODE_ERROR_CODES.UPSTREAM_FAILED);
    }
    return projectGeocodeResults(payload);
  };
}
