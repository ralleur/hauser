import { describe, expect, it } from 'vitest';
import { FakeBackend } from './fake-backend.ts';
import { entityRegistryRenameMessage } from './ha-backend.ts';
import type { EntityCatalogItem } from '../state/device-config.ts';

describe('shared device names', () => {
  it('builds the Home Assistant entity-registry update message', () => {
    expect(entityRegistryRenameMessage('light.kueche', 'Arbeitslicht')).toEqual({
      type: 'config/entity_registry/update',
      entity_id: 'light.kueche',
      name: 'Arbeitslicht',
    });
  });

  it('FakeBackend updates and republishes its shared catalog name', async () => {
    const backend = new FakeBackend(new Map(), 0);
    const catalogs: EntityCatalogItem[][] = [];
    backend.subscribe(() => {});
    backend.onConnectionChange(() => {});
    backend.subscribeCatalog((items) => catalogs.push(items));

    await backend.renameEntity('switch.steckdose_wohnzimmer_regal', 'Leselicht');

    expect(catalogs.at(-1)?.find((item) => item.entityId === 'switch.steckdose_wohnzimmer_regal')?.name)
      .toBe('Leselicht');
  });

  it('rejects empty names', async () => {
    const backend = new FakeBackend(new Map(), 0);
    await expect(backend.renameEntity('light.kueche', '   ')).rejects.toThrow('leer');
  });
});
