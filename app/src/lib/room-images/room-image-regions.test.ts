import { describe, expect, it, vi } from 'vitest';
import {
  detectRoomImageRegions,
  textFromResponsesStream,
  withDefaultHeaders,
  normalizeDetectedRegions,
  polygonArea,
  validRegionsRecord,
  regionsRecord,
  REGION_DETECTION_MAX_REGIONS,
  REGION_DETECTION_PROMPT,
  REGION_KINDS,
  // @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
} from '../../../server/room-image-regions.mjs';
// @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
import { assetsWithoutRegions, detectRegionsForAsset } from '../../../server/room-image-region-service.mjs';

/* Paket 13: Der Server fragt einmal pro Bildset, wo die Fenster sind. Was
   zurückkommt, ist die Antwort eines Modells — also grundsätzlich verdächtig. */

const rechteck = [
  { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.6 }, { x: 0.1, y: 0.6 },
];

describe('Antwort des Sehmodells prüfen', () => {
  it('übernimmt ein sauberes Polygon', () => {
    const polygons = normalizeDetectedRegions({ regions: [{ kind: 'window', points: rechteck }] });
    expect(polygons).toHaveLength(1);
    expect(polygons[0].points).toHaveLength(4);
  });

  it('klemmt Koordinaten außerhalb des Bildes fest', () => {
    const polygons = normalizeDetectedRegions({
      regions: [{ kind: 'window', points: [{ x: -3, y: 0.1 }, { x: 9, y: 0.1 }, { x: 9, y: 0.9 }, { x: -3, y: 0.9 }] }],
    });
    expect(polygons[0].points[0]).toEqual({ x: 0, y: 0.1 });
    expect(polygons[0].points[1]).toEqual({ x: 1, y: 0.1 });
  });

  it('wirft Striche und Punkte weg', () => {
    expect(normalizeDetectedRegions({ regions: [{ kind: 'window', points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }] }] })).toEqual([]);
    const strich = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.1005 }];
    expect(normalizeDetectedRegions({ regions: [{ kind: 'window', points: strich }] })).toEqual([]);
  });

  it('überlebt Unsinn, ohne etwas zu übernehmen', () => {
    expect(normalizeDetectedRegions(null)).toEqual([]);
    expect(normalizeDetectedRegions({ regions: 'viele' })).toEqual([]);
    expect(normalizeDetectedRegions({ regions: [{ kind: 'window', points: [{ x: 'links', y: 0.2 }] }] })).toEqual([]);
  });

  it('deckelt die Zahl der Fenster', () => {
    const viele = Array.from({ length: 40 }, () => ({ kind: 'window', points: rechteck }));
    expect(normalizeDetectedRegions({ regions: viele })).toHaveLength(REGION_DETECTION_MAX_REGIONS);
  });

  it('rechnet die Fläche nach der Schuhbandformel', () => {
    expect(polygonArea(rechteck)).toBeCloseTo(0.4 * 0.5, 6);
  });
});

describe('Katalogsatz', () => {
  it('nimmt nur die drei erwarteten Felder an', () => {
    const record = regionsRecord([{ kind: 'window', points: rechteck }], { now: () => 0 });
    expect(validRegionsRecord(record)).toBe(true);
    expect(validRegionsRecord({ ...record, fremd: 1 })).toBe(false);
    expect(validRegionsRecord({ ...record, source: 'geraten' })).toBe(false);
    expect(validRegionsRecord({ ...record, regions: [{ kind: 'window', points: [] }] })).toBe(false);
  });
});

describe('Erkennung eines Bildsets', () => {
  const asset = { assetId: 'abc', status: 'active' };
  const store = (overrides = {}) => ({
    activeEntry: () => asset,
    variantBytes: () => new Uint8Array([1, 2, 3]),
    list: () => [asset],
    setRegions: vi.fn(),
    ...overrides,
  });
  const prepare = async () => new Uint8Array([9]);

  it('schreibt das Ergebnis in den Katalog', async () => {
    const assetStore = store();
    const result = await detectRegionsForAsset('abc', {
      assetStore,
      credential: 'schluessel',
      model: 'seh-modell',
      prepare,
      detect: async () => ({ ok: true, regions: [{ kind: 'window', points: rechteck }] }),
    });
    expect(result.ok).toBe(true);
    expect(assetStore.setRegions).toHaveBeenCalledWith('abc', expect.objectContaining({ source: 'model' }));
  });

  it('lässt den Katalog in Ruhe, wenn das Modell nicht antwortet', async () => {
    const assetStore = store();
    const result = await detectRegionsForAsset('abc', {
      assetStore,
      credential: 'schluessel',
      prepare,
      detect: async () => ({ ok: false, code: 'REGION_DETECTION_UNREACHABLE' }),
    });
    expect(result).toMatchObject({ ok: false, code: 'REGION_DETECTION_UNREACHABLE' });
    expect(assetStore.setRegions).not.toHaveBeenCalled();
  });

  it('meldet ein unbekanntes Asset, statt zu erfinden', async () => {
    const result = await detectRegionsForAsset('weg', {
      assetStore: store({ activeEntry: () => null }),
      credential: 'schluessel',
      prepare,
      detect: async () => ({ ok: true, regions: [] }),
    });
    expect(result).toMatchObject({ ok: false, code: 'ASSET_NOT_FOUND' });
  });

  it('kennt den Arbeitsvorrat der Nacht', () => {
    const assetStore = store({
      list: () => [
        { assetId: 'ohne', status: 'active' },
        { assetId: 'mit', status: 'active', regions: { detectedAt: '', source: 'model', regions: [] } },
        { assetId: 'weg', status: 'tombstone' },
      ],
    });
    expect(assetsWithoutRegions(assetStore)).toEqual(['ohne']);
  });
});

describe('Aufruf beim Anbieter', () => {
  it('verlangt Zugang und Bild, bevor er losläuft', async () => {
    expect(await detectRoomImageRegions({ image: new Uint8Array([1]), credential: '' }))
      .toMatchObject({ code: 'PROVIDER_CREDENTIAL_MISSING' });
    expect(await detectRoomImageRegions({ image: null, credential: 'k' }))
      .toMatchObject({ code: 'REGION_DETECTION_INPUT_INVALID' });
  });

  it('nennt das Modell, wenn der Zugang es nicht kennt', async () => {
    const result = await detectRoomImageRegions({
      image: new Uint8Array([1]),
      credential: 'k',
      model: 'seh-modell',
      fetchImpl: async () => new Response('{}', { status: 404 }),
    });
    expect(result).toMatchObject({ code: 'REGION_DETECTION_MODEL_UNAVAILABLE', model: 'seh-modell' });
  });

  it('liest die Polygone aus der Modellantwort', async () => {
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ regions: [{ kind: 'window', points: rechteck }] }) } }],
    });
    const result = await detectRoomImageRegions({
      image: new Uint8Array([1]),
      credential: 'k',
      model: 'seh-modell',
      fetchImpl: async () => new Response(body, { status: 200 }),
    });
    expect(result.ok).toBe(true);
    expect(result.regions).toHaveLength(1);
  });

  it('nimmt keine Prosa als Polygon', async () => {
    const body = JSON.stringify({ choices: [{ message: { content: 'Da sind zwei Fenster.' } }] });
    const result = await detectRoomImageRegions({
      image: new Uint8Array([1]),
      credential: 'k',
      fetchImpl: async () => new Response(body, { status: 200 }),
    });
    expect(result).toMatchObject({ ok: false, code: 'REGION_DETECTION_INVALID_RESPONSE' });
  });
});

/* Der Weg über die ChatGPT-Anmeldung: dasselbe Backend wie die
   Bildgenerierung, aber die Responses-API — sie streamt und will ihre eigene
   Nachrichtenform. */
describe('Codex-Weg', () => {
  const antwort = JSON.stringify({ regions: [{ kind: 'window', points: rechteck }] });
  const stream = [
    'event: response.output_text.done',
    `data: ${JSON.stringify({ type: 'response.output_text.done', text: antwort })}`,
    '',
    'event: response.completed',
    'data: {"type":"response.completed"}',
    '',
  ].join('\n');

  it('liest den Text aus dem Ereignisstrom', () => {
    expect(textFromResponsesStream(stream)).toContain('regions');
    expect(textFromResponsesStream('kein Strom')).toBe('');
  });

  it('schickt Strom, Bild und Prompt an das Codex-Backend', async () => {
    let seenUrl = '';
    let seenBody: Record<string, unknown> = {};
    const result = await detectRoomImageRegions({
      image: new Uint8Array([1]),
      credential: 'token',
      mode: 'chatgpt',
      model: 'seh-modell',
      headers: { Authorization: 'Bearer token', originator: 'codex_cli_rs' },
      fetchImpl: async (url: string, options: { body: string }) => {
        seenUrl = url;
        seenBody = JSON.parse(options.body);
        return new Response(stream, { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(result.regions).toHaveLength(1);
    expect(seenUrl).toContain('backend-api/codex/responses');
    expect(seenBody.stream).toBe(true);
    const content = (seenBody.input as { content: { type: string }[] }[])[0].content;
    expect(content.map((part) => part.type)).toEqual(['input_text', 'input_image']);
  });

  it('verdoppelt keine Kopfzeile, die der Aufrufer schon setzt', () => {
    const merged = withDefaultHeaders(
      { 'Content-Type': 'application/json', Authorization: 'Bearer a' },
      { 'content-type': 'text/plain', authorization: 'Bearer b', accept: 'application/json' },
    );
    expect(Object.keys(merged).sort()).toEqual(['Authorization', 'Content-Type', 'accept']);
    expect(merged['Content-Type']).toBe('application/json');
  });
});

/* Die Arten sind der eigentliche Zugewinn: das Fenster hat einen Verbraucher,
   der Rest wird für später markiert. Was das Modell frei erfindet, fällt weg. */
describe('Prompt für die Erkennung', () => {
  /* Am 2026-09-06 lieferte derselbe Prompt am selben Bild einmal drei Scheiben
     und einmal eine. Diese beiden Sätze sind die Antwort darauf und dürfen
     nicht stillschweigend verschwinden. */
  it('verlangt jede Scheibe einer Fensterfront einzeln', () => {
    expect(REGION_DETECTION_PROMPT).toContain('several panes side by side');
    expect(REGION_DETECTION_PROMPT).toContain('never mark just one of them');
    expect(REGION_DETECTION_PROMPT).toContain('no pane of glass is missing');
  });

  it('grenzt das Fenster auf das Glas ein', () => {
    expect(REGION_DETECTION_PROMPT).toContain('only the glass itself');
    expect(REGION_DETECTION_PROMPT).toContain('excluding frame, mullions, handles, sill, curtains');
  });
});

describe('Arten der Flächen', () => {
  it('nimmt jede bekannte Art an', () => {
    const alle = REGION_KINDS.map((kind: string) => ({ kind, points: rechteck }));
    const regions = normalizeDetectedRegions({ regions: alle });
    expect(regions.map((region: { kind: string }) => region.kind)).toEqual([...REGION_KINDS]);
  });

  it('verwirft erfundene Arten', () => {
    expect(normalizeDetectedRegions({ regions: [{ kind: 'katze', points: rechteck }] })).toEqual([]);
    expect(normalizeDetectedRegions({ regions: [{ points: rechteck }] })).toEqual([]);
  });

  it('lässt Kleinteile zu, aber keine winzigen Fenster und Böden', () => {
    const klein = [{ x: 0.5, y: 0.5 }, { x: 0.56, y: 0.5 }, { x: 0.56, y: 0.58 }, { x: 0.5, y: 0.58 }];
    expect(normalizeDetectedRegions({ regions: [{ kind: 'bin', points: klein }] })).toHaveLength(1);
    expect(normalizeDetectedRegions({ regions: [{ kind: 'window', points: klein }] })).toEqual([]);
    expect(normalizeDetectedRegions({ regions: [{ kind: 'floor', points: klein }] })).toEqual([]);
  });

  /* Eine schmale Scheibe einer Balkonfront misst gut ein Prozent des Bildes —
     die alte Fenstergrenze von einem Prozent hätte sie verworfen. */
  it('nimmt die schmale Scheibe einer Fensterfront an', () => {
    const scheibe = [{ x: 0.41, y: 0.22 }, { x: 0.48, y: 0.22 }, { x: 0.48, y: 0.40 }, { x: 0.41, y: 0.40 }];
    expect(normalizeDetectedRegions({ regions: [{ kind: 'window', points: scheibe }] })).toHaveLength(1);
  });

  it('nimmt den Boden als eigene Art an', () => {
    const boden = [{ x: 0.05, y: 0.6 }, { x: 0.95, y: 0.62 }, { x: 0.95, y: 0.98 }, { x: 0.05, y: 0.98 }];
    const regions = normalizeDetectedRegions({ regions: [{ kind: 'floor', points: boden }] });
    expect(regions).toHaveLength(1);
    expect(regions[0].kind).toBe('floor');
  });

  it('verlangt Art und Punkte im Katalogsatz', () => {
    const record = regionsRecord([{ kind: 'seating', points: rechteck }], { now: () => 0 });
    expect(validRegionsRecord(record)).toBe(true);
    expect(validRegionsRecord({ ...record, regions: [{ kind: 'sofa', points: rechteck }] })).toBe(false);
    expect(validRegionsRecord({ ...record, regions: [{ points: rechteck }] })).toBe(false);
  });
});
