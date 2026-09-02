# Hauser Home Assistant App

## Install

> **Experimental beta:** on `0.6.1` the App path was verified on an isolated
> Home Assistant OS 18.2 test system running Home Assistant 2026.8.3: fresh
> install, start, credential-free setup discovery, activation, the internal
> Home Assistant connection, and opening the displayed address from a real
> phone. `0.7.0` adds notifications you configure as categories with rules that
> Home Assistant triggers, connected window and motion detectors, an operate
> mode and a reworked phone navigation. It also repairs the camera tile in the
> App, which used to load its picture from an address wall panels and phones
> could not reach; that path was measured against a live Home Assistant. The
> notification rules, the scene import added in `0.6.3` and the sensor
> selection are covered by tests and were not exercised against a live Home
> Assistant. The install path itself was not re-run on that version.
> Real device commands with state echo, reconnect after a Home Assistant or App
> restart, and backup/restore were **not** re-verified on this version; they
> last passed on `0.4.0-beta.4`. This is not a broad compatibility or support promise.

1. In Home Assistant, open **Settings → Apps → App Store → Repositories**.
2. Add `https://github.com/ralleur/hauser`.
3. Select **Hauser**, choose **Install**, then **Start**.
4. Choose **Open Web UI**.

Apps are available only on Home Assistant OS and other installations that provide the Home Assistant App system. Home Assistant Container users should use the documented Docker/Compose installation in the repository README.

## First setup

The App connects to Home Assistant itself. In the setup wizard:

1. select a language;
2. review the discovered Areas, rooms and entities;
3. configure or skip Jellyfin;
4. validate and activate the generated configuration;
5. note the address shown at the end — that is where phones and tablets open Hauser.

There is no field for a Home Assistant URL and no Long-Lived Access Token. The App declares `homeassistant_api: true` and the Hauser server talks to Home Assistant Core over the internal Supervisor endpoints; the Supervisor token stays inside the server process and is never written to `/data`, sent to the browser, or logged. If an earlier installation stored a Long-Lived Access Token, it is removed from `/data/config.json` on the first start in App mode.

The wizard changes only Hauser configuration; it does not rename or delete Home Assistant Areas or entities.

## Web UI and network boundary

Hauser listens on TCP port 4173. **Open Web UI** resolves the port selected by Home Assistant. This App packaging deliberately uses direct HTTP access on the trusted LAN and does not use Ingress: phones and tablets load Hauser alone, with no Home Assistant frontend, iframe or redirect in front of it.

Port 4173 has no separate user login and no device pairing. Every device that can reach the port on the trusted home network can operate Hauser, exactly like the direct LAN contract of the container installation. Do not publish the port directly to the internet. A TLS reverse proxy remains supported when its exact browser origin is listed through the regular Hauser container configuration; the App itself does not configure such a proxy.

## Persistence

Home Assistant's persistent App directory `/data` is the only persistent path used by this package. The wrapper maps all Hauser state below it:

- `/data/household.json` — active household configuration and migration backups;
- `/data/config.json` — shared Hauser settings; in App mode it holds no Home Assistant URL and no Home Assistant token;
- `/data/family-data.json` — reminder and shopping data used by the built-in server;
- `/data/room-image-auth.json` — optional ChatGPT or OpenAI API authorization for the room-image wizard;
- `/data/assets/` — room-image sets published by the wizard;
- `/data/assets/ambient-maps/` — rendered standby city-map SVGs;
- `/data/ambient-map.json` — location and render metadata for the standby city map;
- `/data/songs/` — generated song library data.

Recreating or updating the App container therefore retains configuration as long as App data is preserved.

## Standby city map

The standby screen can show a faint street map of your town. It is off by
default and is switched on per device under **Settings → Appearance → Ambient &
standby**. In App mode the location is read from Home Assistant itself over the
internal Supervisor endpoints, so no token is involved.

Switching the location on, or pressing **Regenerate**, makes the Hauser server
send **one** request to a public Overpass API endpoint with a bounding box
around that location and a list of road types. Nothing else leaves the house,
and nothing is sent on start, reload or when a panel enters standby. The result
is rendered into `/data/assets/ambient-maps/` and reused by every panel.

Map data is © OpenStreetMap contributors, available under the ODbL. Hauser
shows that attribution on the standby screen whenever the map is visible. See
[`NOTICE`](../NOTICE) and
[`docs/07-configuration.md`](../docs/07-configuration.md#standby-city-map).

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
- The App supports only `amd64` and `aarch64`, matching the published Hauser multi-architecture image.
- The App requests the Home Assistant API permission (`homeassistant_api`) and
  uses the Supervisor token to reach Home Assistant Core internally. No host
  networking, privileged mode, hardware access or Home Assistant configuration
  mount is requested, and no further Supervisor role is claimed.
- `0.7.0` is the current published App and Docker/Compose beta. Versions below
  `1.0.0` carry no `-beta.N` suffix since `0.5.0`: the number says on its own
  that it is a beta. Hauser is licensed under the GNU Affero General Public
  License instead of MIT; everything up to and including `0.4.0-beta.6` stays
  MIT, and nothing changes for people running Hauser at home. This release
  removes the Home Assistant URL and Long-Lived Access Token from the App
  entirely: the Hauser server connects internally and the browser reaches live
  state through a same-origin WebSocket, so no Home Assistant credential is
  stored in `/data` or handed to the browser. Setup ends by showing the address
  phones and tablets use, with a copy action and a QR code. It carries `0.5.3`'s
  shared climate control, `0.5.0`'s per-room scenes and **Rooms & devices**
  settings page, and the earlier App fixes: the
  room-image origin fix from `0.4.0-beta.10`, the reconfigure-flow ETag fix and
  the container source metadata from `0.4.0-beta.9`, the setup activation
  origin fix from `0.4.0-beta.6` (#8), the setup-wizard discovery fixes for
  switches, media players and vacuums from `0.4.0-beta.5` (#7), and the
  `/data/assets` start fix from `0.4.0-beta.4` (#6). The vacuum path follows the
  documented Home Assistant service set and is not yet verified against real
  hardware. An external real-home installation remains the next
  beta-stabilisation evidence gate.
