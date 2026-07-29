# Roadmap

This is a hobby project. Nothing here is a commitment, a date, or a promise —
it is an honest picture of where things stand, so you can judge whether the
project is going somewhere you care about.

Status vocabulary:

| Status | Meaning |
|---|---|
| **Live** | Running daily on the author's wall panel |
| **Built** | Implemented and working, less thoroughly exercised |
| **Planned** | Intended, designed, not built |
| **Maybe** | Idea with merit, no decision |
| **Not planned** | Deliberately out of scope |

---

## Where the project is today

Hauser is currently developed in a private pre-beta repository. The design
system, Home Assistant and Jellyfin integrations, landscape panel, compact phone
shell and everyday household screens are implemented. The repository is kept
publication-ready throughout development, but no alpha release will be
published. The first public release is the installable beta.

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
| Device management in the UI — add, hide, assign to room, reorder | **Live** |
| Phone shell alongside the tablet panel shell | **Live** |
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
| Laundry notifications | **Built** |
| Generic notification core beyond laundry | **Planned** |
| Document access via Paperless-ngx, PIN protected | **Built** |
| Aggregated daily events from multiple calendar sources | **Planned** |

---

## Path from private development to v1

| Stage | Target | Exit evidence |
|---|---|---|
| Private public-ready development | `v0.3.x` internal | Anonymised repository, publication-facing documentation, test suite and static demo build stay green; no alpha is published |
| Installable public beta | `v0.4.0-beta.1` | First public release: the final package passes isolated clean-room setup, control, reconnect and persistence without source edits |
| Beta stabilisation | `v0.4.x-beta.N` | An external real-home installation plus a release-to-release upgrade, backup/restore and rollback pass before RC |
| Release candidate | `v0.9.0-rc.1` | Configuration contract frozen; clean install, upgrade and rollback green; only release blockers remain |
| Stable | `v1.0.0` | The unchanged final RC is published and its actual release artifacts pass a fresh smoke test |

The critical path is configuration, installation and upgrade evidence — not
adding every feature in the backlog. The versioned external household
configuration core is built and exercised with independent neutral fixtures.
The source-built container/Compose installation path, persistent volumes,
readiness contract, backup/restore helpers and deterministic Home Assistant setup
wizard are built. The isolated development pilot has passed both explicit-Area
and no-Area onboarding, command/state echo, reconnect and persistence. The next
technical milestone is the final release package and registry image. A real
external household remains mandatory during beta stabilisation before RC;
AI-assisted setup may complement it later but is not a v1 gate.

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

- The container image is built locally from source; no registry image is
  published before the beta gate.
- The clean-room pilot proves the technical setup contract, not yet usability by
  an external person or compatibility with a second real device topology.
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
