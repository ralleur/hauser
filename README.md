<div align="center">

# Hauser

**A smart home control surface built like a vehicle OS.**

One design system, one interaction language, and a hard rule that the screen
never waits for the network.

[Architecture](docs/00-architecture.md) · [Design system](docs/01-design-system.md) · [Roadmap](ROADMAP.md)

</div>

![The Hauser ambient lock screen: a large clock, the date, household context, upcoming events and notes arranged for glanceable use on a wall panel.](website/media/lockscreen.webp)

The ambient lock screen is the default resting state: useful from across the
room, quiet until touched, and a direct path into the relevant household view.

---

## Read this first

Hauser is a **reference implementation**, not a product you install.

It is a complete, working smart home interface that runs on a wall-mounted
tablet in one specific home. The code is licensed under MIT and is currently
developed in a private repository that is kept ready for publication. What it
is *not* yet is
plug-and-play: the rooms, entity IDs and energy sensors are defined in a
TypeScript file, and adapting it to your house means editing that file.

If you are comfortable reading code, that is a half-hour of work. If you are
not, this is probably not for you yet — see [the roadmap](ROADMAP.md).

The static demo build runs the real interface against simulated devices. It is
kept release-ready in the repository and will be hosted publicly with the first
installable beta.

---

## Why it exists

Home Assistant is an excellent automation engine. Its dashboard is a grid you
fill with cards, each written by a different author, each with its own spacing,
motion, and idea of what a button feels like. It works, and it never quite
feels like one product.

Hauser takes the other path:

- **One design system.** Every surface comes from the same tokens, type scale
  and motion spec — see [`design-tokens/`](design-tokens/) and
  [`docs/01-design-system.md`](docs/01-design-system.md).
- **Optimistic UI.** Tap a light and it turns on immediately; the command
  travels afterwards. When the house disagrees, the control animates back to
  the truth instead of quietly lying. See
  [`docs/02-interaction-contract.md`](docs/02-interaction-contract.md).
- **A performance budget treated as a requirement.** Under 16 ms from touch to
  visible feedback, transform and opacity only, no layout thrash. See
  [`docs/03-performance-budget.md`](docs/03-performance-budget.md).
- **Backends without visible seams.** Home Assistant, Jellyfin, calendar data,
  shared household data and the optional Paperless bridge keep their own
  transport boundaries while the interface presents one design system.

The public documentation describes the architecture that is active now. It
deliberately omits superseded plans and rejected alternatives.

## What it does

| Area | |
|---|---|
| **Rooms** | Climate, lights, scenes, presence and window state; each room illustrated in three lighting states that follow the actual lights |
| **Home Assistant** | WebSocket via the official client, optimistic commands with reconciliation, reconnect handling, day/night theming from `sun.sun` |
| **Media** | Jellyfin library, shelves, detail view, HLS playback with resume; room audio through HA media players |
| **Energy** | Live load and daily consumption from real power sensors, with honest empty states for figures the house cannot measure |
| **Everyday** | Calendar, notes, reminders, shopping list, laundry notifications |
| **Documents** | PIN-gated Paperless-ngx search, preview, download and import through the optional companion server |
| **Devices** | Add, hide, rename, assign to a room and reorder entities from inside the UI |
| **Two shells** | A landscape wall panel and a one-handed phone layout, sharing one design system |

### Integration status

This distinction matters because the static demo, an implemented adapter and a
configured live service are not the same thing:

| Integration | Repository implementation | Static beta demo |
|---|---|---|
| **Home Assistant** | Implemented. The official WebSocket client supplies entity state, commands, reconciliation and reconnects. | Simulated entities; no connection to a live HA instance. |
| **Jellyfin** | Implemented. A dedicated REST client handles authentication, shelves, browse and detail data; playback uses PlaybackInfo, HLS and progress reporting. | Curated simulated library data; no connection to a live Jellyfin server. |
| **Calendar** | Implemented through Home Assistant, not as a separate calendar backend. Hauser discovers `calendar.*` entities and reads events with HA's `calendar/list` WebSocket command. The settings UI can also start HA's iCloud/CalDAV config flow. | Curated simulated events. |
| **Reminders and shopping** | Implemented by the optional companion server as a central `family-data.json` store. Reminders can additionally merge selected HA `todo.*` lists read via WebSocket. | Curated simulated data. |
| **Paperless-ngx** | Implemented by the optional companion server. It keeps the Paperless token and PIN server-side and exposes only gated search, processing status, preview/download and import operations. | Deliberately omitted; private documents do not belong in a public static demo. |
| **Notion** | **Not integrated.** There is no Notion client, API route or runtime adapter in this pre-beta line. Household reminders and shopping were moved to Hauser's central companion store instead. | Not applicable. |

## Screenshots

| | |
|---|---|
| ![Home screen in light mode with a compact control panel](website/media/hero-home.webp) | ![Notes screen in light mode](website/media/notes.webp) |
| **Home** — compact controls leave the room illustration visible | **Everyday** — shopping and reminders without a second app |
| ![Library screen with shelves of cover art](website/media/library.webp) | ![Energy screen with load, consumption and an hourly chart](website/media/energy.webp) |
| **Library** — Jellyfin, in the same design system | **Energy** — real sensors, honest gaps |

## Architecture

```
Wall panel (Android tablet, kiosk mode)
        │
   Hauser PWA  ← this repository
        │
   ┌────┴──────────────┬──────────────────────┐
   ▼                   ▼                      ▼
HA WebSocket     Jellyfin REST + HLS    Optional companion
devices, energy,                       shared household data
calendar.*, todo.*                     + PIN-gated Paperless
```

The app is Svelte 5 + Vite, with a four-layer adapter between the UI and the
backends: an entity store holding server truth, an overlay of pending intents, a
command queue, and a swappable backend. The UI only ever reads `merged()` and
writes `dispatch()`. That seam is what makes both the optimistic behaviour and
the offline demo possible.

An optional companion server (`app/server.mjs`) adds centrally stored reminders
and shopping lists plus the PIN-gated Paperless-ngx bridge. Paperless credentials
stay in the server keychain and are never shipped to the browser. The core —
rooms, lights, climate, calendar, media and energy — runs without the companion.
There is no Notion dependency.

## Running it

```bash
cd app
npm install
npm run dev
```

That starts against a fake backend with simulated devices, which is the fastest
way to look around.

Run the publication-gate test suite with:

```bash
cd app
npm test
```

### Against your own Home Assistant

1. Create a long-lived access token in Home Assistant.
2. Point the app at your instance — `VITE_HA_URL`, or the connection settings
   in the System tab at runtime.
3. Edit [`app/src/lib/state/app.svelte.ts`](app/src/lib/state/app.svelte.ts):
   `ROOM_SEED` describes your rooms, their lights and their climate entities;
   `ENERGY_SENSORS` lists your power sensors. This is the step there is no way
   around yet.
4. `npm run build`, then serve `app/dist/` however you like.

There is no supported kiosk installer or Docker image in this private pre-beta
development line.

### Building the demo

```bash
cd app
npm run build:demo
```

Produces a fully static bundle in `app/dist-demo/` with a simulated backend, no
companion server, and a permanent "demo" badge. This is the candidate for the
hosted demo that will accompany the public beta.

## Documentation

| | |
|---|---|
| [`docs/00-architecture.md`](docs/00-architecture.md) | Current system architecture and boundaries |
| [`docs/01-design-system.md`](docs/01-design-system.md) | Tokens, palette, typography, motion |
| [`docs/02-interaction-contract.md`](docs/02-interaction-contract.md) | Optimistic UI and reconciliation rules |
| [`docs/03-performance-budget.md`](docs/03-performance-budget.md) | The numbers, and how they are enforced |
| [`docs/04-integrations.md`](docs/04-integrations.md) | Implemented service paths and demo boundaries |
| [`docs/05-screens-and-flows.md`](docs/05-screens-and-flows.md) | Current panel and phone navigation model |
| [`docs/06-component-catalog.md`](docs/06-component-catalog.md) | Component inventory |

The interface speaks German, English, French, Italian, Portuguese and Polish,
and follows the browser language unless you pick one in the settings. Dates,
times and numbers follow the chosen language too.

All repository documentation intended for users and contributors is in English.

## Status and expectations

Hauser is in private pre-beta development. The design system, Home Assistant and
Jellyfin adapters, HA-backed calendar path, optional Paperless bridge,
companion-backed household data, panel shell and phone shell are implemented.
The repository, documentation and static demo are maintained as publication-ready,
but no alpha will be published. The repository becomes public with the first
installable beta, `v0.4.0-beta.1`, after the independent-installation gate passes.
See [ROADMAP.md](ROADMAP.md) for the path to v1.

This is a hobby project maintained by one person. The contribution workflow
becomes active when the repository is made public for beta; response times will
remain unpredictable. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code under the [MIT license](LICENSE). Room illustrations and background artwork
are AI-generated and licensed [CC BY 4.0](ASSETS-LICENSE.md). Fonts and
third-party components are listed in [NOTICE](NOTICE).

Not affiliated with Home Assistant or Jellyfin.
