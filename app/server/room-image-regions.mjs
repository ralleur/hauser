/* ── Flächenerkennung für Raumbilder (Paket 13, docs/20) ──

   Ein Raumbild ist für die Oberfläche bisher eine Tapete: schön, aber ohne
   Bedeutung. Der Server fragt deshalb einmal pro Bildset ein Sehmodell, wo im
   Bild welche Art von Fläche liegt, und legt die Antwort als Polygone in den
   Katalog. Zur Laufzeit ist es dann Geometrie — kein Modell, keine Rechenzeit.

   Das Fenster ist die erste Art mit einem Verbraucher (Wetter zieht nur dort).
   Die übrigen Arten — bis hin zur Bodenfläche — werden erkannt und markiert,
   damit später etwas darauf aufsetzen kann, ohne dass jedes Bildset noch
   einmal durchs Modell muss.

   Alles hier ist misstrauisch gegenüber der Antwort: Ein Modell, das
   halluziniert, darf höchstens eine unbrauchbare Fläche liefern, niemals
   fremde Struktur in den Katalog schreiben. */

/** Die Arten, die wir unterscheiden. Alles andere wird verworfen. */
export const REGION_KINDS = Object.freeze([
  'window',    // Fensterscheiben, verglaste Balkon- und Terrassentüren, Dachfenster
  'floor',     // die sichtbare Bodenfläche, Teppiche eingeschlossen
  'seating',   // Sofas, Sessel, Stühle, Bänke — die Sitzfläche selbst
  'table',     // Ess-, Couch- und Beistelltische
  'desk',      // Schreibtische
  'bed',       // Betten
  'tv',        // Fernseher und Monitore
  'mirror',    // Spiegel
  'bath',      // Badewannen und Duschen
  'appliance', // Küchengeräte: Herd, Ofen, Kühlschrank, Spülmaschine, Mikrowelle
  'bin',       // Mülleimer
  'toy',       // Spielzeug
  'solar',     // Solarmodule auf Dach, Balkon oder Fassade (Außenbild, R14)
]);

export const REGION_DETECTION_MAX_REGIONS = 24;
export const REGION_DETECTION_MAX_POINTS = 12;
const MIN_POINTS = 3;
/* Kleinteile wie Mülleimer oder Spielzeug dürfen klein sein — unter drei
   Promille wird aber auch da nichts mehr sinnvoll getroffen.

   Für Fenster stand die Grenze zunächst bei einem Prozent, gedacht gegen
   Reflexe im Schrank. Gemessen am 2026-09-06: Die drei Scheiben einer
   Balkonfront liegen bei 0,013 bis 0,021 — eine schmale Kippscheibe fällt
   damit unter die Grenze, obwohl sie ein echtes Fenster ist. Deshalb ein
   halbes Prozent; ein Reflex bleibt auch damit draußen. */
const MIN_AREA = Object.freeze({ window: 0.005, floor: 0.01, default: 0.003 });

const KIND_GUIDE = [
  'window: glass of windows, glazed balcony or terrace doors, skylights — only the glass itself, '
    + 'excluding frame, mullions, handles, sill, curtains and plants standing in front of it',
  'floor: the visible floor surface you could walk on, including rugs lying on it, but not the furniture standing on it',
  'seating: the seat surface of sofas, armchairs, chairs, benches',
  'table: dining, coffee and side tables — the table top',
  'desk: desks and work surfaces',
  'bed: beds, including the mattress area',
  'tv: televisions and monitors — the screen',
  'mirror: mirrors — the reflecting surface',
  'bath: bathtubs and showers',
  'appliance: kitchen appliances such as stove, oven, fridge, dishwasher, microwave',
  'bin: waste bins',
  'toy: toys and toy storage',
  'solar: photovoltaic solar modules on a roof, a balcony railing, a facade or in the garden — the module surface itself',
].join('; ');

export const REGION_DETECTION_PROMPT = [
  'You are given a stylised illustration of one room in a home, or of a house seen from outside.',
  'Mark the areas that belong to these kinds:',
  `${KIND_GUIDE}.`,
  'Ignore anything that is not in that list. Ignore pictures on the wall, plants, lamps and doors to other rooms.',
  'A mirror is not a window: mark reflecting surfaces as mirror, never as window.',
  'Answer with JSON only, no prose, in exactly this shape:',
  '{"regions":[{"kind":"window","points":[{"x":0.12,"y":0.20},{"x":0.44,"y":0.20},{"x":0.44,"y":0.72},{"x":0.12,"y":0.72}]}]}',
  'Coordinates are fractions of the image: x from 0 at the left edge to 1 at the right,',
  'y from 0 at the top to 1 at the bottom. Use 4 points for a rectangular area and up to',
  `${REGION_DETECTION_MAX_POINTS} for an irregular one, ordered clockwise.`,
  `Return at most ${REGION_DETECTION_MAX_REGIONS} areas, the largest ones first.`,
  'Mark each visible object separately rather than merging neighbours into one area.',
  /* Fensterfronten sind der wunde Punkt: Ein Lauf am selben Bild lieferte drei
     Scheiben, der nächste nur eine. Deshalb steht das Fenster hier zweimal —
     einmal als Regel, einmal als letzte Prüfung vor der Antwort. */
  'Window fronts and balcony doors usually consist of several panes side by side:',
  'mark every single pane as its own area — never merge them into one, and never mark just one of them.',
  'The floor is the exception: mark it as one area that follows the outline of the free floor.',
  'Before you answer, go over the picture once more and check that no pane of glass is missing.',
  'If the room contains none of these, return {"regions":[]}.',
].join(' ');

function clampFraction(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, Math.round(value * 10000) / 10000));
}

/* Schuhbandformel: ein Polygon, das fast keine Fläche hat, ist ein Strich. */
export function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

/** Rohantwort → geprüfte Flächen. Unbrauchbares fällt still weg. */
export function normalizeDetectedRegions(payload) {
  const raw = Array.isArray(payload?.regions) ? payload.regions : [];
  const regions = [];
  for (const candidate of raw) {
    if (regions.length >= REGION_DETECTION_MAX_REGIONS) break;
    const kind = REGION_KINDS.find((entry) => entry === candidate?.kind);
    if (!kind) continue;
    const rawPoints = Array.isArray(candidate?.points) ? candidate.points : [];
    const points = [];
    for (const point of rawPoints.slice(0, REGION_DETECTION_MAX_POINTS)) {
      const x = clampFraction(point?.x);
      const y = clampFraction(point?.y);
      if (x === null || y === null) { points.length = 0; break; }
      points.push({ x, y });
    }
    if (points.length < MIN_POINTS) continue;
    if (polygonArea(points) < (MIN_AREA[kind] ?? MIN_AREA.default)) continue;
    regions.push({ kind, points });
  }
  return regions;
}

/** Katalogeintrag für den Assetstore; `source` hält fest, wer es gesehen hat. */
export function regionsRecord(regions, { source = 'model', now = () => Date.now() } = {}) {
  return {
    detectedAt: new Date(now()).toISOString(),
    source,
    regions,
  };
}

export function validRegionsRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== 'detectedAt' || keys[1] !== 'regions' || keys[2] !== 'source') return false;
  if (typeof value.detectedAt !== 'string' || Number.isNaN(Date.parse(value.detectedAt))) return false;
  if (!['model', 'manual'].includes(value.source)) return false;
  if (!Array.isArray(value.regions) || value.regions.length > REGION_DETECTION_MAX_REGIONS) return false;
  return value.regions.every((region) => {
    if (!region || typeof region !== 'object' || Array.isArray(region)) return false;
    const regionKeys = Object.keys(region).sort();
    if (regionKeys.length !== 2 || regionKeys[0] !== 'kind' || regionKeys[1] !== 'points') return false;
    if (!REGION_KINDS.includes(region.kind)) return false;
    if (!Array.isArray(region.points)) return false;
    if (region.points.length < MIN_POINTS || region.points.length > REGION_DETECTION_MAX_POINTS) return false;
    return region.points.every((point) => point && typeof point === 'object' && !Array.isArray(point)
      && Object.keys(point).length === 2
      && typeof point.x === 'number' && point.x >= 0 && point.x <= 1
      && typeof point.y === 'number' && point.y >= 0 && point.y <= 1);
  });
}

/* ── Der Aufruf, zwei Wege ──
   Beide schicken dasselbe: den Prompt und ein JPEG als Data-URL, damit kein
   Zwischenspeicher im Netz nötig ist.

   `api_key`  → `chat/completions` bei OpenAI.
   `chatgpt`  → die Responses-API des Codex-Backends. Dieselbe Anmeldung, die
                schon die Bilder erzeugt, kann auch sehen — sie verlangt nur
                `stream: true` und antwortet als SSE. Denselben Weg nimmt
                Hermes für seinen Provider `openai-codex`. */

/** Ergänzt fehlende Kopfzeilen, ohne eine vorhandene zu verdoppeln. */
export function withDefaultHeaders(headers, defaults) {
  const present = new Set(Object.keys(headers).map((key) => key.toLowerCase()));
  const merged = { ...headers };
  for (const [key, value] of Object.entries(defaults)) {
    if (!present.has(key.toLowerCase())) merged[key] = value;
  }
  return merged;
}

/** Sammelt den Text aus einem Responses-SSE-Strom. */
export function textFromResponsesStream(body) {
  const parts = [];
  for (const line of String(body).split('\n')) {
    if (!line.startsWith('data: ')) continue;
    let frame;
    try { frame = JSON.parse(line.slice(6)); } catch { continue; }
    if (frame?.type === 'response.output_text.done' && typeof frame.text === 'string') {
      parts.push(frame.text);
    }
  }
  return parts.join('');
}

export async function detectRoomImageRegions({
  image,
  mimeType = 'image/jpeg',
  model,
  credential,
  mode = 'api_key',
  url = 'https://api.openai.com/v1/chat/completions',
  codexUrl = 'https://chatgpt.com/backend-api/codex/responses',
  headers: extraHeaders = {},
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (!(image instanceof Uint8Array) || image.byteLength < 1) {
    return { ok: false, code: 'REGION_DETECTION_INPUT_INVALID' };
  }
  if (typeof credential !== 'string' || !credential.trim()) {
    return { ok: false, code: 'PROVIDER_CREDENTIAL_MISSING' };
  }
  const dataUrl = `data:${mimeType};base64,${Buffer.from(image).toString('base64')}`;
  const codex = mode === 'chatgpt';
  const request = codex
    ? {
      url: codexUrl,
      /* Die Kopfzeilen kommen vom Aufrufer, weil das Codex-Backend die
         Kennung des Clients sehen will. Ergänzt wird nur, was fehlt — zwei
         Schreibweisen derselben Kopfzeile („Content-Type" und „content-type")
         würden sonst als ein doppelter Wert auf die Leitung gehen. */
      headers: withDefaultHeaders(extraHeaders, {
        'content-type': 'application/json',
        authorization: `Bearer ${credential}`,
      }),
      body: {
        model,
        /* Das Codex-Backend beantwortet nur Ströme; ohne `stream: true`
           kommt 400 „Stream must be set to true". */
        stream: true,
        store: false,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: REGION_DETECTION_PROMPT },
            { type: 'input_image', image_url: dataUrl },
          ],
        }],
      },
    }
    : {
      url,
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: {
        model,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: REGION_DETECTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      },
    };

  let response;
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      signal,
      body: JSON.stringify(request.body),
    });
  } catch {
    return { ok: false, code: 'REGION_DETECTION_UNREACHABLE' };
  }
  if (response.status === 404 || response.status === 400) {
    return { ok: false, code: 'REGION_DETECTION_MODEL_UNAVAILABLE', status: response.status, model };
  }
  if (response.status < 200 || response.status >= 300) {
    /* Der Text des Anbieters sagt, was er meint — Ratenbremse, Modell nicht
       erlaubt, Bild zu groß. Er gehört ins Log, nicht in die Antwort. */
    let detail = '';
    try { detail = (await response.text()).slice(0, 300); } catch { detail = ''; }
    return { ok: false, code: 'REGION_DETECTION_PROVIDER_ERROR', status: response.status, detail };
  }

  let text;
  if (codex) {
    try { text = textFromResponsesStream(await response.text()); }
    catch { return { ok: false, code: 'REGION_DETECTION_INVALID_RESPONSE' }; }
  } else {
    let payload;
    try { payload = await response.json(); } catch { return { ok: false, code: 'REGION_DETECTION_INVALID_RESPONSE' }; }
    text = payload?.choices?.[0]?.message?.content;
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, code: 'REGION_DETECTION_INVALID_RESPONSE' };
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, code: 'REGION_DETECTION_INVALID_RESPONSE' }; }
  return { ok: true, regions: normalizeDetectedRegions(parsed) };
}
