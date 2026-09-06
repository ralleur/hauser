# Integrations

This document lists implemented data paths in the current alpha. The public
demo uses synthetic data and must not be mistaken for proof of a live service
connection.

## Status matrix

| Area | Repository implementation | Public static demo |
|---|---|---|
| Home Assistant | Official WebSocket client, live entity collections, service calls, reconnect and reconciliation | Simulated |
| Calendar | Discovers Home Assistant `calendar.*` entities and loads events with `calendar/list` | Simulated |
| Jellyfin | Authentication, browse/detail requests, artwork, playback negotiation, HLS and progress reporting | Simulated |
| Paperless-ngx | Optional companion bridge with server-side authentication, search, preview/download and import | Omitted |
| Reminders and shopping | Companion-owned shared household store; selected Home Assistant `todo.*` lists can also be projected | Simulated |
| Notion | Optional, companion-side only; no browser client | Not applicable |

## Home Assistant

The live backend uses `home-assistant-js-websocket` rather than implementing the
wire protocol itself. It provides authentication, reconnect behavior, entity
collections and service calls. Hauser adds the entity store, command queue and
optimistic reconciliation described in the
[interaction contract](02-interaction-contract.md).

The installation URL can be supplied through `VITE_HA_URL` or the connection
settings. The access token is entered at runtime and is never part of source or
build artifacts.

### Calendar and task entities

Calendar data is a Home Assistant integration path, not a browser-side CalDAV
client. Hauser discovers available `calendar.*` entities and requests event
ranges through the Home Assistant WebSocket `calendar/list` command. Calendar
selection is stored as UI configuration.

The settings UI can start Home Assistant's iCloud/CalDAV config flow. Account
credentials are passed to Home Assistant for that setup and are not retained by
Hauser. Once configured, the resulting calendar entities use the same
Home Assistant calendar path as any other calendar integration.

Selected `todo.*` entities can be exposed as reminder sources. They are read
through Home Assistant and projected alongside companion-owned reminders; they
are not a Notion bridge.

## Jellyfin

The Jellyfin integration is a small fetch-based client rather than an embedded
Jellyfin web application. It implements:

- user authentication with a stable device identity;
- continue-watching, latest, series and movie queries;
- item, season and episode details;
- constrained artwork URLs;
- `PlaybackInfo` negotiation;
- native HLS where available and dynamically loaded `hls.js` elsewhere;
- playing, progress and stopped reports for cross-device resume.

The endpoint comes from `VITE_JELLYFIN_URL` or the connection settings. Tokens
remain local to the configured browser installation.

## Optional companion

`app/server.mjs` serves the built application and the APIs that cannot safely
be implemented in a static browser bundle.

### Shared household data

Reminders are stored in a companion-owned JSON document. The path can be
changed with `HMI_FAMILY_DATA_PATH`; writes are serialized and exposed through
same-origin API routes. Shopping is separate: it lives in Home Assistant lists
or, optionally, on a shared Notion page.

### Paperless-ngx

Paperless access is deliberately server-side. The companion keeps the API token
out of the browser, checks the document PIN, maintains an HttpOnly session and
proxies the supported search, status, preview, download and import operations.
The public static demo omits this surface because it has no companion and no
safe synthetic document server.

## Shopping lists

By default every shop is a Home Assistant `todo.*` entity, for example from the
*Local To-do* integration. Items are read with the official `todo/item/list`
WebSocket command and written with the `todo.add_item` and `todo.update_item`
services, so the same list is also usable in the Home Assistant app and by voice
assistants. In the Home Assistant App mode the settings screen can create a
list through the `local_todo` config flow.

Notion is the optional alternative for a shopping page shared outside Home
Assistant. It needs an internal integration token and the address of the page;
shops are headings there and items are checkboxes below them. Reading and
writing happen on the companion server, because the Notion API rejects browser
calls and the token must not reach the browser. The public demo uses fixtures
and connects to neither.

## Demo isolation

The demo build chooses the deterministic fake backend, uses synthetic calendar,
media and household records, hides Paperless, and does not contact configured
Home Assistant or Jellyfin services. This isolation is verified as part of the
release smoke test.
