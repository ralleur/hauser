export const ALGORITHM_VERSION = 1;
export const VIEWBOX_WIDTH = 1_920;
export const VIEWBOX_HEIGHT = 1_200;
export const MAX_QUERY_RADIUS_METRES = 5_000;
/* AMBIENT-MAP S6: Gemessen am realen Kölner Referenzort aus Plan §2 —
   16.813 Wege bei automatisch gewähltem Radius 5.000 m ergeben 585.629 Bytes
   SVG. Die vorherigen 256 KiB haben genau diesen Planfall abgewiesen. Die
   Grenze bleibt eine harte, benannte Servergrenze nach §4.4; sie liegt jetzt
   rund 1,8-fach über dem gemessenen Worst Case. */
export const MAX_SVG_BYTES = 1_024 * 1_024;
export const TARGET_ROAD_DENSITY = 4;
export const EARTH_RADIUS_METRES = 6_378_137;

export const RADIUS_CANDIDATES_METRES = Object.freeze([
  800, 1_000, 1_250, 1_500, 2_000, 2_500, 3_500, 5_000,
]);

export const HIGHWAY_TYPES = Object.freeze([
  'motorway', 'motorway_link',
  'trunk', 'trunk_link',
  'primary', 'primary_link',
  'secondary', 'secondary_link',
  'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service',
]);

export const ROAD_CLASSES = Object.freeze([
  Object.freeze({ name: 'local', strokeWidth: 1 }),
  Object.freeze({ name: 'tertiary', strokeWidth: 1.4 }),
  Object.freeze({ name: 'secondary', strokeWidth: 1.9 }),
  Object.freeze({ name: 'primary', strokeWidth: 2.5 }),
  Object.freeze({ name: 'major', strokeWidth: 3.2 }),
]);

export const RENDERER_ERROR_CODES = Object.freeze({
  INVALID_OSM_STRUCTURE: 'INVALID_OSM_STRUCTURE',
  SVG_TOO_LARGE: 'SVG_TOO_LARGE',
});

const VIEWBOX_ASPECT_RATIO = VIEWBOX_WIDTH / VIEWBOX_HEIGHT;
const HIGHWAY_TYPE_SET = new Set(HIGHWAY_TYPES);
const CLASS_BY_HIGHWAY = new Map([
  ['residential', 'local'],
  ['living_street', 'local'],
  ['unclassified', 'local'],
  ['service', 'local'],
  ['tertiary', 'tertiary'],
  ['tertiary_link', 'tertiary'],
  ['secondary', 'secondary'],
  ['secondary_link', 'secondary'],
  ['primary', 'primary'],
  ['primary_link', 'primary'],
  ['motorway', 'major'],
  ['motorway_link', 'major'],
  ['trunk', 'major'],
  ['trunk_link', 'major'],
]);
const DENSITY_WEIGHT_BY_HIGHWAY = new Map([
  ['residential', 1],
  ['living_street', 1],
  ['unclassified', 0.65],
  ['service', 0.35],
  ['tertiary', 0.4],
  ['tertiary_link', 0.4],
]);

export class AmbientMapRendererError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AmbientMapRendererError';
    this.code = code;
  }
}

function invalidOsmStructure() {
  return new AmbientMapRendererError(RENDERER_ERROR_CODES.INVALID_OSM_STRUCTURE);
}

function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateCoordinates(latitude, longitude) {
  if (!isFiniteCoordinate(latitude) || latitude < -90 || latitude > 90
    || !isFiniteCoordinate(longitude) || longitude < -180 || longitude > 180) {
    throw invalidOsmStructure();
  }
  return { latitude, longitude };
}

export function projectToLocalMetres(point, centre) {
  const { latitude, longitude } = validateCoordinates(centre.latitude, centre.longitude);
  if (!point || !isFiniteCoordinate(point.lat) || point.lat < -90 || point.lat > 90
    || !isFiniteCoordinate(point.lon) || point.lon < -180 || point.lon > 180) {
    throw invalidOsmStructure();
  }
  const latitudeRadians = latitude * Math.PI / 180;
  return [
    EARTH_RADIUS_METRES * (point.lon - longitude) * Math.PI / 180 * Math.cos(latitudeRadians),
    EARTH_RADIUS_METRES * (point.lat - latitude) * Math.PI / 180,
  ];
}

export function projectToViewBox([x, y], radiusMetres) {
  const halfHeight = radiusMetres / VIEWBOX_ASPECT_RATIO;
  return [
    Math.round((x + radiusMetres) / (radiusMetres * 2) * VIEWBOX_WIDTH),
    Math.round((halfHeight - y) / (halfHeight * 2) * VIEWBOX_HEIGHT),
  ];
}

export function classifyHighway(highway) {
  return CLASS_BY_HIGHWAY.get(highway) ?? null;
}

export function densityWeight(highway) {
  return DENSITY_WEIGHT_BY_HIGHWAY.get(highway) ?? 0;
}

export function clipSegmentLiangBarsky(start, end, bounds) {
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [
    x1 - bounds.minX,
    bounds.maxX - x1,
    y1 - bounds.minY,
    bounds.maxY - y1,
  ];
  let from = 0;
  let to = 1;

  for (let index = 0; index < p.length; index += 1) {
    if (p[index] === 0) {
      if (q[index] < 0) return null;
      continue;
    }
    const crossing = q[index] / p[index];
    if (p[index] < 0) from = Math.max(from, crossing);
    else to = Math.min(to, crossing);
    if (from > to) return null;
  }

  return [
    [x1 + from * dx, y1 + from * dy],
    [x1 + to * dx, y1 + to * dy],
  ];
}

export function renderBounds(radiusMetres) {
  const halfHeight = radiusMetres / VIEWBOX_ASPECT_RATIO;
  return { minX: -radiusMetres, maxX: radiusMetres, minY: -halfHeight, maxY: halfHeight };
}

function samePoint(first, second) {
  return Math.abs(first[0] - second[0]) < 1e-9 && Math.abs(first[1] - second[1]) < 1e-9;
}

export function clipPolyline(points, bounds) {
  const result = [];
  let current = null;
  for (let index = 1; index < points.length; index += 1) {
    const clipped = clipSegmentLiangBarsky(points[index - 1], points[index], bounds);
    if (!clipped) {
      current = null;
      continue;
    }
    if (!current || !samePoint(current.at(-1), clipped[0])) {
      current = [clipped[0], clipped[1]];
      result.push(current);
    } else if (!samePoint(current.at(-1), clipped[1])) {
      current.push(clipped[1]);
    }
  }
  return result;
}

export function measureRoadDensity(roads, radiusMetres) {
  const bounds = renderBounds(radiusMetres);
  let weightedLengthMetres = 0;
  for (const road of roads) {
    const weight = densityWeight(road.highway);
    if (weight === 0) continue;
    for (let index = 1; index < road.points.length; index += 1) {
      const clipped = clipSegmentLiangBarsky(road.points[index - 1], road.points[index], bounds);
      if (!clipped) continue;
      weightedLengthMetres += Math.hypot(
        clipped[1][0] - clipped[0][0],
        clipped[1][1] - clipped[0][1],
      ) * weight;
    }
  }
  const areaSquareKilometres = (radiusMetres * 2)
    * (radiusMetres / VIEWBOX_ASPECT_RATIO * 2) / 1_000_000;
  return weightedLengthMetres / 1_000 / areaSquareKilometres;
}

export function chooseRenderRadius(roads) {
  const measurements = RADIUS_CANDIDATES_METRES.map((radiusMetres) => ({
    radiusMetres,
    density: measureRoadDensity(roads, radiusMetres),
  }));
  const selected = measurements.filter(({ density }) => density >= TARGET_ROAD_DENSITY).at(-1)
    ?? measurements[0];
  return { radiusMetres: selected.radiusMetres, measurements };
}

function serializePolyline(points) {
  const rounded = [];
  for (const point of points) {
    const next = [Math.round(point[0]), Math.round(point[1])];
    if (Object.is(next[0], -0)) next[0] = 0;
    if (Object.is(next[1], -0)) next[1] = 0;
    if (!rounded.length || !samePoint(rounded.at(-1), next)) rounded.push(next);
  }
  if (rounded.length < 2) return '';
  return `M${rounded[0][0]} ${rounded[0][1]}${rounded.slice(1).map(([x, y]) => `L${x} ${y}`).join('')}`;
}

export function serializeSvg(classPaths, { maxBytes = MAX_SVG_BYTES } = {}) {
  const paths = ROAD_CLASSES.flatMap(({ name, strokeWidth }) => {
    const pathData = (classPaths[name] ?? []).map(serializePolyline).filter(Boolean).join('');
    if (!pathData) return [];
    return [`<path d="${pathData}" fill="none" stroke="#fff" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`];
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}">${paths.join('')}</svg>`;
  if (Buffer.byteLength(svg, 'utf8') > maxBytes) {
    throw new AmbientMapRendererError(RENDERER_ERROR_CODES.SVG_TOO_LARGE);
  }
  return svg;
}

export function validateOsmData(data, centre) {
  validateCoordinates(centre.latitude, centre.longitude);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.elements)) {
    throw invalidOsmStructure();
  }
  return data.elements.map((element) => {
    if (!element || typeof element !== 'object' || Array.isArray(element)
      || element.type !== 'way' || !element.tags || typeof element.tags !== 'object'
      || Array.isArray(element.tags) || !HIGHWAY_TYPE_SET.has(element.tags.highway)
      || !Array.isArray(element.geometry) || element.geometry.length < 2) {
      throw invalidOsmStructure();
    }
    const points = element.geometry.map((point) => projectToLocalMetres(point, centre));
    return { highway: element.tags.highway, points };
  });
}

export function renderAmbientMap(data, centre, options = {}) {
  const roads = validateOsmData(data, centre);
  const { radiusMetres } = chooseRenderRadius(roads);
  const bounds = renderBounds(radiusMetres);
  const classPaths = Object.fromEntries(ROAD_CLASSES.map(({ name }) => [name, []]));

  for (const road of roads) {
    const roadClass = classifyHighway(road.highway);
    for (const clippedPoints of clipPolyline(road.points, bounds)) {
      classPaths[roadClass].push(clippedPoints.map((point) => projectToViewBox(point, radiusMetres)));
    }
  }

  const svg = serializeSvg(classPaths, options);
  return {
    svgBytes: new TextEncoder().encode(svg),
    radiusMetres,
    wayCount: roads.length,
    algorithmVersion: ALGORITHM_VERSION,
  };
}
