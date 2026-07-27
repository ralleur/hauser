import { describe, expect, it } from 'vitest';
import { binaryLabel, fmtSensor } from './info-display.ts';

describe('binaryLabel (device_class → Zustandslabel)', () => {
  it('kennt die gängigen device_classes', () => {
    expect(binaryLabel('window', true)).toBe('Offen');
    expect(binaryLabel('window', false)).toBe('Geschlossen');
    expect(binaryLabel('motion', true)).toBe('Bewegung');
    expect(binaryLabel('occupancy', false)).toBe('Abwesend');
    expect(binaryLabel('battery', true)).toBe('Batterie schwach');
  });

  it('fällt ohne/bei unbekannter device_class auf Ein/Aus zurück', () => {
    expect(binaryLabel(null, true)).toBe('Ein');
    expect(binaryLabel(undefined, false)).toBe('Aus');
    expect(binaryLabel('vibration', true)).toBe('Ein');
  });
});

describe('fmtSensor (Messwert de-DE + Einheit)', () => {
  it('formatiert mit max. 1 Dezimale und hängt die Einheit an', () => {
    expect(fmtSensor(21.43, '°C')).toBe('21,4 °C');
    expect(fmtSensor(900, 'W')).toBe('900 W');
    expect(fmtSensor(2.1)).toBe('2,1');
  });

  it('unavailable/unknown (null) → Gedankenstrich', () => {
    expect(fmtSensor(null, '°C')).toBe('—');
    expect(fmtSensor(undefined)).toBe('—');
  });
});
