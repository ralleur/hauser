# Roadmap

This is a hobby project. Nothing here is a commitment, a date, or a promise —
it is an honest picture of where things stand, so you can judge whether the
project is going somewhere you care about.

Status vocabulary:

| Status | Meaning |
|---|---|
| **Live** | Running daily on the author's wall panel |
| **Built** | Implemented and working, less thoroughly exercised |
| **Experimental** | Off by default, needs extra pieces, or not yet confirmed on real devices |
| **Next** | The package being built now |
| **Planned** | Intended, not built yet |
| **Maybe** | Idea with merit, no decision |
| **Not planned** | Deliberately out of scope |

---

## Where the project is today

Hauser is in its public beta, and it is what the author's own house runs on
every day. It comes two ways: as a **self-hosted panel for Home Assistant**,
installed as a Home Assistant App or with Docker Compose, and as an **iOS app**
for iPhone and iPad that runs with **Apple Home or Home Assistant**. The iOS app
is a separate project and not part of the Hauser release; it is in beta through
[TestFlight](https://testflight.apple.com/join/WPcA1eE1).

Other households now run Hauser as a Home Assistant App and with Docker
Compose, including on a NAS, and their bug reports shape the releases
([#7](https://github.com/ralleur/hauser/issues/7) was the first). Releases come
in small packages, often several a week; the [changelog](CHANGELOG.md) carries
every one of them. Recent packages gave Hauser its own typeface, let devices
follow their Home Assistant areas, put a presence dot on room tiles, laid the
standby week open on the street map, kept ticked-off shopping items in view for
a day and made shops renamable.

Every release is set up and clicked through against a simulated, deliberately
hostile Home Assistant — broken devices, odd names, floods of entries, a server
that restarts — in the web app and in the iOS app. Every fault a user reports
becomes a permanent case there.

No alpha was published; `v0.4.0-beta.1` was the first public release. From
`v0.5.0` on the `-beta.N` suffix is gone: every release below `v1.0.0` is a
beta, so the version number says it on its own.

---

## Next: a place for what the house wants to say

Today a notification from Home Assistant appears as a floating tile. Two fit on
screen; a third waits unseen, and the "open notifications" link of a push lands
on the home screen because there is nothing else to open. The next package
gives notifications a place:

- **A Notifications screen** with everything open and a history, reached from a
  "+N" beside the tiles and from the push link.
- **A note from Home Assistant.** Pick a text entity; whatever Home Assistant
  writes into it — "Paper bin tomorrow" — stands on the standby screen and the
  pinboard until it is empty again. States become notes, events stay tiles.
- **Home Assistant notifications in the iOS app**, through the Hauser server.
  With Apple Home the app keeps showing what the device itself can see, and
  says so.

Home Assistant keeps doing the thinking; Hauser shows it.

---

## Rooms and control

| Item | Status |
|---|---|
| Design tokens, motion system, own typeface (Alegreya Sans and Alegreya) | **Live** |
| The room picture is the state: light, dusk, weather in the windows | **Live** |
| Data-driven room control surface; every device type has a second level with everything it supports | **Live** |
| Optimistic UI with undo instead of confirmation, reconnect handling | **Live** |
| Day/night theming driven by `sun.sun`, five-state appearance cycle | **Live** |
| Device management in the UI — add, hide, assign to room, drag to reorder | **Live** |
| Layout menu on the stage, all-rooms tile view, swipe the control surface away | **Live** |
| Phone: room grid, quick bar with four fields of your choice, room sheet configured in place | **Live** |
| Thermostat as a tile, one central climate control for the house | **Live** |
| Devices follow their Home Assistant area without reloading | **Built** |
| Room tiles show presence while a sensor reports someone, and whether the room has a camera | **Built** |
| Blinds, shutters and awnings as a household role; stop a moving blind with a tap | **Built** |
| Scenes with a colour per lamp | **Built** |
| Camera streams with still images as fallback | **Built** |
| Hotel mode: a panel as a guest surface for one holiday apartment | **Experimental** |
| A new Home Assistant area becomes a room of its own | **Planned** |
| Swipe navigation between screens | **Maybe** |
| A combined tile for several devices | **Maybe** |

## Room pictures

Every room has a picture in three lighting states. There are several ways to get
your own rooms on screen: keep the bundled illustrations, upload your own JPEG,
PNG, WebP or AVIF, or let a wizard turn a photo of your room into an
illustration in the interface's style. The bundled illustrations are licensed
under the repository's CC BY 4.0 asset boundary.

The wizard currently needs an OpenAI account. That is meant as an interim
solution: the goal is a picture of your own room without paying anyone.

| Item | Status |
|---|---|
| Bundled illustrations, local upload, replacement and default restore | **Live** |
| Guided room-image wizard with your own OpenAI account | **Built** |
| iOS app: free drawing through Apple Intelligence on iOS 27 | **Experimental** |
| iOS app: drawing with a free Cloudflare account | **Experimental** |
| iOS app: copy the prompt into any image service, bring the picture back, mark the windows with a finger | **Built** |
| Panel: the same copy-the-prompt path and marking windows by hand | **Planned** |
| Panel: local models and your own API keys for other providers | **Planned** |

## Everyday screens

| Item | Status |
|---|---|
| Standby with clock, week strip, notes, shopping list, weather and moments | **Live** |
| Optional street map of your own surroundings behind the standby screen | **Built** |
| Calendar as one sheet of paper from your Home Assistant calendars | **Built** |
| Shopping list: one Home Assistant to-do list per shop (Bring! works through its integration), Notion as an alternative, shops can be renamed | **Built** |
| Phone shopping list as a checklist: tap to tick, undo, done items stay a day | **Built** |
| Reminders as sticky notes per person | **Built** |
| Presence and moments: greeting the first person home, birthdays, the first snow | **Built** |
| Document access via Paperless-ngx, PIN protected | **Built** |
| Reminders written back to Home Assistant to-do lists, so one list serves panel, phone and iPhone | **Planned** |
| Film and episode dates from Radarr and Sonarr in the calendar | **Maybe** |

## Notifications

| Item | Status |
|---|---|
| Notification rules: you choose the entity and trigger, Home Assistant does the waiting, the panel shows a tile, optionally a push | **Built** |
| Guided, portable laundry setup | **Built** |
| Any automation can send its own notification with a `hauser_` id | **Built** |
| Notifications screen with history, "+N" and a working push link | **Next** |
| A note from Home Assistant on standby and pinboard | **Next** |
| Home Assistant notifications in the iOS app | **Next** |
| Quiet hours and dismissal across all devices | **Planned** |

## Energy

| Item | Status |
|---|---|
| Live load, solar and grid as notes pinned into a picture of your own house | **Live** |
| Graceful empty states when PV or grid sensors are absent | **Live** |
| Phone: watts now, a period with its curve and yesterday for comparison, the biggest consumers | **Built** |
| Today's balance and the sun's arc above the house | **Built** |

## Media

| Item | Status |
|---|---|
| Jellyfin library, shelves, detail view | **Live** |
| HLS playback with resume and progress | **Live** |
| Player controls: audio track and subtitle language | **Built** |
| Room audio via Home Assistant media players | **Experimental** |
| Player volume control | **Planned** |
| Request and recommendation integration | **Maybe** |

## iOS app

A native SwiftUI app, not a web view: the same rooms, words and gestures as the
panel. It lives in its own repository and has its own release rhythm. Every
fault found in the web app is checked in the iOS app and the other way round.

| Item | Status |
|---|---|
| Apple Home directly, without any server | **Built** |
| Home Assistant through the Hauser App, paired with a QR code | **Built** |
| Phone layout on iPhone, wall-panel layout on iPad | **Built** |
| Widgets, Live Activity, Siri shortcut, share sheet for the shopping list | **Built** |
| Shopping list sorted by aisle on the device with Apple Intelligence, offline | **Built** |
| Six languages, like the panel | **Built** |
| An Apple Watch app | **Planned** |

## Installation and operation

| Item | Status |
|---|---|
| Home Assistant App: Supervisor-managed, no Home Assistant token in the browser | **Live** |
| Docker Compose for Container, NAS and plain Docker hosts | **Built** |
| Guided setup wizard for Home Assistant and optional Jellyfin | **Live** |
| Versioned household configuration with migration and fail-closed start | **Live** |
| Persistent config, data and asset volumes; backup, restore, manual rollback | **Built** |
| Multi-architecture images (`amd64`, `aarch64`), a GitHub release per version | **Built** |
| The question mark in the title bar sends a problem or a wish, no account needed | **Live** |
| Companion app pairing with a one-time QR code and device tokens | **Experimental** |
| Remote access through Tailscale, only for paired devices | **Experimental** |

---

## Path from private development to v1

| Stage | Target | Exit evidence |
|---|---|---|
| Private public-ready development | `v0.3.x` internal | Anonymised repository, publication-facing documentation, test suite and static demo build stay green; no alpha is published |
| Installable public beta | `v0.4.0-beta.1` | First public release: the final package passes isolated clean-room setup, control, reconnect and persistence without source edits |
| Beta stabilisation | `v0.30.0` and later `v0.x` | External households install and update on their own ([#7](https://github.com/ralleur/hauser/issues/7) and later reports); a documented backup, restore and rollback on an installation the author does not operate is still outstanding |
| Release candidate | `v0.x.0-rc.1` | Configuration contract frozen; clean install, upgrade and rollback green; only release blockers remain |
| Stable | `v1.0.0` | The unchanged final RC is published and its actual release artifacts pass a fresh smoke test |

Hauser stays below 1.0 for a good while yet, at least through the coming
winter. 1.0 is meant as a stability promise to the people who use it, so it
comes after months of daily use and feedback from other households, not on a
date. Until then the work goes into details, design and speed rather than new
modules, and the iOS app grows alongside.

The critical path is configuration, installation and upgrade evidence — not
adding every feature on this page. The versioned household configuration, the
Home Assistant App, the Compose path with persistent volumes and backup and
restore helpers, and the deterministic setup wizard are built and in use outside
the author's home. Room creation, renaming, ordering and deletion happen inside
the product, and panel and phone layouts are exercised from zero to twelve rooms
and, in the simulated house, far beyond.

A code-modifying AI agent that commits, pushes and redeploys the application is
deliberately **not part of the portable product**. It remains an operator-owned
development workflow rather than a capability of the read-only Docker runtime.

## Internationalisation

**Status: Built.**

The interface ships in German, English, French, Italian, Portuguese and Polish,
on the panel and in the iOS app. It follows the browser language unless a
language is chosen in the settings, and switches without reloading — the wall
panel keeps its connection and its entity cache. Dates, times and numbers follow
the chosen language as well.

Translations live in `app/messages/` and are compiled into plain functions at
build time, so six languages cost the initial bundle about 50 bytes. Adding a
language means adding one JSON file.

Two honest caveats. The German and English catalogues are first-hand; French,
Italian, Portuguese and Polish were written carefully but have not been reviewed
by native speakers — corrections are very welcome
([#1](https://github.com/ralleur/hauser/issues/1)–[#4](https://github.com/ralleur/hauser/issues/4)).
And Polish has three plural forms, which the message format does not yet
express; the affected strings are phrased to avoid the plural rather than get it
wrong.

Room, device and scene names are **not** translated. They come from your own
configuration, not from the interface.

---

## Known gaps

- A backup, restore and rollback has not yet been carried out and documented on
  an **external** installation. External households do update from release to
  release; this is the main piece of evidence still missing before a release
  candidate.
- Usability by someone new is known from bug reports and forum posts, not from
  watching a first setup.
- The first complete external contribution cycle has not happened yet; it
  remains a goal of the beta rather than a claim made here.
- The Home Assistant App path runs in the author's home and in a handful of
  others, not across a range of Home Assistant OS hardware.
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
| A separate Bring! connection | Bring! already reaches Hauser as a Home Assistant to-do list per shop |
| Grocy | Pantry, best-before dates and recipes are outside what Hauser shows |
| Support for backends the author cannot test against | Cannot be maintained honestly |
| Gating features behind a paid tier in the public build | Every feature in the public repository stays available under the AGPL |

> **Changed after v0.4.0-beta.6:** an earlier version of this table promised that Hauser
> would stay MIT licensed. It moved to the GNU Affero General Public License
> instead, starting with v0.4.0-beta.7, and the project's license identifier is
> `AGPL-3.0-only` from v0.4.0-beta.8 onwards. AGPL is still an
> OSI-approved open source license and everything released up to and including
> v0.4.0-beta.6 remains MIT, but the earlier wording was a commitment and
> withdrawing it belongs in the open rather than in a quiet edit.
