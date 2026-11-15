// SPDX-License-Identifier: AGPL-3.0-only
// Use HA's TomTom setup forms; the provider key never leaves the integration.
export function commutePlace(value) {
  if (!value || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 300
    || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 85
    || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) return null;
  return { label: value.label.trim(), latitude: value.latitude, longitude: value.longitude };
}

function formValues(schema) {
  const values = {};
  for (const field of schema ?? []) {
    if (field.type === 'expandable' || field.type === 'section') values[field.name] = formValues(field.schema);
    else if (field.default !== undefined) values[field.name] = field.default;
    else if (field.description?.suggested_value !== undefined && field.description.suggested_value !== null) values[field.name] = field.description.suggested_value;
  }
  return values;
}

/** Drive only the documented route steps. Nothing is saved until route_review. */
export async function writeTomTomRoute(client, { entryId, name, start, destination, config }) {
  const root = `/api/config/config_entries/${entryId ? 'options/' : ''}flow`;
  let flow, finished = false;
  async function request(path, body) {
    const response = await client.rest('POST', path, body);
    if (response.status !== 200 || !response.body || Object.keys(response.body.errors ?? {}).length) throw new Error('COMMUTE_ROUTE_REJECTED');
    flow = response.body;
    return flow;
  }
  async function step(expected, body) {
    if (flow.step_id !== expected || !/^[\w-]+$/.test(flow.flow_id)) throw new Error('COMMUTE_ROUTE_UNSUPPORTED');
    return request(`${root}/${flow.flow_id}`, body);
  }
  try {
    await request(root, { handler: entryId || 'tomtom' });
    if (entryId) await step('init', { next_step_id: start ? 'edit_route' : 'edit_route_settings' });
    else await step('user', { name, search_mode: 'route_live' });
    if (start) {
      await step('route_start', { next_step_id: 'route_start_point' });
      await step('route_start_point', { location: { latitude: start.latitude, longitude: start.longitude } });
      await step('route_destination', { next_step_id: 'route_destination_point' });
      await step('route_destination_point', { location: { latitude: destination.latitude, longitude: destination.longitude } });
      await step('route_vias', { next_step_id: 'route_review' });
    }
    const values = formValues(flow.data_schema);
    Object.assign(values, { live_days: config.days.map((day) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day]),
      live_from: `${config.from}:00`, live_until: `${config.until}:00` });
    if ('return_route' in values) values.return_route = false;
    // A newly created commute needs automatic updates, even if HA's defaults use manual refresh.
    if (!entryId && !values.optional?.update_interval) values.optional = { ...values.optional, update_interval: 15 };
    await step('route_review', values);
    if (flow.type !== 'create_entry') throw new Error('COMMUTE_ROUTE_REJECTED');
    const id = entryId || flow.result?.entry_id;
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('COMMUTE_ROUTE_REJECTED');
    finished = true;
    return id;
  } finally {
    if (!finished && /^[\w-]+$/.test(flow?.flow_id)) await client.rest('DELETE', `${root}/${flow.flow_id}`).catch(() => {});
  }
}
