import { describe, expect, it } from 'vitest';
import type { LaundryAdapterConfig } from '../config/household-config.ts';
import { normalizeLaundryState } from './notifications.ts';

const binaryAdapter: LaundryAdapterConfig = {
  type: 'entity',
  entityId: 'binary_sensor.fixture_washer',
  runningStates: ['on'],
  doneStates: ['off'],
  doneOnInitial: false,
};

const enumAdapter: LaundryAdapterConfig = {
  type: 'entity',
  entityId: 'sensor.fixture_dryer_status',
  runningStates: ['running'],
  doneStates: ['done'],
  doneOnInitial: true,
  cycleMarkerEntityId: 'automation.fixture_dryer_cycle',
};

describe('laundry state normalization', () => {
  it('normalizes binary and enum-shaped runtime values without visible-text coupling', () => {
    expect(normalizeLaundryState(binaryAdapter, { on: true, changedAt: 100 })).toEqual({
      state: 'running', doneOnInitial: false, changedAt: 100,
    });
    expect(normalizeLaundryState(binaryAdapter, { on: false, changedAt: 200 })).toEqual({
      state: 'done', doneOnInitial: false, changedAt: 200,
    });
    expect(normalizeLaundryState(
      enumAdapter,
      { state: 'done', changedAt: 300 },
      { state: 'on', lastTriggered: '2026-08-02T08:00:00+00:00' },
    )).toEqual({
      state: 'done', doneOnInitial: true, changedAt: 300,
      cycleId: '2026-08-02T08:00:00+00:00',
    });
  });

  it('fails closed for missing, unavailable and unmapped states', () => {
    expect(normalizeLaundryState(binaryAdapter, undefined)).toBeUndefined();
    expect(normalizeLaundryState(binaryAdapter, { state: 'unknown', changedAt: 100 })).toBeUndefined();
    expect(normalizeLaundryState(binaryAdapter, { state: 'unavailable', changedAt: 200 })).toBeUndefined();
    expect(normalizeLaundryState(enumAdapter, { state: 'unavailable' })).toBeUndefined();
    expect(normalizeLaundryState(enumAdapter, { state: 'paused' })).toBeUndefined();
    expect(normalizeLaundryState(enumAdapter, { state: 'done' })).toBeUndefined();
    expect(normalizeLaundryState(enumAdapter, { state: 'done' }, { lastTriggered: '' })).toBeUndefined();
    expect(normalizeLaundryState(enumAdapter, { state: 'done' }, { lastTriggered: '   ' })).toBeUndefined();
    expect(normalizeLaundryState(enumAdapter, { state: 'done' }, { lastTriggered: 42 })).toBeUndefined();
  });
});
