import {
  createConnection,
  createLongLivedTokenAuth,
  getStates,
  type Connection,
} from 'home-assistant-js-websocket';
import type {
  SetupArea,
  SetupDevice,
  SetupDiscoverySnapshot,
  SetupEntityRegistryEntry,
} from './setup-household.ts';

async function registry<T>(connection: Connection, type: string): Promise<T[]> {
  const result = await connection.sendMessagePromise<T[]>({ type });
  return Array.isArray(result) ? result : [];
}

export async function discoverHomeAssistant(
  url: string,
  token: string,
): Promise<SetupDiscoverySnapshot> {
  const normalizedUrl = url.trim().replace(/\/$/, '');
  const auth = createLongLivedTokenAuth(normalizedUrl, token.trim());
  const connection = await createConnection({ auth });
  try {
    const [states, areas, devices, entities] = await Promise.all([
      getStates(connection),
      registry<SetupArea>(connection, 'config/area_registry/list'),
      registry<SetupDevice>(connection, 'config/device_registry/list'),
      registry<SetupEntityRegistryEntry>(connection, 'config/entity_registry/list'),
    ]);
    return {
      areas,
      devices,
      entities,
      states: states.map((state) => ({
        entity_id: state.entity_id,
        attributes: state.attributes as Record<string, unknown>,
      })),
    };
  } finally {
    connection.close();
  }
}
