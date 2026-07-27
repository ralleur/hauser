import type { SunValue } from '../adapter/types.ts';
import type { UiTheme } from './room-hero-assets.ts';

export type EnergyVariant = 'day' | 'night';

export interface EnergyAssetInput {
  baseUrl: string;
  sun: SunValue | undefined;
  fallbackTheme: UiTheme;
}

/**
 * Energy-Eyecatcher folgt wie RoomHero der realen Tageszeit (`sun.sun`), nicht
 * dem manuellen UI-Theme. Der Theme-Toggle darf Lesbarkeit/Surfaces ändern,
 * aber nicht den Energie-Motivzustand verfälschen.
 */
export function selectEnergyVariant(sun: SunValue | undefined, fallbackTheme: UiTheme): EnergyVariant {
  if (sun) return sun.day ? 'day' : 'night';
  return fallbackTheme === 'light' ? 'day' : 'night';
}

export function energyAssetUrl({ baseUrl, sun, fallbackTheme }: EnergyAssetInput): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const variant = selectEnergyVariant(sun, fallbackTheme);
  const file = variant === 'day' ? 'day.avif' : 'night.png';
  return `${base}energy/${file}`;
}
