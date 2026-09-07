import type { FanValue } from '../adapter/types.ts';

/* Preset-Modi der fan-Domäne kommen als freie Zeichenketten aus Home Assistant
   („auto", „sleep", „nature" …) — sie sind Gerätewahrheit und werden deshalb
   NICHT übersetzt, nur lesbar gesetzt. Das Symbol ist eine reine Anzeigehilfe;
   unbekannte Modi bekommen das Ventilator-Symbol. */
const PRESET_ICONS: Record<string, string> = {
  normal: 'i-fan',
  standard: 'i-fan',
  manual: 'i-fan',
  auto: 'i-fan-auto',
  smart: 'i-fan-auto',
  breeze: 'i-waves',
  nature: 'i-waves',
  natural: 'i-waves',
  sleep: 'i-weather-night',
  night: 'i-weather-night',
  silent: 'i-weather-night',
  quiet: 'i-weather-night',
  turbo: 'i-fan-speed-3',
  boost: 'i-fan-speed-3',
  max: 'i-fan-speed-3',
  powerful: 'i-fan-speed-3',
  eco: 'i-leaf',
};

export function fanPresetIcon(preset: string): string {
  return PRESET_ICONS[preset.trim().toLowerCase()] ?? 'i-fan';
}

/** „sleep_mode" → „Sleep Mode": Unterstriche weg, Wortanfänge groß. */
export function fanPresetLabel(preset: string): string {
  return preset
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

/* Ein laufender Ventilator dreht sein Symbol, ein stehender nicht: `null`
   heißt „keine Animation". Das Tempo folgt der Stufe (volle Stufe ~0,6 s je
   Umdrehung, kleinste ~2,5 s); meldet das Gerät keine Stufe, dreht es in einem
   mittleren Tempo, statt eine Zahl zu behaupten, die es nicht gibt. */
export function fanSpinDuration(fan: FanValue | undefined): string | null {
  if (!fan?.on) return null;
  const percentage = fan.supportsSpeed ? Math.max(5, Math.min(100, fan.percentage)) : 55;
  return `${(2.6 - (percentage / 100) * 2).toFixed(2)}s`;
}
