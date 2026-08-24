# Household configuration

Hauser's household-specific runtime data is external, versioned JSON. Rooms,
visible Home Assistant entities, navigation, enabled modules, energy sensors,
media targets and global entity bindings are loaded before the application or
backend adapters start.

The current contract is `schemaVersion: 4`. Version 2 introduced the automatic,
backed-up migration lifecycle; version 3 and version 4 build on it. Version 4
adds the optional `hotelMode` block described under
[Hotel mode](#hotel-mode-holiday-apartment). Migration leaves the block absent,
so an existing installation keeps running exactly as before.

## Examples

Three independent neutral examples ship with the repository:

- [`../app/config/examples/neutral-small.json`](../app/config/examples/neutral-small.json)
- [`../app/config/examples/neutral-studio.json`](../app/config/examples/neutral-studio.json)
- [`../app/config/examples/neutral-apartment.json`](../app/config/examples/neutral-apartment.json) — a holiday apartment with a prepared, disabled `hotelMode` block

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
  comparison model for migration diagnostics.

The public beta path uses `active`. `shadow` remains a migration and rollback
tool for the original reference installation; it is not a fallback that silently
accepts invalid public configuration.

## License and source of the running build

Hauser is licensed under `AGPL-3.0-or-later`. Every running instance shows its
license, app version, full commit revision and a link to the corresponding
source under *System → Status & updates → License and source*, next to the
bundled license text at `/legal/agpl-3.0.txt`. The information needs no
authentication and no network access.

Two deployment variables feed it; both are read by `server.mjs` and served by
`GET /api/build-info`:

| Variable | Meaning |
|---|---|
| `HMI_REVISION` | Full commit SHA of the running build. Short, dirty or placeholder values are rejected and shown as unknown. |
| `HMI_SOURCE_URL` | URL of the corresponding source for exactly that revision. Only `https:` is accepted (plus `http://localhost` for local development). |

The published image bakes both in at build time from the `HAUSER_REVISION` and
`HAUSER_SOURCE_URL` build arguments; `scripts/build-image.sh` derives them from
the committed revision. **A fork or a modified deployment must set its own
`HMI_SOURCE_URL`** so the offer points at the source it actually runs. Without a
usable value Hauser shows no source link at all instead of claiming the upstream
repository — and `HAUSER_RELEASE=1` turns the missing value into a build failure,
so a publishable artifact cannot ship without it.

## Contract outline

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

`hotelMode` is optional and absent on every installation that never opted in.

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

## Hotel mode (holiday apartment)

Hotel mode turns a permanently installed panel into a self-explanatory guest
surface for a **single holiday apartment**. It is optional, disabled by default
and absent from every configuration that never opted in. Everything below is
configured under *Settings → Home → Hotel mode* and *Guest releases*; the JSON
is the storage format, not the editing surface.

### User states

| State | What the panel shows |
|---|---|
| `inactive` | A neutral surface. No names, no bookings, no next arrival, no device control. |
| `active` | A welcome screen, then the normal room view restricted to released rooms and devices. |
| `admin` | The full panel and settings, unlocked by PIN, for a limited time. |

A Home Assistant calendar decides which state applies: every valid event of the
one configured calendar is one stay. All-day events use the configured default
check-in and check-out times in the configured IANA time zone. Overlapping or
unusable events are fail-closed — the apartment stays neutral and the reason is
an admin-only diagnostic. A time-limited manual stay covers early arrival,
extensions and calendar trouble.

### Security boundary

The kiosk mode of the tablet is mandatory device hardening but **not** the
permission boundary. The boundary is the server:

- the Home Assistant long-lived token stays server-side, in `/data/config.json`;
- a guest client never receives or synchronises a Home Assistant token;
- guest device states and commands run through a narrow server proxy that
  projects only released entities and validates action and value;
- settings, setup, upload, files, maintenance, AI and family data require an
  active admin session while hotel mode is enabled;
- license, version, revision and source link stay reachable for everyone, as
  AGPL §13 requires.

Guest releases are default-deny in four steps: released rooms, released entity
IDs within them, the actions each entity really supports, and — where it makes
sense — an allowed value range such as 18–24 °C. Scenes and scripts are released
individually and explicitly. A newly discovered Home Assistant entity is never
released automatically.

### Admin PIN and session

The admin PIN has at least six digits and is stored as a salted scrypt verifier
in a private document under `/data`, never in `household.json` and never in
browser storage. The session lives in an HttpOnly/SameSite cookie and expires
after 15 minutes without real interaction. Pointer and keyboard interaction
extend it; background polling and server responses do not. Repeated wrong
attempts are rate-limited with a progressive backoff.

**PIN recovery** works through local server access, not through the interface:
stop the container, delete the `adminPin` field (or the whole file) from
`hotel-mode.json` next to the configuration in the `/data` volume, start the
container again and set a new PIN in the settings. `HMI_HOTEL_MODE_DATA_PATH`
overrides the location. Deleting the file also drops the manual stay, the
checkout marker and the calendar cache; it never touches Home Assistant
credentials.

### Kiosk checklist

Confirm before activation, because a browser cannot verify it:

1. the tablet is permanently installed and dedicated to this apartment;
2. iOS/iPadOS Guided Access or single-app mode is active, or the Android kiosk
   mode is;
3. leaving the app, the address bar, tab switching and developer tools are not
   reachable for a guest;
4. the device unlock code is known only to the operator;
5. automatic OS updates and reboots do not silently leave kiosk mode.

### Activation check

Hotel mode is never half-activated. Before `enabled` may become true, the server
runs a preflight with real requests and reports every item separately:

| Check | Requirement |
|---|---|
| `kiosk` | The kiosk checklist is confirmed. |
| `pin` | An admin PIN is set. |
| `policy` | At least one device is released for guests. |
| `proxy` | A released entity is really readable through the server token. |
| `calendar` | The configured calendar is really readable. |

A failing check refuses activation with the concrete list and changes nothing —
the previous admin operation stays reachable. Disabling needs no preflight,
keeps the guest releases and never deletes server credentials.

When a panel switches to a guest surface, Home Assistant, Jellyfin and AI
credentials plus the personal caches are removed from that browser's local
storage — locally only, so the operator's central configuration stays intact.

### Checkout

If enabled, a guest ends the stay explicitly. Hauser persists the checkout
marker atomically first and neutralises the surface immediately, then fires the
Home Assistant event `hauser_guest_checkout` with an opaque stay ID and a
timestamp. Choose the notification channel with a normal Home Assistant
automation. An explicitly configured scene runs afterwards on a best-effort
basis; without one Hauser changes no device. A guest cannot undo a checkout —
an admin can reset the marker.

## Current beta boundary

The configuration core, source-built container, Compose file, persistent
`/config`, `/data` and `/assets` volumes, deterministic setup wizard and automatic
v1-to-v2 migration with rollback backup are implemented. The versioned registry
image is the normal public installation path. External real-home evidence remains
required during beta stabilisation before the release candidate; the first beta
does not claim broad compatibility or a support promise.
