---
title: Household configuration
description: The versioned JSON file the wizard writes.
sidebar:
  order: 2
---

The wizard writes a human-readable, versioned JSON document. It holds rooms, visible entities, navigation, enabled modules, energy sensors, media targets and global entity bindings. You normally never edit it. This page is for the curious and for recovery.

## Outline

```json
{
  "schemaVersion": 4,
  "rooms": [],
  "navigation": [],
  "enabledModules": ["home", "system"],
  "energy": null,
  "mediaTargets": [],
  "globalEntities": {
    "sun": "sun.sun",
    "vacationMode": "switch.vacation_mode",
    "homeOffScript": "script.home_off",
    "laundry": {
      "washer": "input_boolean.washer_running",
      "dryer": "input_boolean.dryer_running"
    }
  }
}
```

`hotelMode` is optional and absent unless you opted in.

## Rules

- Unknown fields, unsupported versions, invalid entity IDs, duplicates and dangling references are rejected with a code and a JSON path, for example `INVALID_ENTITY_ID at $.rooms[0].visibleEntities[0].entityId`.
- Active mode is fail-closed. An invalid file stops the server before it listens. There is no silent fallback to another household.
- Migrations keep the original file next to the new one.

## Examples

Three neutral examples ship with the repository under [`app/config/examples/`](https://github.com/ralleur/hauser/tree/main/app/config/examples): a small home, a studio, and a holiday apartment with a prepared hotel-mode block.

## Editing by hand (Compose)

```bash
docker compose cp hauser:/config/household.json ./household.json
# edit ./household.json
docker compose stop hauser
docker compose cp ./household.json hauser:/config/household.json
docker compose start hauser
docker compose logs --tail=100 hauser
```

The full contract with every field lives in [`docs/07-configuration.md`](https://github.com/ralleur/hauser/blob/main/docs/07-configuration.md) and in the validator source [`household-config.ts`](https://github.com/ralleur/hauser/blob/main/app/src/lib/config/household-config.ts).
