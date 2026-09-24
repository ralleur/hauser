import { describe, expect, it } from 'vitest';
import {
  balanceAxis, balanceCounted, balancePercent, balanceSegments, balanceSelfUsePercent, energyBalanceToday,
} from './energy-balance.ts';

describe('Tagesbilanz (wie die iOS-App)', () => {
  it('rechnet mit Einspeisung und Bezug das volle Bild', () => {
    const balance = energyBalanceToday({ produced: 12, consumed: null, fedIn: 7, drawn: 3 });
    expect(balance).toMatchObject({ kind: 'split', produced: 12, consumed: 8, ownUse: 5, fedIn: 7, drawn: 3, meter: null });
    expect(balancePercent(balance!)).toBe(63);
    expect(balanceSelfUsePercent(balance!)).toBe(42);
    expect(balanceSegments(balance!, 0)).toEqual([{ part: 'ownUse', from: 0, to: 5 }, { part: 'fedIn', from: 5, to: 12 }]);
    expect(balanceSegments(balance!, 1)).toEqual([{ part: 'ownUse', from: 0, to: 5 }, { part: 'drawn', from: 5, to: 8 }]);
  });

  it('nennt den Zähler „Verbraucht" nur, wenn er von der Bilanz abweicht', () => {
    expect(energyBalanceToday({ produced: 12, consumed: 8.02, fedIn: 7, drawn: 3 })?.meter).toBeNull();
    expect(energyBalanceToday({ produced: 12, consumed: 4.5, fedIn: 7, drawn: 3 })?.meter).toBe(4.5);
  });

  it('bleibt ohne Netzzähler eine Bilanz und ohne Erzeugung ganz weg', () => {
    const net = energyBalanceToday({ produced: 4, consumed: 10, fedIn: null, drawn: null });
    expect(net).toMatchObject({ kind: 'net', produced: 4, consumed: 10 });
    expect(balancePercent(net!)).toBe(40);
    expect(balancePercent(energyBalanceToday({ produced: 12, consumed: 10, fedIn: null, drawn: null })!)).toBeNull();
    expect(energyBalanceToday({ produced: null, consumed: 10, fedIn: 1, drawn: 2 })).toBeNull();
    expect(energyBalanceToday({ produced: 4, consumed: null, fedIn: null, drawn: 2 })).toBeNull();
  });

  it('nimmt kaputte Zähler nicht als Tageswert', () => {
    expect(energyBalanceToday({ produced: Number.NaN, consumed: 1, fedIn: 0, drawn: 1 })).toBeNull();
    expect(energyBalanceToday({ produced: -3, consumed: 1, fedIn: 0, drawn: 1 })).toBeNull();
    /* Mehr eingespeist als erzeugt: die Zähler passen nicht zusammen. */
    expect(energyBalanceToday({ produced: 2, consumed: 5, fedIn: 9, drawn: 4 })?.kind).toBe('net');
  });

  it('zeigt nie 0 % bei etwas Sonne und nie 100 % bei einem Rest', () => {
    const tiny = energyBalanceToday({ produced: 0.06, consumed: null, fedIn: 0, drawn: 20 })!;
    expect(balancePercent(tiny)).toBe(1);
    const almost = energyBalanceToday({ produced: 30, consumed: null, fedIn: 10, drawn: 0.06 })!;
    expect(balancePercent(almost)).toBe(99);
    expect(balanceCounted(energyBalanceToday({ produced: 0, consumed: null, fedIn: 0, drawn: 0.05 })!)).toBe(false);
  });

  it('legt die Achse auf runde Schritte', () => {
    expect(balanceAxis(12)).toEqual({ top: 15, step: 5, ticks: [0, 5, 10, 15] });
    expect(balanceAxis(0.3)).toEqual({ top: 0.5, step: 0.1, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5] });
  });
});
