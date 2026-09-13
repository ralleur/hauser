---
title: Architecture
description: The shape of the system, for contributors and curious users.
sidebar:
  order: 1
---

Hauser is a Svelte 5 single-page app built with Vite, plus a small Node.js server. The wall panel and the phone are two shells over one state model.

## System shape

```text
Wall panel (kiosk browser)         Phone (home-screen web app)
        └──────────── same origin ────────────┘
                        │
                  Hauser web app
                        │
        ┌───────────────┴────────────────┐
        │ same-origin HTTP + WebSocket   │ straight from the browser
        ▼                                ▼
  Hauser server (app/server.mjs)   Jellyfin REST + HLS
  · household configuration
  · Home Assistant gateway (App)
  · room-image store, map, weather
  · reminders, notifications
  · Paperless / Notion bridges
        │
        ▼
  Home Assistant  ←── or straight from the browser (Compose, direct mode)
```

## State flow

The app never reads the WebSocket in a component. Four layers sit between the UI and the backends:

1. an **entity store** with server truth,
2. an **overlay of pending intents** (what you just tapped),
3. a **command queue**, deduplicated per entity,
4. a **swappable backend**: Home Assistant live, or the deterministic fake used by the demo.

The UI reads `merged()` and writes `dispatch()`. That seam is what makes the optimistic feel and the offline demo possible.

```text
user input → local intent → visible update → command → authoritative state → confirm or correct
```

## Server

`app/server.mjs` dispatches requests; the modules under `app/server/` own one area each: setup, configuration core, room images, ambient map, weather, family data, notification rules, laundry, hotel mode, pairing, remote access, Paperless, Notion. The HTTP contract in `api-contract.mjs` generates a typed client, and a test fails when a route literal drifts.

## Persistence

External, versioned JSON. The household file is validated before the server listens and before the app mounts. Migrations back up the original. See [Household configuration](/hauser/docs/reference/household-config/).

## Security boundaries

- Service credentials are entered at runtime. None live in the repository or the build.
- In the App, no Home Assistant token reaches the browser.
- Paperless, Notion and OpenAI credentials stay on the server.
- No telemetry.

## Rendering

- CSS custom properties in `design-tokens/` are the visual source of truth.
- Interaction-critical motion uses transform and opacity only.
- Heavy routes such as video playback load on demand.
- A service worker precaches the shell. Room pictures are cached when first shown.
- The server precomputes the map, the phone image variants and last week's energy statistics overnight.

## Deeper reading

The repository's technical documents go further: [architecture](https://github.com/ralleur/hauser/blob/main/docs/00-architecture.md), [design system](https://github.com/ralleur/hauser/blob/main/docs/01-design-system.md), [interaction contract](https://github.com/ralleur/hauser/blob/main/docs/02-interaction-contract.md), [performance budget](https://github.com/ralleur/hauser/blob/main/docs/03-performance-budget.md), [component catalogue](https://github.com/ralleur/hauser/blob/main/docs/06-component-catalog.md).
