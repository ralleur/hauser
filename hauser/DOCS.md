# Hauser Home Assistant App

Hauser is a calm, visual frontend for Home Assistant, made for wall panels and
phones. This App is a thin packaging layer around the regular multi-architecture
Hauser image; the guided setup wizard is the same one the Docker/Compose
installation uses.

> **Experimental beta.** The manifest declares `stage: experimental`. Install,
> start, credential-free setup discovery, activation, the internal Home
> Assistant connection, the App update path over an existing install with data
> kept, and opening the displayed address from a real phone have been exercised
> on an isolated Home Assistant OS test system. Real device commands with state
> echo, reconnect after a Home Assistant or App restart, and backup/restore are
> not re-verified on every release. Hauser has not yet run in other people's
> homes. None of this is a compatibility or support promise.

## Install

1. In Home Assistant, open **Settings → Apps → App Store → Repositories**.
2. Add `https://github.com/ralleur/hauser`.
3. Select **Hauser**, choose **Install**, then **Start**.
4. Choose **Open Web UI**.

Apps require Home Assistant OS or a Supervised installation. Home Assistant
Container has no App system — use the Docker/Compose installation described in
the repository README and in [`docs/08-installation.md`](../docs/08-installation.md).

## First setup

The App connects to Home Assistant by itself. In the wizard:

1. select a language;
2. review the discovered Areas, rooms and entities;
3. configure or skip Jellyfin;
4. validate and activate the generated configuration;
5. note the address shown at the end — that is where phones and tablets open
   Hauser. It comes with a copy action and a QR code.

There is **no field for a Home Assistant URL and no Long-Lived Access Token**.
The wizard changes Hauser configuration only; it never creates, renames or
deletes Home Assistant Areas or entities.

## How Hauser reaches Home Assistant

The App declares `homeassistant_api: true`. The Hauser server talks to Home
Assistant Core over the internal Supervisor endpoints (`http://supervisor/core/`
for REST, `ws://supervisor/core/websocket` for the WebSocket API) using the
`SUPERVISOR_TOKEN` the Supervisor injects into the container.

- The token is read once at start, stays inside the server process, and is never
  written to `/data`, returned to the browser or logged; anything that leaves the
  process as text is passed through a redaction step first.
- The browser never receives a Home Assistant credential. It speaks the familiar
  Home Assistant WebSocket contract against a **same-origin gateway** on the
  Hauser server (`/api/websocket`), which forwards only an explicit allow-list of
  message types in each direction. It is not an open bridge to Home Assistant.
- If an earlier installation stored a Long-Lived Access Token, it is removed
  from `/data/config.json` on the first start in App mode.
- A missing or rejected internal access fails closed. There is no fallback to a
  stored token.

`GET /api/health` and `GET /api/ha/connection` report the active state;
`/api/ha/connection` shows `mode: supervisor` in the App.

No other permission is claimed: no host networking, no privileged mode, no
hardware access, no Home Assistant configuration mount, no Supervisor role
beyond the Home Assistant API.

## Web UI, network and security boundary

Hauser listens on TCP port 4173, which the App publishes to the host. **Open Web
UI** opens the port Home Assistant selected.

This packaging **deliberately does not use Ingress**. Phones and tablets load
Hauser alone, with no Home Assistant frontend, iframe or redirect in front of it
— that is the point of a wall-panel surface.

**The published port carries no separate Hauser login and no device pairing.**
Every device that can reach it on your network can operate Hauser, exactly like
the direct-LAN contract of the Docker/Compose installation. Requests are checked
only for a matching browser origin, which is a cross-site protection, not
authentication.

- Keep the port on a trusted home network.
- Do not publish it to the internet, and do not forward it through a router.
- The App exposes no configuration options, so the browser origin allow-list is
  fixed. Putting an HTTPS reverse proxy with a different hostname in front of
  the App is therefore not supported here; use the Docker/Compose installation,
  which lets you set the exact origins.

## Persistence and backups

Home Assistant's persistent App directory `/data` is the only persistent path
this package uses. All Hauser state is mapped below it, among others:

- `/data/household.json` — active household configuration and migration backups;
- `/data/config.json` — shared Hauser settings; in App mode it holds no Home
  Assistant URL and no Home Assistant token;
- `/data/family-data.json` — reminder and shopping data held by the server;
- `/data/room-image-auth.json` — your own ChatGPT or OpenAI authorization for
  the optional room-image assistant;
- `/data/assets/` — room-image sets published by the assistant;
- `/data/assets/ambient-maps/` and `/data/ambient-map.json` — the standby city
  map and its location metadata;
- `/data/songs/` — generated song library data.

Because everything lives in `/data`, Hauser participates in Home Assistant
backups. The manifest declares `backup: cold`, so Home Assistant stops the App
while it snapshots `/data` and no file changes underneath the snapshot.

- Create a Home Assistant backup that includes **Hauser**.
- Restore it through Home Assistant's backup UI.
- Start Hauser, confirm the health endpoint is healthy, then open the Web UI and
  check the saved household configuration.

Recreating or updating the App container keeps the configuration as long as App
data is preserved. Manual Docker/Compose backup, restore and rollback workflows
are described in [`docs/08-installation.md`](../docs/08-installation.md).

## Standby city map

The standby screen can show a faint street map of your town. It is off by
default and switched on per device under **Settings → Appearance → Ambient &
standby**. The location is read from Home Assistant itself over the internal
endpoints, so no token is involved.

Switching the location on, or pressing **Regenerate**, makes the Hauser server
send a request to a public Overpass API endpoint with a bounding box around that
location and a list of road types; a second public endpoint is tried only if the
first does not answer. Nothing else leaves the house, and nothing is sent on
start, reload or when a panel enters standby. The result is rendered into
`/data/assets/ambient-maps/` and reused by every panel.

Map data is © OpenStreetMap contributors, available under the ODbL. Hauser shows
that attribution on the standby screen whenever the map is visible. See
[`NOTICE`](../NOTICE) and
[`docs/07-configuration.md`](../docs/07-configuration.md#standby-city-map).

## Health and startup

The image's OCI healthcheck runs `container/healthcheck.mjs` inside the
container and probes the internal `/api/health` endpoint; Home Assistant sees
the resulting container health status. No App-metadata `watchdog` and no
host-port health monitor is configured.

A fresh install reports `setup_required` and counts as healthy, so the wizard
can be opened. Invalid configuration, a failed migration or a runtime directory
that cannot be written stay fail-closed and make the health probe fail. The
Supervisor hands `/data` over owned by root, so the container entrypoint starts
as root, creates the required directories, hands them to the unprivileged
runtime user and only then serves.

## Versions and updates

The App carries the same version as the Hauser release it packages — this
documentation describes `0.13.0`. The Supervisor resolves the image as
`ghcr.io/ralleur/hauser:<version>` from the manifest, and the release gate
refuses a manifest version without a matching published image. Updates arrive
through Home Assistant's normal App update flow; the changelog shipped with the
App lists what changed.

Releases below `1.0.0` carry no `-beta.N` suffix: the number says on its own
that this is a beta.

## Current limits

- Experimental packaging, not an Ingress application.
- The App adds no Home Assistant authentication in front of Hauser. Protect the
  direct LAN port.
- Only `amd64` and `aarch64` are supported, matching the published Hauser
  multi-architecture image.
- The vacuum path follows the documented Home Assistant service set and has not
  been verified against real hardware.
- Hauser is licensed under the GNU Affero General Public License. Nothing about
  that changes for people running Hauser at home.
