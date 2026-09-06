import { describe, expect, it } from 'vitest';
import { everyoneAway, GREETING_TTL_MS, homeIds, nextArrival } from './presence.ts';

const T0 = 1_700_000_000_000;

describe('Präsenz (Paket 8)', () => {
  it('niemand da heißt: zugeordnet und alle unterwegs', () => {
    expect(everyoneAway([])).toBe(false);
    expect(everyoneAway([{ entityId: 'person.a', home: false }])).toBe(true);
    expect(everyoneAway([
      { entityId: 'person.a', home: false },
      { entityId: 'person.b', home: true },
    ])).toBe(false);
  });

  it('begrüßt, wer ein leeres Haus wieder füllt', () => {
    const arrival = nextArrival([], ['person.a'], null, T0);
    expect(arrival).toEqual({ entityId: 'person.a', at: T0 });
  });

  it('begrüßt nicht, wer zu jemandem dazukommt', () => {
    expect(nextArrival(['person.a'], ['person.a', 'person.b'], null, T0)).toBeNull();
  });

  it('hält die Begrüßung, solange die Person da ist und die Zeit läuft', () => {
    const first = nextArrival([], ['person.a'], null, T0)!;
    const later = nextArrival(['person.a'], ['person.a'], first, T0 + 60_000);
    expect(later).toBe(first);
  });

  it('lässt die Begrüßung nach einer halben Stunde fallen', () => {
    const first = nextArrival([], ['person.a'], null, T0)!;
    expect(nextArrival(['person.a'], ['person.a'], first, T0 + GREETING_TTL_MS)).toBeNull();
  });

  it('lässt die Begrüßung fallen, wenn die Person wieder geht', () => {
    const first = nextArrival([], ['person.a'], null, T0)!;
    expect(nextArrival(['person.a'], [], first, T0 + 1000)).toBeNull();
  });

  it('homeIds liefert nur die Anwesenden', () => {
    expect(homeIds([
      { entityId: 'person.a', home: true },
      { entityId: 'person.b', home: false },
    ])).toEqual(['person.a']);
  });
});
