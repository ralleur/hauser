# Hauser Home Assistant App

## Install

> **Experimental beta:** the App path passed installation, startup, setup
> against real Home Assistant, one real entity command and persistence across an
> App restart on the maintainer's Home Assistant OS system, last verified on
> `0.4.0-beta.4`. It is not yet a broad compatibility or support promise.

1. In Home Assistant, open **Settings → Apps → App Store → Repositories**.
2. Add `https://github.com/ralleur/hauser`.
3. Select **Hauser**, choose **Install**, then **Start**.
4. Choose **Open Web UI**.

Apps are available only on Home Assistant OS and other installations that provide the Home Assistant App system. Home Assistant Container users should use the documented Docker/Compose installation in the repository README.

## First setup

Hauser keeps its existing connection model. In the setup wizard:

1. select a language;
2. enter a Home Assistant HTTP(S) URL that is reachable from both the browser and this App;
3. enter a dedicated Home Assistant Long-Lived Access Token;
4. discover and review Areas, rooms and entities;
5. configure or skip Jellyfin;
6. validate and activate the generated configuration.

The App does not inject a Supervisor token and does not proxy Home Assistant Core. The wizard changes only Hauser configuration; it does not rename or delete Home Assistant Areas or entities.

## Web UI and network boundary

Hauser listens on TCP port 4173. **Open Web UI** resolves the port selected by Home Assistant. This first App packaging deliberately uses direct HTTP access on the trusted LAN and does not use Ingress. Do not publish the port directly to the internet. A TLS reverse proxy remains supported when its exact browser origin is listed through the regular Hauser container configuration; the App itself does not configure such a proxy.

## Persistence

Home Assistant's persistent App directory `/data` is the only persistent path used by this package. The wrapper maps all Hauser state below it:

- `/data/household.json` — active household configuration and migration backups;
- `/data/config.json` — shared Hauser settings, including the configured HA URL and token;
- `/data/family-data.json` — reminder and shopping data used by the built-in server;
- `/data/room-image-auth.json` — optional ChatGPT or OpenAI API authorization for the room-image wizard;
- `/data/assets/` — room-image sets published by the wizard;
- `/data/songs/` — generated song library data.

Recreating or updating the App container therefore retains configuration as long as App data is preserved.

## Backup and restore

The App declares cold backups. Stop-time backup avoids changing files while Home Assistant snapshots `/data`.

- Create a Home Assistant backup that includes **Hauser**.
- Restore that App backup through Home Assistant's backup UI.
- Start Hauser and confirm `/api/health` is healthy, then open the Web UI and verify the saved household configuration.

For manual Docker/Compose backup, restore and rollback workflows, use [`docs/08-installation.md`](../docs/08-installation.md).

## Health and startup

The image's OCI healthcheck runs `container/healthcheck.mjs` inside the container
and probes the internal `/api/health` endpoint. Home Assistant receives the
resulting container health status; no App-metadata `watchdog` or separate
host-port health monitor is configured. A fresh install reports setup-required
state as healthy enough to open the wizard; invalid configuration or a failed
migration remains fail-closed and makes the internal health probe fail.

## Current limits

- This package is experimental and not an Ingress application.
- App access does not add Home Assistant authentication; protect the direct LAN port.
- The Home Assistant URL must be usable by both the browser and App container.
- The App supports only `amd64` and `aarch64`, matching the published Hauser multi-architecture image.
- No Supervisor token, Home Assistant API permission, host networking, privileged mode, hardware access or Home Assistant configuration mount is requested.
- `0.4.0-beta.7` is the current published App and Docker/Compose beta. Hauser
  is now licensed under the GNU Affero General Public License instead of MIT;
  everything up to and including `0.4.0-beta.6` stays MIT, and nothing changes
  for people running
  Hauser at home. This release also fixes the setup wizard's reconfigure flow
  (Settings → Rooms & Devices): **Save changes** silently failed every time
  because the activation request never carried the ETag preconditions the
  server requires when reconfiguring, so newly discovered rooms or devices
  reverted on leaving the screen (#7, reproduced on `0.4.0-beta.6` in #9). It
  also carries the setup activation origin fix from `0.4.0-beta.6` (#8), the
  setup-wizard discovery fixes for switches, media players and vacuums from
  `0.4.0-beta.5` (#7), and the `/data/assets` start fix from `0.4.0-beta.4`
  (#6). The vacuum path follows the documented Home Assistant service set and
  is not yet verified against real hardware. An external real-home
  installation remains the next beta-stabilisation evidence gate.
