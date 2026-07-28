# Architecture

This document describes the architecture that is active in the current alpha.
It is not a record of alternatives that were considered and later discarded.

## System shape

```text
Panel shell / Phone shell
          │
          ▼
Svelte 5 application state and UI
          │
          ├── Home Assistant adapter (WebSocket + config-flow REST)
          ├── Jellyfin adapter (REST + HLS)
          ├── optional companion server
          │     ├── shared household data
          │     └── Paperless-ngx bridge
          └── deterministic fake backend for the public demo
```

Hauser is a Vite-built Svelte 5 single-page application. The wall-panel and
phone shells share the same screen model, backend adapters, state projections,
components and design tokens. They differ only where the device form factor
requires a different navigation or overlay pattern.

## Runtime modes

| Mode | Purpose | External services |
|---|---|---|
| Demo | Public review, screenshots and development without private data | None |
| Live | Household control and live data | Home Assistant; Jellyfin when configured |
| Live with companion | Shared household data and protected document access | Live services plus the optional Node companion |

The fake backend is a deliberate implementation, not an error fallback that
silently replaces a failed live service. A live connection failure stays
visible as a live connection failure.

## State flow

Home Assistant state is kept in an entity store. Interactive controls add a
local intent immediately and render a merged view of server truth plus that
intent. Commands are deduplicated per entity, dispatched through the backend,
and reconciled when authoritative state arrives.

```text
user input
  → local intent
  → visible state update
  → backend command
  → authoritative update
  → confirm or visibly correct the intent
```

The UI does not read the WebSocket directly from components. Connection,
entity state, command dispatch and optimistic reconciliation stay behind the
adapter boundary. See [Interaction contract](02-interaction-contract.md).

## Integration boundaries

- Home Assistant uses the official `home-assistant-js-websocket` client for
  authentication, reconnects, entity collections and service calls.
- Calendar and selected reminder sources are Home Assistant domains
  (`calendar.*` and `todo.*`), not separate browser-side CalDAV clients.
- Jellyfin uses a small fetch-based client and an isolated playback adapter.
- The companion owns shared reminders and exposes the PIN-gated Paperless proxy.
- A local server-side bridge optionally synchronizes shopping with Notion.
  The browser receives only same-origin JSON and restricted shopping routes;
  credentials remain server-side.

Details and public-demo differences are listed in
[Integrations](04-integrations.md).

## Rendering and delivery

- CSS custom properties in `design-tokens/` are the visual source of truth.
- Interaction-critical motion uses `transform` and `opacity`.
- Heavy routes such as video playback are loaded dynamically.
- `vite-plugin-pwa` produces the service worker and precache manifest.
- App updates are applied only when the UI can reload without interrupting an
  active interaction.

## Security and privacy boundaries

- Service credentials are entered or provisioned at runtime; none belong in
  the repository or build output.
- Home Assistant and Jellyfin tokens are browser-local credentials for the
  configured installation.
- Paperless credentials and its access PIN are handled by the companion and do
  not enter the browser bundle or local storage.
- The public demo contains synthetic data and makes no connection to live
  household services.
- The application contains no telemetry or analytics client.

## Source map

| Area | Source |
|---|---|
| Application shells | `app/src/lib/shells/` |
| Components | `app/src/lib/components/` |
| Runtime and backend adapters | `app/src/lib/adapter/` |
| Shared state projections | `app/src/lib/state/` |
| Optional companion | `app/server.mjs` |
| Design tokens | `design-tokens/` |
| Performance gate | `app/scripts/performance-budget.mjs` |
