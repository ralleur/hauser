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
  // Round outward so small layout changes can reuse the same map.
  const step = 256;
  return [Math.floor((-margin - tx) / scale / step) * step, Math.floor((-margin - ty) / scale / step) * step,
    Math.ceil((width + margin - tx) / scale / step) * step, Math.ceil((height + margin - ty) / scale / step) * step];
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
  if (width < 480) return stacked;

  const rowHeight = Math.max(clockHeight, cardHeight);
  const row = fit(x, y + (rowHeight - clockHeight) / 2, x + width - panelWidth, y + (rowHeight - cardHeight) / 2, {
    x, y: y + rowHeight + gap, width, height: Math.max(0, height - rowHeight - gap),
  });
  if (clockHeight + gap + cardHeight > height) return row;

  const clockY = y + (height - clockHeight - cardHeight - gap) / 2;
  const side = fit(x, clockY, x, clockY + clockHeight + gap, { x: x + panelWidth + gap, y, width: width - panelWidth - gap, height });
  return side.scale >= row.scale ? side : row;
}

export function mapPath(points: MapPoint[]): string {
  return points.map((p, index) => `${index ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
}
