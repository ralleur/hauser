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

Hauser is in its public technical beta, and it is what the author's own house
runs on every day. The design system, Home Assistant and Jellyfin integrations,
deterministic setup wizard, landscape panel, compact phone shell and everyday
household screens are implemented. Two installation paths are built and
exercised: a **Home Assistant App** that talks to Home Assistant through the
Supervisor with no token in the browser, and Docker Compose for Container, NAS
and plain Docker hosts. One external household has installed and run a published
release independently ([#7](https://github.com/ralleur/hauser/issues/7), Docker
Compose on Linux x86_64, roughly 370 entities across 8 areas).

No alpha was published; `v0.4.0-beta.1` was the first public release, and the
beta line ran through `v0.4.0-beta.10`. From `v0.5.0` on the `-beta.N` suffix is
gone: every release below `v1.0.0` is a beta, so the version number says it on
its own.

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
| Guided, OpenAI-assisted room image wizard in the HMI style | **Built** |
| Hotel mode: a dedicated panel as a guest surface for one holiday apartment | **Built** |
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

## Everyday screens

| Item | Status |
|---|---|
| Calendar, notes, reminders, shopping list | **Built** |
| Laundry notifications from preconfigured Home Assistant status helpers | **Built** |
| Guided, portable Home Assistant laundry setup | **Built** |
| Generic notification core beyond laundry | **Planned** |
| Document access via Paperless-ngx, PIN protected | **Built** |
| Standby screen with clock, week strip, notes and shopping list | **Live** |
| Optional street map of your own surroundings behind the standby screen | **Built** |
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

Hauser ships the existing AI-generated project illustrations as its room-image
defaults and fallbacks. They are licensed under the repository's CC BY 4.0 asset
boundary. One of the source photographs is published on the project website to
show what the room-image wizard takes as input; the remaining private source
photographs are not included.

There are three ways to get your own rooms on screen. You can keep the bundled
illustrations. You can upload, replace and remove a local JPEG, PNG, WebP or AVIF
background under room editing without touching files or JSON. Or you can use the
guided room-image wizard, which turns a photograph of your own room into an
illustration in the interface's style and derives its lighting variants. The
wizard needs your own OpenAI credentials, is entirely optional, and every other
part of the product works without it.

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

## Installation and operation

| Item | Status |
|---|---|
| Home Assistant App: Supervisor-managed, no Home Assistant token in the browser | **Live** |
| Docker Compose for Container, NAS and plain Docker hosts | **Built** |
| Guided setup wizard for Home Assistant and optional Jellyfin | **Live** |
| Versioned household configuration with migration and fail-closed start | **Live** |
| Persistent config, data and asset volumes; backup, restore, manual rollback | **Built** |
| Multi-architecture images (`amd64`, `aarch64`) | **Built** |

---

## Path from private development to v1

| Stage | Target | Exit evidence |
|---|---|---|
| Private public-ready development | `v0.3.x` internal | Anonymised repository, publication-facing documentation, test suite and static demo build stay green; no alpha is published |
| Installable public beta | `v0.4.0-beta.1` | First public release: the final package passes isolated clean-room setup, control, reconnect and persistence without source edits; project illustrations remain the defaults and users can upload local room backgrounds |
| Beta stabilisation | `v0.6.3` and later `v0.x` | An external real-home installation is done ([#7](https://github.com/ralleur/hauser/issues/7)); a release-to-release upgrade, backup/restore and rollback on an external installation are still outstanding before RC |
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
quality/image automation are active. The Home Assistant App path is built and
runs the author's own installation, so the browser no longer holds a Home
Assistant token there. Portable laundry setup and the guided room-image wizard
shipped as optional post-beta slices; neither is a v1 gate.

The mandatory external household has since installed and run a published release
independently. What beta stabilisation still owes is the harder half of that
evidence: an upgrade from one published release to the next, plus backup,
restore and rollback, carried out on an installation the author does not
operate.

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

- A release-to-release upgrade, backup/restore and rollback have not yet been
  carried out on an **external** installation. This is the main piece of evidence
  still missing before a release candidate.
- The first complete external contribution cycle has not happened yet; it remains
  a goal of the beta rather than a claim made here.
- The Home Assistant App path has been exercised by the author and by one
  external bug report, not across a range of Home Assistant OS hardware.
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
| Gating features behind a paid tier in the public build | Every feature in the public repository stays available under the AGPL |

> **Changed after v0.4.0-beta.6:** an earlier version of this table promised that Hauser
> would stay MIT licensed. It moved to the GNU Affero General Public License
> instead, starting with v0.4.0-beta.7, and the project's license identifier is
> `AGPL-3.0-only` from v0.4.0-beta.8 onwards. AGPL is still an
> OSI-approved open source license and everything released up to and including
> v0.4.0-beta.6 remains MIT, but the earlier wording was a commitment and
> withdrawing it belongs in the open rather than in a quiet edit.
