import type {
  CommandContract,
  HouseholdConfigV4,
  HouseholdRuntimeModel,
} from './household-config.ts';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return compareText(left.id, right.id);
}

function commandKey(contract: Pick<CommandContract, 'entityId' | 'domain'>): string {
  return `${contract.entityId}\u0000${contract.domain}`;
}

/** Compiles a validated v3 configuration into a canonical runtime representation. */
export function compileHouseholdConfig(config: HouseholdConfigV4): HouseholdRuntimeModel {
  // Room order is installation semantics. Entities inside a room are keyed and
  // canonicalized so object/fixture construction order cannot create noise.
  const rooms = config.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    visibleEntities: room.visibleEntities.map((entity) => ({ ...entity })).sort(byId),
    hero: room.hero === null ? null : {
      assetId: room.hero.assetId,
      focus: {
        panel: { ...room.hero.focus.panel },
        phone: { ...room.hero.focus.phone },
      },
    },
  }));
  const navigation = config.navigation
    .map((item) => ({ ...item, target: { ...item.target } }))
    .sort((left, right) => left.order - right.order || compareText(left.id, right.id));
  const enabledModules = [...config.enabledModules].sort();
  const mediaTargets = config.mediaTargets.map((target) => ({ ...target })).sort(byId);
  const energy = config.energy === null
    ? null
    : {
        sensors: {
          productionPower: config.energy.sensors.productionPower,
          consumptionPower: config.energy.sensors.consumptionPower
            .map((source) => ({ ...source }))
            .sort(byId),
        },
        kpis: { ...config.energy.kpis },
      };
  const globalEntities = {
    sun: config.globalEntities.sun,
    vacationMode: config.globalEntities.vacationMode,
    homeOffScript: config.globalEntities.homeOffScript,
    laundry: {
      washer: config.globalEntities.laundry.washer === null ? null : {
        ...config.globalEntities.laundry.washer,
        runningStates: [...config.globalEntities.laundry.washer.runningStates],
        doneStates: [...config.globalEntities.laundry.washer.doneStates],
      },
      dryer: config.globalEntities.laundry.dryer === null ? null : {
        ...config.globalEntities.laundry.dryer,
        runningStates: [...config.globalEntities.laundry.dryer.runningStates],
        doneStates: [...config.globalEntities.laundry.dryer.doneStates],
      },
    },
  };

  const subscriptionEntityIds = new Set<string>();
  const commands = new Map<string, CommandContract>();
  const addCommand = (
    entityId: string,
    domain: CommandContract['domain'],
    services: readonly string[],
  ): void => {
    const contract = { entityId, domain, services: [...new Set(services)].sort() };
    commands.set(commandKey(contract), contract);
  };

  for (const room of rooms) {
    for (const entity of room.visibleEntities) {
      subscriptionEntityIds.add(entity.entityId);
      if (entity.role === 'light') {
        addCommand(entity.entityId, 'light', ['turn_on', 'turn_off']);
      } else if (entity.role === 'climate') {
        addCommand(entity.entityId, 'climate', ['set_temperature', 'set_hvac_mode']);
      } else if (entity.role === 'switch') {
        addCommand(entity.entityId, 'switch', ['turn_on', 'turn_off']);
      } else if (entity.role === 'vacuum') {
        addCommand(entity.entityId, 'vacuum', ['start', 'return_to_base']);
      }
    }
  }
  for (const target of mediaTargets) {
    subscriptionEntityIds.add(target.entityId);
    addCommand(target.entityId, 'media_player', [
      'media_play_pause',
      'media_next_track',
      'media_previous_track',
      'volume_set',
      'play_media',
      'media_stop',
    ]);
  }
  if (globalEntities.sun) subscriptionEntityIds.add(globalEntities.sun);
  if (globalEntities.vacationMode) {
    subscriptionEntityIds.add(globalEntities.vacationMode);
    addCommand(globalEntities.vacationMode, 'switch', ['turn_on', 'turn_off']);
  }
  if (globalEntities.laundry.washer) {
    subscriptionEntityIds.add(globalEntities.laundry.washer.entityId);
    if (globalEntities.laundry.washer.cycleMarkerEntityId) {
      subscriptionEntityIds.add(globalEntities.laundry.washer.cycleMarkerEntityId);
    }
  }
  if (globalEntities.laundry.dryer) {
    subscriptionEntityIds.add(globalEntities.laundry.dryer.entityId);
    if (globalEntities.laundry.dryer.cycleMarkerEntityId) {
      subscriptionEntityIds.add(globalEntities.laundry.dryer.cycleMarkerEntityId);
    }
  }
  if (globalEntities.homeOffScript) addCommand(globalEntities.homeOffScript, 'script', ['turn_on']);
  if (energy) {
    if (energy.sensors.productionPower) subscriptionEntityIds.add(energy.sensors.productionPower);
    for (const source of energy.sensors.consumptionPower) subscriptionEntityIds.add(source.entityId);
    for (const entityId of Object.values(energy.kpis)) {
      if (entityId) subscriptionEntityIds.add(entityId);
    }
  }

  const sortedSubscriptionEntityIds = [...subscriptionEntityIds].sort();
  const commandContracts = [...commands.values()].sort((left, right) => (
    compareText(left.entityId, right.entityId) || compareText(left.domain, right.domain)
  ));

  return {
    schemaVersion: config.schemaVersion,
    rooms,
    navigation,
    enabledModules,
    energy,
    mediaTargets,
    globalEntities,
    subscriptionEntityIds: sortedSubscriptionEntityIds,
    entityIds: sortedSubscriptionEntityIds,
    commandContracts,
  };
}
