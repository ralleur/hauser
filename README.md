<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="app/public/brand/hauser-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="app/public/brand/hauser-logo-light.svg">
  <img src="app/public/brand/hauser-logo-light.svg" alt="Hauser" width="380">
</picture>

**A calm, visual Home Assistant frontend for the people who live in the home.**

[**Try the live demo**](https://ralleur.github.io/hauser/demo/) · [Install](#installation) · [Documentation](#documentation-and-troubleshooting) · [Roadmap](ROADMAP.md)

</div>

## What is Hauser?

Hauser is a self-hosted Home Assistant frontend and household dashboard. It
prioritises a coherent visual language, room context and immediate feedback over
maximum technical information density. The goal is a screen that feels calm and
obvious to everyone in the home—not a wall of unrelated cards.

It runs as a landscape wall-panel interface and as a compact phone layout. Home
Assistant remains the automation engine and source of device truth.

## What does it look like?

[![Hauser room dashboard in English, showing room navigation, lighting controls, climate state and the illustrated living room.](website/media/hero-home.webp)](https://ralleur.github.io/hauser/demo/)

*The room dashboard is the primary experience: the current room stays visually
present while its devices and climate controls remain close at hand.*

| Lighting control | Phone layout |
|---|---|
| ![English Hauser lighting controls with brightness and colour-temperature interaction.](website/media/device-control.webp) | ![English Hauser phone layout with illustrated room cards and bottom navigation.](website/media/phone.webp) |
| Direct controls use optimistic feedback and reconcile with Home Assistant state. | The same rooms and interaction language adapt to a one-handed viewport. |

## Live demo

**[Open the public Hauser demo →](https://ralleur.github.io/hauser/demo/)**

The demo is the real static beta interface running against representative
simulated devices. It does not connect to the maintainer's Home Assistant,
Jellyfin or household services, and it needs no installation. Try room
navigation, light controls, climate state, the phone-sized layout and the other
included screens directly in the browser.

## Core features in `v0.4.0-beta.1`

- **Room-first dashboard:** illustrated rooms, climate, lights, presence and
  window state in one consistent control surface.
- **Home Assistant integration:** official WebSocket client, optimistic commands,
  server-state reconciliation, unavailable-state handling and reconnect without
  a page reload.
- **In-app setup:** discover Home Assistant Areas and entities, create or reorder
  rooms, rename devices and review the generated configuration before activation.
- **Panel and phone shells:** one design system across a wall panel and compact
  mobile navigation.
- **Energy:** current measured load and daily consumption, with honest empty
  states when a home has no PV or grid sensors.
- **Media:** optional Jellyfin shelves, detail views, HLS playback and resume;
  room audio through Home Assistant media players.
- **Everyday screens:** calendar, shopping, reminders and notes, plus optional
  companion-server integrations.
- **Persistent operation:** versioned household configuration, automatic schema
  migration, named volumes, health checks, backup/restore and manual rollback.

Hauser does not advertise roadmap work as released functionality. In particular,
the guided portable laundry setup and personal room-image wizard remain later
beta work.

## Installation

The primary release artifact is the versioned multi-architecture image
`ghcr.io/ralleur/hauser:v0.4.0-beta.1`.

```bash
git clone --branch v0.4.0-beta.1 https://github.com/ralleur/hauser.git
cd hauser
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
docker compose exec hauser node container/healthcheck.mjs
```

Open <http://localhost:4173>. The default bind is loopback-only. To expose Hauser
on a trusted home LAN, set the exact bind address and allowed browser origins in
`.env`; do not expose the service directly to the public internet.

For a deliberate source build instead of the release image:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

The complete installation, persistence, update, backup, restore and rollback
contract is in [`docs/08-installation.md`](docs/08-installation.md).

## Setup

A fresh config volume opens the setup wizard. The shortest path to a usable
dashboard is:

1. choose the interface language;
2. enter a Home Assistant URL and a dedicated Long-Lived Access Token;
3. let Hauser discover Areas, devices and relevant entities;
4. review room names, order and device assignments;
5. configure or skip optional Jellyfin access;
6. validate and activate the generated household configuration.

Both the browser and the Hauser container must be able to reach the configured
Home Assistant URL. The wizard changes only Hauser's configuration; it does not
rename or delete Home Assistant Areas or entities. Later changes live directly
under **System → Home → Rooms & devices**.

## Requirements

- Docker Engine with Docker Compose v2;
- network access to GHCR, or Buildx for a source build;
- a modern browser that can reach the published Hauser port;
- a reachable Home Assistant instance and a dedicated Long-Lived Access Token;
- correct same-origin configuration through `HMI_ALLOWED_ORIGINS` when using a LAN
  hostname, reverse proxy or non-default port.

The qualified beta path is Linux containers through Docker Desktop on Apple
Silicon. The release workflow also publishes `linux/amd64`, but broader host and
Home Assistant topology compatibility is not yet a tested support matrix.

## Known beta limitations

- The clean-room install was operated by the maintainer. It proves the technical
  path, not yet usability by an unrelated installer or compatibility with a
  second real household.
- The first external real-home installation and a release-to-release upgrade are
  beta-stabilisation gates before the release candidate.
- Live Jellyfin was verified separately; the clean-room setup exercised the
  optional-disabled path.
- Guided portable laundry setup and personal room-image generation are not part
  of this release.
- French, Italian, Portuguese and Polish have not been reviewed by native
  speakers.
- Hauser is a hobby project with no SLA or support promise.

## Documentation and troubleshooting

| Guide | Purpose |
|---|---|
| [`docs/08-installation.md`](docs/08-installation.md) | Install, LAN exposure, health, persistence, backup, restore and rollback |
| [`docs/08-installation.md#setup-and-entity-troubleshooting`](docs/08-installation.md#setup-and-entity-troubleshooting) | Rejected tokens, unreachable HA, proxy/origin errors and removed entities |
| [`docs/07-configuration.md`](docs/07-configuration.md) | Versioned household configuration and fail-closed validation |
| [`docs/09-dev-pilot.md`](docs/09-dev-pilot.md) | Isolated synthetic Home Assistant for development and onboarding tests |
| [`docs/00-architecture.md`](docs/00-architecture.md) | Current architecture and product boundaries |
| [`docs/01-design-system.md`](docs/01-design-system.md) | Design tokens, typography, colour and motion |
| [`docs/02-interaction-contract.md`](docs/02-interaction-contract.md) | Optimistic UI, reconciliation and offline behaviour |
| [`docs/03-performance-budget.md`](docs/03-performance-budget.md) | Enforced startup and interaction budgets |
| [`docs/04-integrations.md`](docs/04-integrations.md) | Implemented service paths and demo boundaries |
| [`docs/05-screens-and-flows.md`](docs/05-screens-and-flows.md) | Panel and phone navigation model |

## Architecture

```text
Wall panel / phone browser
          │
      Hauser PWA
          │
   ┌──────┴───────────┬─────────────────────┐
   ▼                  ▼                     ▼
Home Assistant   Jellyfin REST + HLS   Optional companion
WebSocket         media library         household data
```

The Svelte 5 application keeps backend truth, pending intents, command dispatch
and merged UI state behind one adapter boundary. Controls respond immediately;
Home Assistant state then confirms or corrects the optimistic result. Credentials
for optional server-side integrations stay outside the browser bundle.

The static demo uses the same UI against a fake backend. Simulated success is not
presented as evidence of a configured live service.

## Development

```bash
npm ci --prefix app
npm run dev --prefix app
```

The development server uses simulated devices by default. Build the same static
artifact type used by Pages with:

```bash
npm run build:demo --prefix app
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for focused changes, privacy rules and the
validation contract.

## License

Application code, tests, scripts, configuration examples, design tokens and
technical documentation are licensed under the [MIT license](LICENSE). Original
room illustrations, backgrounds and public screenshots are licensed
[CC BY 4.0](ASSETS-LICENSE.md).

The Hauser name, logos, app icons and favicon are not covered by MIT or CC BY;
see [TRADEMARKS.md](TRADEMARKS.md). Fonts, Material Design Icons and other
third-party components keep their own licenses as listed in [NOTICE](NOTICE).

Not affiliated with Home Assistant or Jellyfin.
