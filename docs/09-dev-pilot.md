# Isolated development pilot

This stack is the non-production proving ground for installation and onboarding
before the public beta. It runs a synthetic Home Assistant household and a fresh
Hauser installation beside existing services without sharing containers,
networks, configuration, credentials or persistent volumes.

It is not a substitute for the later external-person beta gate: its purpose is
to find installation, wizard and persistence defects before that gate.

## Isolation contract

The Compose project has the fixed name `hauser-dev` and owns these resources:

- Home Assistant `2026.7.4` with its own `/config` volume;
- Hauser with separate `/config`, `/data` and `/assets` volumes;
- Home Assistant on the Mac's current LAN address, port `18123`;
- Hauser on loopback only, port `14173` by default.

The synthetic HA configuration contains three independent rooms by naming
convention, three controllable template lights, temperature sensors and window
sensors. It contains no production URL, token, entity ID or mounted production
path.

Home Assistant must be reachable under one URL from both the browser and the
Hauser container. On Docker Desktop, `localhost` inside Hauser would refer to the
Hauser container itself. The launcher therefore detects the Mac's current LAN
address and prints the exact URL to enter in the wizard.

## Start and first onboarding

```bash
./scripts/dev-pilot.sh up
```

The command builds Hauser, starts both services, waits for their HTTP readiness
and prints three exact URLs. Then:

1. Open the printed **Home Assistant** URL.
2. Complete Home Assistant's normal first-user onboarding with development-only
   credentials. Do not reuse a production password.
3. In Home Assistant, create a dedicated long-lived access token named
   `Hauser Dev Pilot` under the user profile's security settings.
4. Open the printed **Hauser** URL.
5. Choose a language and enter the printed **Wizard HA URL** plus the development
   token.
6. Home Assistant creates the default Areas `Living room`, `Kitchen` and
   `Bedroom` during first-user onboarding (localized to the chosen HA language).
   Before scanning in Hauser, open **Settings → Areas, labels & zones → Areas**
   and assign the three synthetic entities for each room to its matching Area:
   the room's light, temperature sensor and window sensor.
7. Let Hauser scan the synthetic registry, review the three Areas and nine mapped
   entities, disable Jellyfin, then activate the configuration.
8. Toggle at least one light and verify the matching entity changes in the dev HA.

A normal fresh Home Assistant therefore exercises Hauser's explicit-Area path.
To exercise no-Area inference separately, delete the three default Areas in dev
HA after onboarding, leave the synthetic entities unassigned, then reset only
Hauser as described below. Do not expect the no-Area fallback while any HA Area
exists: unassigned entities are deliberately ignored in that case.

## Daily operation

```bash
./scripts/dev-pilot.sh status
./scripts/dev-pilot.sh logs
./scripts/dev-pilot.sh logs hauser
./scripts/dev-pilot.sh logs home-assistant
./scripts/dev-pilot.sh down
./scripts/dev-pilot.sh up
```

`down` removes containers and the private Compose network but keeps all four
volumes. A later `up` must retain both the HA owner account and Hauser's activated
configuration.

To expose Hauser temporarily to another trusted LAN device, bind it explicitly:

```bash
HAUSER_DEV_APP_BIND_ADDRESS="$(ipconfig getifaddr en0)" ./scripts/dev-pilot.sh up
```

Do not expose either service to the public internet.

## Repeat the complete first-run flow

The destructive reset is intentionally explicit:

```bash
./scripts/dev-pilot.sh reset --yes
./scripts/dev-pilot.sh up
```

It deletes only resources in the `hauser-dev` Compose project, including the dev
HA owner/token and all Hauser dev configuration, data and assets. It does not
address the normal `hauser` project, the production HMI on port `4173`, or an
external Home Assistant installation.

To repeat Hauser onboarding while retaining the dev Home Assistant account and
Areas, remove only Hauser's three named volumes after stopping the stack:

```bash
./scripts/dev-pilot.sh down
docker volume rm \
  hauser-dev_hauser_config \
  hauser-dev_hauser_data \
  hauser-dev_hauser_assets
./scripts/dev-pilot.sh up
```

Use `docker volume ls --filter label=com.docker.compose.project=hauser-dev` to
inspect the exact owned volumes before any manual deletion.

## Checks before public beta

Record each clean-room pass against this minimum:

- fresh Home Assistant and Hauser onboarding completed without source edits;
- inferred-Area and explicit-Area variants both exercised;
- room display and at least one real command/state echo confirmed;
- Hauser reconnect after restarting only Home Assistant confirmed;
- configuration retained after `down` followed by `up`;
- Hauser backup/restore and image rollback exercised separately using the normal
  installation runbook;
- no production URL, credential, entity or volume used.
