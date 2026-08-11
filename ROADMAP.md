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

Hauser's first public technical beta is available. The design system, Home
Assistant and Jellyfin integrations,
deterministic setup wizard, landscape panel, compact phone shell and everyday
household screens are implemented. The versioned Compose path and isolated
clean-room onboarding gate are green. No alpha was published;
`v0.4.0-beta.1` is the first public release.

A thin Home Assistant App package for `0.4.0-beta.3` is published. It reuses the
versioned multi-architecture image and the existing direct-port setup path;
Docker/Compose remains supported. The maintainer-operated real Home Assistant OS
smoke passed installation, startup, setup, one real entity command and persistence
across an App restart. An unrelated real-home installation remains the next
beta-stabilisation evidence gate.

---

## Product philosophy

A smart home has two different interface jobs:

1. **Operator cockpit.** Dense status, diagnostics, configuration and technical
   detail for the person who builds and maintains the system.
2. **Household surface.** A calm, recognisable and intuitive interface for the
   people who live with the system without needing to understand it.

Hauser is deliberately built around the household surface. Home Assistant
remains the deeper operator cockpit; Hauser exposes management and detail views
only where they improve everyday use. Its permanent overview is not expected to
show every available entity or measurement.

Visual space, room artwork and restrained information density are therefore
functional choices rather than decoration. New information belongs on a primary
surface only when it is relevant at a glance or immediately actionable.
Operator-only detail should stay behind a deliberate interaction or in Home
Assistant itself.

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

## Everyday screens

| Item | Status |
|---|---|
| Calendar, notes, reminders, shopping list | **Built** |
| Laundry notifications from preconfigured Home Assistant status helpers | **Built** |
| Guided, portable Home Assistant laundry setup | **Next** |
| Generic notification core beyond laundry | **Planned** |
| Document access via Paperless-ngx, PIN protected | **Built** |
| Aggregated daily events from multiple calendar sources | **Planned** |

### Near-term beta priority: portable laundry notifications

The current implementation displays deduplicated washer and dryer `running` and
`done` notifications, but another household must still prepare compatible Home
Assistant helpers and bind their entity IDs manually. The next beta feature slice
will move that setup into **System → Notifications → Laundry**.

Users will be able to select existing Home Assistant status entities. A guided
Home Assistant blueprint path will follow for households that only have power
sensors: choose the sensor, review thresholds and hold times, preview the HA
objects to be created, then confirm explicitly. Cycle detection stays in Home
Assistant so it keeps working while every Hauser screen is offline. Multi-device
dismissal, quiet hours, browser push and additional notification channels remain
later work.

### Near-term beta priority: personal HMI-style room images

Users with a configured OpenAI login or API key will be able to open a bounded
wizard under **System → AI → AI functions**, upload a real room photo and turn it
into a room background that matches Hauser's illustration style. Hauser will
probe image-generation capability rather than assume that every OpenAI or Codex
login includes it.

The flow follows a clear before/after comparison: upload and crop, review the
privacy and cost notice, generate variants, choose one, then assign it to an
existing room. Assignment can also be changed later under **System → Home → Rooms
& devices → Room → Room image**. The resulting day, night/lights-on and
night/lights-off set is stored in the persistent user-asset volume and referenced
by versioned household configuration; image updates never overwrite it.

Credentials stay server-side. Source metadata is stripped, temporary uploads are
deleted by default, room recognition remains a suggestion requiring confirmation,
and the image model receives no Home Assistant, repository, terminal or deployment
tools. This is intentionally separate from the maintainer's private code-modifying
AI workflow.

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

## Path to v1

| Stage | Target | State | Exit evidence |
|---|---|---|---|
| Private public-ready development | `v0.3.x` internal | **Complete** | Anonymised repository, publication-facing documentation, test suite and static demo build stayed green; no alpha was published |
| Installable public beta | `v0.4.0-beta.1` | **Released** | Public repository, tag, GitHub Release, versioned GHCR image and Pages demo trace to the qualified candidate |
| Beta stabilisation | `v0.4.x-beta.N` | **Current** | An external real-home installation plus a release-to-release upgrade, backup/restore and rollback pass before RC |
| Release candidate | `v0.9.0-rc.1` | **Future** | Configuration contract frozen; clean install, upgrade and rollback green; only release blockers remain |
| Stable | `v1.0.0` | **Future** | The unchanged final RC is published and its actual release artifacts pass a fresh smoke test |

The critical path is configuration, installation and upgrade evidence — not
adding every feature in the backlog. The versioned external household
configuration core is built and exercised with independent neutral fixtures.
The versioned container/Compose installation path, persistent volumes,
readiness contract, backup/restore helpers and deterministic Home Assistant setup
wizard are built. Room creation, renaming, ordering and controlled deletion are
available inside the product, and panel/phone layouts have been exercised from
zero to twelve rooms. The isolated development pilot has passed both
explicit-Area and no-Area onboarding, command/state echo, reconnect and
persistence. Beta versioning, changelog, release-note structure and tag-gated
quality/image automation are active. Beta stabilisation now requires external
installation, upgrade and rollback evidence. A real external household
remains mandatory before RC; AI-assisted setup may complement it later but is
not a v1 gate.

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
- Laundry notifications currently require manually prepared Home Assistant
  status helpers and a manual entity binding; the guided portable setup above is
  the next beta feature slice.
- Personal room-image generation and assignment are not built yet; they are a
  prioritised optional beta feature and require the user's own image-capable
  OpenAI access.
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
