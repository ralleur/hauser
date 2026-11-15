// SPDX-License-Identifier: AGPL-3.0-only
export type MapPoint = [number, number];
export interface CommutePlace { label: string; latitude: number; longitude: number }
export interface CommuteConfig { entryId: string; days: number[]; from: string; until: string; arrival: string; parkingEntity: string; showRain: boolean; places?: { start: CommutePlace; destination: CommutePlace } }
export interface CommuteRoute {
  name: string; durationMinutes: number; delayMinutes: number | null; updatedAt: string;
  line: MapPoint[]; roads: MapPoint[][]; mapKey?: string;
  areas?: { layer: 'green' | 'water'; rings: MapPoint[][] }[];
  sections: { points: MapPoint[]; severe: boolean; category: string }[];
  reports: { title: string; category: string; delay: number; point: MapPoint | null }[];
  parking: { name: string; state: string; unit: string } | null;
  rainAt: string | null;
}
export interface CommuteStatus { config: CommuteConfig; route: CommuteRoute | null; unavailable?: boolean }
export const defaultCommute: CommuteConfig = { entryId: '', days: [1, 2, 3, 4, 5], from: '06:00', until: '09:00', arrival: '08:00', parkingEntity: '', showRain: true };

export function inCommuteWindow(config: CommuteConfig, now: Date): boolean {
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (config.from <= config.until) return config.days.includes(now.getDay()) && hm >= config.from && hm < config.until;
  const day = hm < config.until ? (now.getDay() + 6) % 7 : now.getDay();
  return config.days.includes(day) && (hm >= config.from || hm < config.until);
}

export function departureFor(config: CommuteConfig, duration: number, now: Date): { at: Date; minutes: number } {
  const arrival = new Date(now);
  const [hours, minutes] = config.arrival.split(':').map(Number);
  arrival.setHours(hours, minutes, 0, 0);
  if (config.from > config.until && now.getHours() >= Number(config.from.slice(0, 2)) && config.arrival < config.from) arrival.setDate(arrival.getDate() + 1);
  const at = new Date(arrival.getTime() - duration * 60_000);
  return { at, minutes: Math.ceil((at.getTime() - now.getTime()) / 60_000) };
}

export function freshCommute(route: CommuteRoute | null, now: Date): route is CommuteRoute {
  if (!route) return false;
  const age = now.getTime() - Date.parse(route.updatedAt);
  return Number.isFinite(age) && age >= -60_000 && age < 30 * 60_000;
}

export function mapPath(points: MapPoint[]): string {
  return points.map((p, index) => `${index ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
}
