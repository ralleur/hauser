// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Node server module.
import { commutePlace, writeTomTomRoute } from '../../server/commute-route-editor.mjs';

const start = { label: 'Home', latitude: 50.9, longitude: 6.8 };
const destination = { label: 'Office', latitude: 51, longitude: 7.1 };
const config = { days: [1, 3, 4], from: '06:30', until: '09:00' };
const schema = [
  { name: 'categories', default: ['jam', 'accident'] },
  { name: 'kind_camera', type: 'expandable', schema: [{ name: 'blitzer', default: false }, { name: 'lufop', default: true }] },
  { name: 'optional', type: 'expandable', schema: [
    { name: 'update_interval', default: 15 }, { name: 'count', default: 47 },
    { name: 'roads', description: { suggested_value: 'A3' } },
  ] },
  { name: 'return_route', default: true },
];

function setup(steps: string[], failAt?: string) {
  let index = 0;
  const rest = vi.fn(async (_method: string, _path: string, _body?: unknown) => {
    if (_method === 'DELETE') return { status: 200, body: {} };
    const step = steps[index++];
    return { status: 200, body: step === 'done' ? { type: 'create_entry', result: { entry_id: 'new-work' } }
      : { type: 'form', flow_id: 'flow-1', step_id: step, data_schema: schema, ...(step === failAt ? { errors: { base: 'cannot_connect' } } : {}) } };
  });
  return { rest };
}

describe('Managing a TomTom commute through HA', () => {
  it('creates one route with the chosen points and office schedule while retaining integration defaults', async () => {
    const client = setup(['user', 'route_start', 'route_start_point', 'route_destination', 'route_destination_point', 'route_vias', 'route_review', 'done']);
    expect(await writeTomTomRoute(client, { entryId: '', name: 'Work', start, destination, config })).toBe('new-work');
    expect(client.rest).toHaveBeenCalledWith('POST', '/api/config/config_entries/flow', { handler: 'tomtom' });
    const submitted = client.rest.mock.calls.at(-1)?.[2];
    expect(submitted).toMatchObject({ live_days: ['mon', 'wed', 'thu'], live_from: '06:30:00', live_until: '09:00:00', return_route: false,
      optional: { update_interval: 15, count: 47, roads: 'A3' }, kind_camera: { blitzer: false, lufop: true } });
  });
  it('edits the existing entry instead of creating duplicates and keeps its intermediate stops', async () => {
    const client = setup(['init', 'route_start', 'route_start_point', 'route_destination', 'route_destination_point', 'route_vias', 'route_review', 'done']);
    expect(await writeTomTomRoute(client, { entryId: 'work', start, destination, config })).toBe('work');
    expect(client.rest).toHaveBeenCalledWith('POST', '/api/config/config_entries/options/flow', { handler: 'work' });
    expect(client.rest.mock.calls.some((call) => (call[2] as { next_step_id?: string })?.next_step_id === 'route_vias_clear')).toBe(false);
  });
  it('updates office hours without replacing endpoints and aborts a failed setup before saving', async () => {
    const client = setup(['init', 'route_review', 'done']);
    await writeTomTomRoute(client, { entryId: 'work', config });
    expect(client.rest).toHaveBeenCalledWith('POST', '/api/config/config_entries/options/flow/flow-1', { next_step_id: 'edit_route_settings' });
    const failed = setup(['user', 'route_start', 'route_failed'], 'route_failed');
    await expect(writeTomTomRoute(failed, { entryId: '', name: 'Work', start, destination, config })).rejects.toThrow();
    expect(failed.rest).toHaveBeenLastCalledWith('DELETE', '/api/config/config_entries/flow/flow-1');
  });
  it('accepts named coordinates and rejects invalid or unselected search results', () => {
    expect(commutePlace(start)).toEqual(start);
    expect(commutePlace({ ...start, latitude: NaN })).toBeNull();
    expect(commutePlace({ ...start, label: '' })).toBeNull();
    expect(commutePlace({ label: 'Unselected address' })).toBeNull();
  });
});
