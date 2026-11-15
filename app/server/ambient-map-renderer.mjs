export const ALGORITHM_VERSION = 2;
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

export function serializeSvg(classPaths, { maxBytes = MAX_SVG_BYTES, areas = [] } = {}) {
  const paths = ROAD_CLASSES.flatMap(({ name, strokeWidth }) => {
    const pathData = (classPaths[name] ?? []).map(serializePolyline).filter(Boolean).join('');
    if (!pathData) return [];
    return [`<path d="${pathData}" fill="none" stroke="#fff" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`];
  });
  // Definitions keep the default image a street mask. The service exposes
  // the same immutable asset's water/green definitions as separate masks.
  const definitions = ['green', 'water'].map((layer) => {
    const polygons = areas.filter((area) => area.layer === layer).map(({ rings }) => {
      const d = rings.map((ring) => `${serializePolyline(ring)}Z`).join('');
      return d ? `<path d="${d}" fill="#fff" fill-rule="evenodd"/>` : '';
    }).join('');
    return `<g id="${layer}">${polygons}</g>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}"><defs>${definitions}</defs>${paths.join('')}</svg>`;
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
  return data.elements.filter((element) => !classifyArea(element?.tags)).map((element) => {
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

export function classifyArea(tags) {
  if (!tags) return null;
  if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir') return 'water';
  if (['wood', 'grassland', 'scrub'].includes(tags.natural)
    || ['forest', 'meadow', 'grass', 'recreation_ground', 'village_green'].includes(tags.landuse)
    || ['park', 'garden'].includes(tags.leisure)) return 'green';
  return null;
}

// Overpass supplies relation member geometry, with outer rings often split
// into several ways. Join either direction; leave incomplete rings unfilled.
export function joinAreaRings(segments) {
  const remaining = segments.filter((points) => points.length >= 2).map((points) => [...points]);
  const rings = [];
  while (remaining.length) {
    const ring = remaining.pop();
    while (!samePoint(ring[0], ring.at(-1))) {
      const index = remaining.findIndex((part) => samePoint(ring.at(-1), part[0]) || samePoint(ring.at(-1), part.at(-1)));
      if (index < 0) break;
      const [part] = remaining.splice(index, 1);
      if (!samePoint(ring.at(-1), part[0])) part.reverse();
      ring.push(...part.slice(1));
    }
    if (ring.length >= 4 && samePoint(ring[0], ring.at(-1))) rings.push(ring);
  }
  return rings;
}

// Clip filled rings as polygons, never as independent street segments.
// This also keeps large forests/river relations outside the viewport out of SVG.
export function clipAreaRing(points, bounds) {
  let ring = points.slice(0, -1);
  for (const [axis, edge, keepAbove] of [[0, bounds.minX, true], [0, bounds.maxX, false], [1, bounds.minY, true], [1, bounds.maxY, false]]) {
    const input = ring;
    ring = [];
    if (!input.length) break;
    let previous = input.at(-1);
    let previousInside = keepAbove ? previous[axis] >= edge : previous[axis] <= edge;
    for (const point of input) {
      const inside = keepAbove ? point[axis] >= edge : point[axis] <= edge;
      if (inside !== previousInside) {
        const t = (edge - previous[axis]) / (point[axis] - previous[axis]);
        ring.push([previous[0] + t * (point[0] - previous[0]), previous[1] + t * (point[1] - previous[1])]);
      }
      if (inside) ring.push(point);
      previous = point;
      previousInside = inside;
    }
  }
  return ring.length >= 3 ? [...ring, ring[0]] : [];
}

export function projectAreas(data, centre, radiusMetres) {
  return data.elements.flatMap((element) => {
    const layer = classifyArea(element.tags);
    if (!layer) return [];
    const project = (geometry) => (geometry ?? []).map((point) => projectToLocalMetres(point, centre));
    let outer, inner;
    if (element.type === 'way') {
      outer = joinAreaRings([project(element.geometry)]);
      inner = [];
    } else if (element.type === 'relation' && element.tags.type === 'multipolygon') {
      const members = element.members ?? [];
      outer = joinAreaRings(members.filter((member) => member.type === 'way' && (member.role === 'outer' || member.role === '')).map((member) => project(member.geometry)));
      inner = joinAreaRings(members.filter((member) => member.type === 'way' && member.role === 'inner').map((member) => project(member.geometry)));
    } else return [];
    const bounds = renderBounds(radiusMetres);
    outer = outer.map((ring) => clipAreaRing(ring, bounds)).filter((ring) => ring.length);
    if (!outer.length) return [];
    inner = inner.map((ring) => clipAreaRing(ring, bounds)).filter((ring) => ring.length);
    return [{ layer, rings: [...outer, ...inner].map((ring) => ring.map((point) => projectToViewBox(point, radiusMetres))) }];
  });
}

export function ambientMapLayerSvg(svg, layer) {
  if (!['green', 'water'].includes(layer)) return svg;
  const content = svg.match(new RegExp(`<g id="${layer}">([\\s\\S]*?)</g>`))?.[1] ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}">${content}</svg>`;
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

  const svg = serializeSvg(classPaths, { ...options, areas: projectAreas(data, centre, radiusMetres) });
  return {
    svgBytes: new TextEncoder().encode(svg),
    radiusMetres,
    wayCount: roads.length,
    algorithmVersion: ALGORITHM_VERSION,
  };
}
