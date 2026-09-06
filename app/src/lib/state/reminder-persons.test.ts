import { describe, expect, it } from 'vitest';
import { adoptHaPersons, DEFAULT_REMINDER_PERSONS } from './reminder-persons.ts';

/* Paket 8: Wer seine Bewohner in Home Assistant gepflegt hat, soll sie nicht
   ein zweites Mal eintippen. */
describe('Bewohner aus Home Assistant übernehmen', () => {
  const defaults = () => DEFAULT_REMINDER_PERSONS.map((person) => ({ ...person }));

  it('ordnet namensgleiche Bewohner zu, statt sie zu verdoppeln', () => {
    const result = adoptHaPersons(defaults(), [
      { entityId: 'person.alex', name: 'Alex' },
      { entityId: 'person.sam', name: 'Sam' },
    ]);
    expect(result).toHaveLength(3);
    expect(result.find((person) => person.id === 'alex')?.personEntityId).toBe('person.alex');
    expect(result.find((person) => person.id === 'sam')?.personEntityId).toBe('person.sam');
    expect(result.find((person) => person.id === 'beide')?.personEntityId ?? null).toBeNull();
  });

  it('legt unbekannte Personen als neue Bewohner an', () => {
    const result = adoptHaPersons(defaults(), [{ entityId: 'person.alva', name: 'Alva' }]);
    const alva = result.find((person) => person.id === 'alva');
    expect(alva).toMatchObject({ label: 'Alva', personEntityId: 'person.alva' });
    expect(alva?.color).toBeTruthy();
  });

  it('trifft auch über den umbenannten Anzeigenamen', () => {
    const existing = [{ id: 'p1', label: 'Alex', color: 'gruen', personEntityId: null }];
    const result = adoptHaPersons(existing, [{ entityId: 'person.alex', name: 'alex' }]);
    expect(result).toHaveLength(1);
    expect(result[0].personEntityId).toBe('person.alex');
  });

  it('lässt bestehende Zuordnungen unangetastet', () => {
    const existing = [{ id: 'sam', label: null, color: 'gelb', personEntityId: 'person.sam_alt' }];
    const result = adoptHaPersons(existing, [{ entityId: 'person.sam', name: 'Sam' }]);
    expect(result[0].personEntityId).toBe('person.sam_alt');
    expect(result).toHaveLength(1); // kein zweiter „Sam"
  });

  it('ordnet dieselbe Entität nicht zweimal zu', () => {
    const result = adoptHaPersons(defaults(), [
      { entityId: 'person.sam', name: 'Sam' },
      { entityId: 'person.sam', name: 'Sam' },
    ]);
    expect(result.filter((person) => person.personEntityId === 'person.sam')).toHaveLength(1);
  });

  it('überspringt Personen ohne verwertbaren Namen', () => {
    const result = adoptHaPersons(defaults(), [{ entityId: 'person.x', name: '   ' }]);
    expect(result).toHaveLength(3);
  });
});
