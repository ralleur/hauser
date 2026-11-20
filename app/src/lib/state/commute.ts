// SPDX-License-Identifier: AGPL-3.0-only
export type MapPoint = [number, number];

export function formatCommuteDuration(minutes: number, locale: string): string {
  const total = Math.max(0, Math.round(minutes));
  const unit = (value: number, name: 'hour' | 'minute') => new Intl.NumberFormat(locale, {
    style: 'unit', unit: name, unitDisplay: 'short',
  }).format(value);
  if (total < 60) return unit(total, 'minute');
  return [unit(Math.floor(total / 60), 'hour'), total % 60 ? unit(total % 60, 'minute') : ''].filter(Boolean).join(' ');
}
export type CommuteMapBounds = [minX: number, minY: number, maxX: number, maxY: number];
export interface CommutePlace { label: string; latitude: number; longitude: number }
export interface CommuteConfig {
  entryId: string; days: number[]; from: string; until: string; arrival: string; showRain: boolean;
  arrivals?: Record<number, string>; nextArrival?: { date: string; time: string };
  places?: { start: CommutePlace; destination: CommutePlace };
}
export interface CommuteRoute {
  name: string; durationMinutes: number; delayMinutes: number | null; updatedAt: string;
  line: MapPoint[]; roads: MapPoint[][]; mapKey?: string;
  mapStatus?: 'loading' | 'ready' | 'unavailable' | 'too-large';
  mapSource?: 'openfreemap';
  simulated?: boolean;
  areas?: { layer: 'green' | 'water'; rings: MapPoint[][] }[];
  sections: { points: MapPoint[]; severe: boolean; category: string }[];
  reports: { title: string; category: string; group?: 'traffic' | 'weather' | 'camera'; delay: number; point: MapPoint | null }[];
  cameraCount?: number;
  rainAt?: string | null;
  snowAt?: string | null;
}
export interface CommuteStatus { config: CommuteConfig; route: CommuteRoute | null; unavailable?: boolean }
export const defaultCommute: CommuteConfig = { entryId: '', days: [1, 2, 3, 4, 5], from: '06:00', until: '09:00', arrival: '08:00', showRain: true };

function clockTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function inCommuteWindow(config: CommuteConfig, now: Date): boolean {
  const hm = clockTime(now);
  if (config.from <= config.until) return config.days.includes(now.getDay()) && hm >= config.from && hm < config.until;
  const day = hm < config.until ? (now.getDay() + 6) % 7 : now.getDay();
  return config.days.includes(day) && (hm >= config.from || hm < config.until);
}

export function nextCommuteDay(config: CommuteConfig, now: Date): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const hm = clockTime(now);
  if (config.from > config.until && hm < config.until && inCommuteWindow(config, now)) day.setDate(day.getDate() - 1);
  if (config.from <= config.until && hm >= config.until) day.setDate(day.getDate() + 1);
  for (let offset = 0; offset < 7 && config.days.length && !config.days.includes(day.getDay()); offset++) day.setDate(day.getDate() + 1);
  return day;
}

export function commuteDateKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function arrivalFor(config: CommuteConfig, day: Date): string {
  if (config.nextArrival?.date === commuteDateKey(day)) return config.nextArrival.time;
  return config.arrivals?.[day.getDay()] ?? config.arrival;
}

export function departureFor(config: CommuteConfig, duration: number, now: Date): { at: Date; minutes: number; arrival: string } {
  const day = nextCommuteDay(config, now);
  const arrival = arrivalFor(config, day);
  const [hours, minutes] = arrival.split(':').map(Number);
  if (config.from > config.until && arrival < config.from) day.setDate(day.getDate() + 1);
  day.setHours(hours, minutes, 0, 0);
  const at = new Date(day.getTime() - duration * 60_000);
  return { at, arrival, minutes: Math.ceil((at.getTime() - now.getTime()) / 60_000) };
}

export function freshCommute(route: CommuteRoute | null, now: Date): route is CommuteRoute {
  if (!route) return false;
  const age = now.getTime() - Date.parse(route.updatedAt);
  return Number.isFinite(age) && age >= -60_000 && age < 30 * 60_000;
}

export function commutePanelWidth(width: number, gap: number): number {
  return Math.min(360, width >= 480 ? (width - gap) / 2 : width);
}

export function commuteMapCoverage(width: number, height: number, { scale, tx, ty }: { scale: number; tx: number; ty: number }, margin: number): CommuteMapBounds {
  // Preload a quarter viewport beyond every edge, including the wide space
  // beside vertical routes. Round outward so layout changes reuse the map.
  const marginX = Math.max(margin, width / 4), marginY = Math.max(margin, height / 4);
  const step = 256;
  return [Math.floor((-marginX - tx) / scale / step) * step, Math.floor((-marginY - ty) / scale / step) * step,
    Math.ceil((width + marginX - tx) / scale / step) * step, Math.ceil((height + marginY - ty) / scale / step) * step];
}

export function fitCommuteLayout(line: MapPoint[], area: { x: number; y: number; width: number; height: number }, gap: number, panelWidth: number, clockHeight: number, cardHeight: number) {
  const { x, y, width, height } = area;
  const xs = line.map(([x]) => x), ys = line.map(([, y]) => y);
  const minX = Math.min(...xs) - 20, maxX = Math.max(...xs) + 20;
  const minY = Math.min(...ys) - 44, maxY = Math.max(...ys) + 12;
  const fit = (clockX: number, clockY: number, cardX: number, cardY: number, map: typeof area) => {
    const scale = Math.min(Math.max(1, map.width - gap * 2) / (maxX - minX), Math.max(1, map.height - gap * 2) / (maxY - minY));
    const tx = map.x + map.width / 2 - (minX + maxX) / 2 * scale;
    const ty = map.y + map.height / 2 - (minY + maxY) / 2 * scale;
    return { clockX, clockY, cardX, cardY, scale, tx, ty };
  };

  const centeredX = x + (width - panelWidth) / 2;
  const cardY = y + height - cardHeight;
  const stacked = fit(centeredX, y, centeredX, cardY, {
    x, y: y + clockHeight + gap, width, height: Math.max(0, height - clockHeight - cardHeight - gap * 2),
  });
  const rowHeight = Math.max(clockHeight, cardHeight);
  const row = fit(x, y + (rowHeight - clockHeight) / 2, x + width - panelWidth, y + (rowHeight - cardHeight) / 2, {
    x, y: y + rowHeight + gap, width, height: Math.max(0, height - rowHeight - gap),
  });
  const clockY = y + (height - clockHeight - cardHeight - gap) / 2;
  const side = fit(x, clockY, x, clockY + clockHeight + gap, { x: x + panelWidth + gap, y, width: width - panelWidth - gap, height });
  let best = width < 480 ? stacked : clockHeight + gap + cardHeight > height ? row : side.scale >= row.scale ? side : row;

  // Fit the route first. Clock and card may use the empty corners alongside a
  // diagonal route instead of reserving an entire row or column for themselves.
  type Rect = typeof area;
  const overlaps = (a: Rect, b: Rect, padding = 0) => a.x < b.x + b.width + padding && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
  const placements = (panelHeight: number, otherHeight: number, rightFirst: boolean) => {
    const edges = [x, x + width - panelWidth];
    if (rightFirst) edges.reverse();
    return [...new Set([y, y + height - panelHeight, y + otherHeight + gap, y + height - panelHeight - otherHeight - gap, y + (height - panelHeight) / 2])]
      .flatMap(top => [...new Set([...edges, centeredX])].map(left => ({ x: left, y: top, width: panelWidth, height: panelHeight })))
      .filter(rect => rect.x >= x && rect.y >= y && rect.x + rect.width <= x + width && rect.y + rect.height <= y + height);
  };
  const clocks = placements(clockHeight, cardHeight, false), cards = placements(cardHeight, clockHeight, true);
  function routeClears(rect: Rect, scale: number, tx: number, ty: number) {
    const box = { x: (rect.x - gap - tx) / scale, y: (rect.y - gap - ty) / scale,
      width: (rect.width + gap * 2) / scale, height: (rect.height + gap * 2) / scale };
    for (const point of [line[0], line[line.length - 1]]) {
      if (overlaps(box, { x: point[0] - 20, y: point[1] - 44, width: 40, height: 56 })) return false;
    }
    for (let i = 1; i < line.length; i++) {
      let start = 0, end = 1;
      for (let axis = 0; axis < 2; axis++) {
        const origin = line[i - 1][axis], delta = line[i][axis] - origin;
        const low = axis === 0 ? box.x : box.y, high = low + (axis === 0 ? box.width : box.height);
        if (delta === 0) { if (origin < low || origin > high) { end = -1; break; } }
        else {
          const a = (low - origin) / delta, b = (high - origin) / delta;
          start = Math.max(start, Math.min(a, b)); end = Math.min(end, Math.max(a, b));
        }
      }
      if (start <= end) return false;
    }
    return true;
  }
  function arrange(scale: number) {
    const mapWidth = (maxX - minX) * scale + gap * 2, mapHeight = (maxY - minY) * scale + gap * 2;
    for (const horizontal of [.5, 0, 1]) for (const vertical of [.5, 0, 1]) {
      const tx = x + (width - mapWidth) * horizontal + gap - minX * scale;
      const ty = y + (height - mapHeight) * vertical + gap - minY * scale;
      const freeClocks = clocks.filter(rect => routeClears(rect, scale, tx, ty));
      if (!freeClocks.length) continue;
      for (const card of cards) {
        const clock = freeClocks.find(clock => !overlaps(clock, card, gap));
        if (clock && routeClears(card, scale, tx, ty)) return { clockX: clock.x, clockY: clock.y, cardX: card.x, cardY: card.y, scale, tx, ty };
      }
    }
  }
  let low = best.scale, high = fit(x, y, x, y, area).scale;
  const full = arrange(high);
  if (full) return full;
  for (let step = 0; step < 7 && high > low; step++) {
    const scale = (low + high) / 2, layout = arrange(scale);
    if (layout) { best = layout; low = scale; } else high = scale;
  }
  return best;
}

export function mapPath(points: MapPoint[]): string {
  return points.map((p, index) => `${index ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
}
