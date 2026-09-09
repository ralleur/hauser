import { m } from '../../paraglide/messages.js';
import { fanPresetLabel } from './fan-presets.ts';

/* Zustands- und Aktionslabels der Domänen aus R28. Rohzustände von Home
   Assistant (docked, jammed, armed_home …) werden übersetzt; freie
   Gerätestrings (Saugstufen, Betriebsarten) nur lesbar gesetzt (fan-presets). */

export function vacuumStateLabel(state: string): string {
  switch (state) {
    case 'cleaning': return m.state_cleaning();
    case 'returning': return m.state_returning();
    case 'paused': return m.dev_paused();
    case 'docked': return m.state_docked();
    case 'idle': return m.state_idle();
    case 'error': return m.state_error();
    default: return fanPresetLabel(state);
  }
}

export function lockStateLabel(state: string): string {
  switch (state) {
    case 'locked': return m.state_locked();
    case 'unlocked': return m.state_unlocked();
    case 'locking': return m.state_locking();
    case 'unlocking': return m.state_unlocking();
    case 'jammed': return m.state_jammed();
    case 'open': return m.state_open();
    default: return fanPresetLabel(state);
  }
}

export function coverStateLabel(on: boolean, moving: 'opening' | 'closing' | null): string {
  if (moving === 'opening') return m.state_opening();
  if (moving === 'closing') return m.state_closing();
  return on ? m.state_open() : m.state_closed();
}

export function mowerStateLabel(state: string): string {
  switch (state) {
    case 'mowing': return m.state_mowing();
    case 'paused': return m.dev_paused();
    case 'docked': return m.state_docked();
    case 'error': return m.state_error();
    default: return fanPresetLabel(state);
  }
}

export function alarmStateLabel(state: string): string {
  switch (state) {
    case 'disarmed': return m.state_disarmed();
    case 'armed_home': return m.dev_arm_home();
    case 'armed_away': return m.dev_arm_away();
    case 'armed_night': return m.dev_arm_night();
    case 'armed_vacation': return m.dev_arm_vacation();
    case 'armed_custom_bypass': return m.dev_arm_custom();
    case 'arming': return m.state_arming();
    case 'pending': return m.state_pending();
    case 'triggered': return m.state_triggered();
    default: return fanPresetLabel(state);
  }
}

/* Symbol je Gerätemodus (Saugstufe, Befeuchter, Warmwasser, Klima-Lüfter):
   reine Anzeigehilfe, unbekannte Modi bekommen das Fallback des Aufrufers. */
const MODE_ICONS: Record<string, string> = {
  auto: 'i-thermostat-auto',
  smart: 'i-thermostat-auto',
  eco: 'i-leaf',
  sleep: 'i-weather-night',
  night: 'i-weather-night',
  quiet: 'i-weather-night',
  silent: 'i-weather-night',
  low: 'i-fan-speed-1',
  min: 'i-fan-speed-1',
  medium: 'i-fan-speed-2',
  mid: 'i-fan-speed-2',
  standard: 'i-fan-speed-2',
  normal: 'i-fan-speed-2',
  high: 'i-fan-speed-3',
  max: 'i-fan-speed-3',
  turbo: 'i-fan-speed-3',
  boost: 'i-fan-speed-3',
  performance: 'i-fan-speed-3',
  electric: 'i-flash',
  gas: 'i-fire',
  heat_pump: 'i-heat-pump',
  high_demand: 'i-fire',
  away: 'i-walk',
  home: 'i-home',
  comfort: 'i-sofa',
  off: 'i-power',
  on: 'i-power',
  none: 'i-minus',
  vertical: 'i-arrow-up-down',
  horizontal: 'i-arrow-left-right',
  both: 'i-arrow-all',
};

export function modeIcon(mode: string, fallback: string): string {
  return MODE_ICONS[mode.trim().toLowerCase()] ?? fallback;
}

export { fanPresetLabel as modeLabel };
