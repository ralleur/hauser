# Roadmap

This is a hobby project. Nothing here is a commitment, a date, or a promise —
it is an honest picture of where things stand, so you can judge whether the
project is going somewhere you care about.

Status vocabulary:

| Status | Meaning |
|---|---|
| **Live** | Running daily on the author's wall panel |
| **Built** | Implemented and working, less thoroughly exercised |
| **Next** | Prioritised for the next beta feature slice |
| **Planned** | Intended, designed, not built |
| **Maybe** | Idea with merit, no decision |
| **Not planned** | Deliberately out of scope |

---

## Where the project is today

Hauser is a private candidate preparing its first public technical
beta. The design system, Home Assistant and Jellyfin integrations, deterministic
setup wizard, landscape panel, compact phone shell and everyday household
screens are implemented. The versioned Compose path and isolated clean-room
onboarding gate are green. No alpha was published; `v0.4.0-beta.1` will be the
first public release.

---

## Core interface

| Item | Status |
|---|---|
| Design tokens, motion spec, component catalog | **Live** |
| Room overview with climate, lights, presence, window state | **Live** |
| Data-driven room control surface with per-room controls | **Live** |
| Optimistic UI with reconciliation and command queue | **Live** |
| Home Assistant WebSocket integration, reconnect handling | **Live** |
| Day/night theming driven by `sun.sun` | **Live** |
| Five-state home appearance cycle: auto, UI-only light/dark, fixed day/evening | **Live** |
| Device management in the UI — add, hide, assign to room, reorder | **Live** |
| Custom room-background upload, replacement and default restore | **Live** |
| Phone shell alongside the tablet panel shell | **Live** |
| OpenAI-assisted, HMI-style room image wizard | **Next** |
| Swipe navigation between screens | **Planned** |
| Drag-and-drop reordering of home tiles | **Planned** |
| Dynamic tile heights and a combined tile | **Maybe** |

## Media

| Item | Status |
|---|---|
| Jellyfin library, shelves, detail view | **Live** |
| HLS playback with resume and progress | **Live** |
| Room audio via Home Assistant media players | **Live** |
| Player controls: volume, audio track, subtitle language | **Planned** |
| Request and recommendation integration | **Maybe** |

## Energy

| Item | Status |
|---|---|
| Live load and daily consumption from real sensors | **Live** |
| Graceful empty states when PV or grid sensors are absent | **Live** |
| Weather variants for the ambient room backgrounds | **Planned** |
| Personal HMI-style room-image generation and assignment | **Next** |

## Everyday screens

| Item | Status |
|---|---|
| Calendar, notes, reminders, shopping list | **Built** |
| Laundry notifications from preconfigured Home Assistant status helpers | **Built** |
| Guided, portable Home Assistant laundry setup | **Built** |
| Generic notification core beyond laundry | **Planned** |
| Document access via Paperless-ngx, PIN protected | **Built** |
| Aggregated daily events from multiple calendar sources | **Planned** |

### Built for the first public beta: portable laundry notifications

The guided setup is available under **System → Notifications → Laundry** without
source-code or manual JSON changes. Households can bind compatible status entities
or use the bundled power-sensor blueprint path.

Users choose the sensor, review thresholds and hold times, preview the exact HA
objects, then confirm explicitly. Cycle detection stays in Home Assistant so it
keeps working while every Hauser screen is offline. The isolated integration
smoke covers `running → done`, marker restoration after an HA restart and complete
cleanup. Multi-device dismissal, quiet hours, browser push and additional
notification channels remain later work.

### Room images

The first public beta ships the existing AI-generated project illustrations as
its room-image defaults and fallbacks. They are licensed under the repository's
CC BY 4.0 asset boundary. The private source photographs used during their
creation are not included.

Users can upload, replace and remove a local JPEG, PNG, WebP or AVIF background directly
under room editing without changing files or JSON. The beta applies that image to
all day/night states. A later guided AI wizard will create separate HMI-style
variants; provider credentials, trusted-proxy authentication and paid image-edit
verification remain post-beta and do not block `beta.1`.

### Live beta polish: five-state home appearance cycle

The Home appearance button rotates through five explicit states: **Auto** (the default, shown with
the same A icon as Settings), **light interface with automatic backgrounds**,
**dark interface with automatic backgrounds**, **light interface with the day
background fixed**, and **dark interface with the evening background fixed**.
The next tap returns to Auto.

Interface and room-background policy are stored separately. Manual choices remain
active until changed instead of silently expiring after 24 hours. The Home
button and **Appearance** settings expose the same five-state source of truth;
fixed-background states receive an additional non-colour indicator so the two
light and two dark modes remain distinguishable.

---

## Path from private development to v1

| Stage | Target | Exit evidence |
|---|---|---|
| Private public-ready development | `v0.3.x` internal | Anonymised repository, publication-facing documentation, test suite and static demo build stay green; no alpha is published |
| Installable public beta | `v0.4.0-beta.1` | First public release: the final package passes isolated clean-room setup, control, reconnect and persistence without source edits; project illustrations remain the defaults and users can upload local room backgrounds |
| Beta stabilisation | `v0.4.x-beta.N` | An external real-home installation plus a release-to-release upgrade, backup/restore and rollback pass before RC |
| Release candidate | `v0.9.0-rc.1` | Configuration contract frozen; clean install, upgrade and rollback green; only release blockers remain |
| Stable | `v1.0.0` | The unchanged final RC is published and its actual release artifacts pass a fresh smoke test |

The critical path is configuration, installation and upgrade evidence — not
adding every feature in the backlog. The versioned external household
configuration core is built and exercised with independent neutral fixtures.
The source-built container/Compose installation path, persistent volumes,
readiness contract, backup/restore helpers and deterministic Home Assistant setup
wizard are built. Room creation, renaming, ordering and controlled deletion are
available inside the product, and panel/phone layouts have been exercised from
zero to twelve rooms. The isolated development pilot has passed both
explicit-Area and no-Area onboarding, command/state echo, reconnect and
persistence. Beta versioning, changelog, release-note structure and tag-gated
quality/image automation are active. Portable laundry setup and bounded personal
room-image creation remain optional post-beta slices and do not delay
publication. Beta stabilisation then continues
through external installation, upgrade and rollback evidence. A real external
household remains mandatory before RC; neither room-image generation nor broader
AI-assisted setup becomes a separate v1 gate.

A code-modifying AI agent that commits, pushes and redeploys the application is
deliberately **not part of the portable product**. It remains an operator-owned
development workflow rather than a capability of the read-only Docker runtime.

## Internationalisation

**Status: Built.**

The interface ships in German, English, French, Italian, Portuguese and Polish.
It follows the browser language unless a language is chosen in the settings, and
switches without reloading — the wall panel keeps its connection and its entity
cache. Dates, times and numbers follow the chosen language as well.

Translations live in `app/messages/` and are compiled into plain functions at
build time, so six languages cost the initial bundle about 50 bytes. Adding a
language means adding one JSON file.

Two honest caveats. The German and English catalogues are first-hand; French,
Italian, Portuguese and Polish were written carefully but have not been reviewed
by native speakers — corrections are very welcome. And Polish has three plural
forms, which the message format does not yet express; the affected strings are
phrased to avoid the plural rather than get it wrong.

Room, device and scene names are **not** translated. They come from your own
configuration, not from the interface.

---

## Known gaps

- The clean-room pilot proves the technical setup contract, not yet usability by
  an external person or compatibility with a second real device topology.

- Personal room-image generation and assignment are deferred until after the
  first public beta. `beta.1` uses the bundled project illustrations as defaults.
- The release automation builds `linux/amd64`, but an installation on an external
  amd64 host has not yet been reported.
- Public installation reports and the first complete external contribution cycle
  have not happened yet; both are goals of the beta rather than claims made at
  launch.
- The full kiosk hardware measurement matrix remains incomplete; the
  instrumentation remains in the code.
- The full icon catalogue is loaded lazily but still creates a large optional
  chunk. The measured initial-route JavaScript and CSS budgets pass.

---

## Not planned

| Item | Why |
|---|---|
| A Lovelace card version | The whole point is not being Lovelace — see `docs/00-architecture.md` |
| Cloud accounts or hosted service | Local-first is a design constraint, not a stage |
| Telemetry or analytics in the app | Same |
| Support for backends the author cannot test against | Cannot be maintained honestly |
| A paid tier, sponsorship-gated features, or an "enterprise" edition | It is MIT and it stays MIT |
