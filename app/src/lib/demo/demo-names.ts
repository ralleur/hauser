import { m } from '../../paraglide/messages.js';
import demoHouseholdConfig from '../../../config/households/current-v1.json';

/* Demo-only presentation state. Kept outside demo-mode.ts so production startup
   does not retain translated sample names and synthetic room values. */
export function applyDemoNames(rooms: {
  id: string;
  name: string;
  presence: boolean;
  lights: Array<{ entityId: string; name: string }>;
}[]): void {
  if (import.meta.env.VITE_DEMO !== '1') return;

  const room: Record<string, () => string> = {
    wohnzimmer: m.demo_room_wohnzimmer, kinderzimmer: m.demo_room_kinderzimmer,
    schlafzimmer: m.demo_room_schlafzimmer, bad: m.demo_room_bad,
    kueche: m.demo_room_kueche, flur: m.demo_room_flur,
  };
  /* Die Gerätenamen stammen aus dem Referenz-Seed und sind dort deutsch. In der
     Demo folgen sie derselben Sprache wie die Raumnamen. */
  const device: Record<string, () => string> = {
    'light.wohnzimmer_kugellampen': m.demo_device_kugellampen,
    'light.wohnzimmer_esstisch': m.demo_device_esstisch,
    'light.wohnzimmer_tv': m.demo_device_kugel_tv,
    'light.wohnzimmer_fensterlampe': m.demo_device_kugel_fenster,
    'light.schlafzimmer_bett': m.demo_device_bett,
    'light.schlafzimmer_schreibtisch': m.demo_device_schreibtisch,
    'light.bad_spiegel': m.demo_device_spiegel,
    'light.kueche_ledleiste': m.demo_device_ledfridge,
  };
  const present = new Set(['wohnzimmer', 'kueche']);
  const lightsOn: Readonly<Record<string, readonly number[]>> = {
    wohnzimmer: [0, 2], schlafzimmer: [0], kueche: [0],
  };
  const climate: Readonly<Record<string, { target: number; current: number }>> = {
    wohnzimmer: { target: 21, current: 23.5 },
    schlafzimmer: { target: 18, current: 22.5 },
    bad: { target: 21, current: 22 },
  };
  const store = (window as unknown as {
    __hmi?: { runtime?: { store?: {
      get: (entityId: string) => { value?: unknown } | undefined;
      set: (entityId: string, value: unknown) => void;
    } } };
  }).__hmi?.runtime?.store;
  const merge = (entityId: string, value: Record<string, unknown>) => {
    const current = store?.get(entityId)?.value;
    store?.set(entityId, {
      ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
      ...value,
    });
  };

  for (const item of rooms) {
    if (room[item.id]) item.name = room[item.id]();
    item.presence = present.has(item.id);

    const configured = demoHouseholdConfig.rooms.find(({ id }) => id === item.id);
    const climateEntity = configured?.visibleEntities.find(({ role }) => role === 'climate');
    if (climateEntity && climate[item.id]) {
      merge(climateEntity.entityId, { ...climate[item.id], hvac: 'heat' });
    }
    const activeIndexes = new Set(lightsOn[item.id] ?? []);
    item.lights.forEach((light, index) => {
      if (device[light.entityId]) light.name = device[light.entityId]();
      if (activeIndexes.has(index)) {
        merge(light.entityId, { on: true, brightness: index === 0 ? 68 : 42 });
      }
    });
  }
}
