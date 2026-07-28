# Household configuration

Hauser's household-specific runtime data is external, versioned JSON. Rooms,
visible Home Assistant entities, navigation, enabled modules, energy sensors,
media targets and global entity bindings are loaded before the application or
backend adapters start.

The current contract is `schemaVersion: 1`.

## Examples

Two independent neutral examples ship with the repository:

- [`../app/config/examples/neutral-small.json`](../app/config/examples/neutral-small.json)
- [`../app/config/examples/neutral-studio.json`](../app/config/examples/neutral-studio.json)

They intentionally describe different rooms, modules and entity mappings. Both
are validated and compiled by the test suite without changing application code.
The static demo and the normal server runtime use the same configuration parser,
compiler and active-runtime projection path.

## Running with a configuration

Build the application, then point the companion server at a configuration file:

```bash
cd app
npm ci
npm run build
HMI_HOUSEHOLD_CONFIG_PATH="$PWD/config/examples/neutral-small.json" \
HMI_HOUSEHOLD_CONFIG_MODE=active \
node server.mjs
```

Open `http://localhost:4173`. Configure the Home Assistant URL and long-lived
access token in the System settings. Credentials are browser/runtime settings;
they do not belong in the household JSON or repository.

The Compose installation fixes the config path to
`/config/household.json`. The file lives in its persistent config volume and is
seeded once from `neutral-small.json`; later image updates do not overwrite it.
See [`08-installation.md`](08-installation.md) for the export/edit/import flow.

`HMI_HOUSEHOLD_CONFIG_MODE` accepts exactly:

- `active` — validate and project the external configuration before starting the
  application;
- `shadow` — keep the legacy reference model active while comparing the external
  candidate for migration diagnostics.

The public pre-beta path uses `active`. `shadow` remains a migration and rollback
tool for the original reference installation; it is not a fallback that silently
accepts invalid public configuration.

## Contract outline

```json
{
  "schemaVersion": 1,
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

The complete TypeScript contract and validator live in
[`../app/src/lib/config/household-config.ts`](../app/src/lib/config/household-config.ts).
Unknown fields, unsupported schema versions, invalid Home Assistant entity IDs,
duplicate IDs, dangling references and inconsistent module data are rejected.
Validation issues include both a stable code and an exact JSON path, for example:

```text
INVALID_ENTITY_ID at $.rooms[0].visibleEntities[0].entityId
```

## Failure behaviour

Active mode is fail-closed:

1. the native server validates the bundle, JSON and complete schema before it
   starts listening or reports ready;
2. the browser fetches server mode and configuration with `no-store` semantics;
3. the same schema validation runs before application modules are imported;
4. the normalized runtime model is projected before state consumers start;
5. invalid, missing, unreadable or unprojectable configuration prevents the
   productive application from mounting;
6. the browser renders a bounded configuration error with a stable
   `HOUSEHOLD_CONFIG_*` reference code.

There is no silent fallback to another household's rooms or entity IDs in active
mode. A valid external model supplies the complete subscription and command
target set; legacy entity IDs are never supplemented.

## Optional modules

A module must be listed in `enabledModules` and its required data must be
consistent:

- `energy` requires a non-null `energy` object;
- media-facing modules require suitable `mediaTargets` where the UI needs them;
- disabled modules must not carry contradictory configuration.

Missing optional modules are omitted rather than rendered as broken empty
screens.

## Current pre-beta boundary

The configuration core, source-built container, Compose file, persistent
`/config`, `/data` and `/assets` volumes and manual backup/restore path are
implemented. The deterministic setup wizard, automatic migrations, published
registry image and independent household pilot remain beta milestones. Until
those exist, this is still a technically oriented pre-beta setup rather than a
supported public install path.
