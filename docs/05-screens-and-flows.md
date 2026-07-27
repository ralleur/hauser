# Screens and flows

Hauser has two presentation shells over one screen and state model: a
landscape wall panel and a one-handed phone PWA.

## Wall-panel shell

The panel exposes these current destinations:

| Destination | Purpose | Primary data source |
|---|---|---|
| Home | Room status, lights, climate, scenes and security context | Home Assistant |
| Energy | Measured consumption and available flow data | Home Assistant |
| Calendar | Week and agenda views | Home Assistant calendars |
| Notes | Shopping groups and reminders | Companion and selected HA task lists |
| Media | Room audio controls | Home Assistant media players |
| Songs | Local song-workshop library and generation workflow | Companion |
| Library | Video shelves, details and playback | Jellyfin |
| Files | Protected document search, preview and import | Paperless through companion |
| System | Connection, appearance, layout and maintenance settings | Local configuration and adapters |

The ambient layer is the resting panel surface. It replaces the normal shell
with time, date, household context and upcoming items. Touching calendar or note
content opens that destination; touching the remaining surface returns to Home.
Ambient mode is a layer, not another navigation tab.

## Phone shell

The phone shell keeps three configurable destinations in the bottom bar plus a
fixed **More** button. Remaining destinations appear in the More sheet and can
be reordered. Media remembers whether the user last opened room audio or the
Jellyfin library.

The phone uses full-height sheets for room and device detail, preserves safe-area
insets in standalone mode, and integrates temporary layers with browser Back.
Shopping and reminders are separate phone destinations even though the panel
combines them in Notes.

## Shared navigation behavior

- Navigation changes local state and never waits for a backend.
- Switching destinations closes transient room, scene, device and menu layers.
- Library detail remains under the Library navigation destination.
- A failed service connection does not redirect to demo content.
- Screen transitions use opacity and transform only and honor reduced motion.

## Core detail flows

### Room control

```text
Home room selection
  → room detail overlay/sheet
  → optimistic light, climate or scene action
  → authoritative Home Assistant reconciliation
```

### Calendar

```text
Calendar or ambient week
  → selected Home Assistant calendar sources
  → requested date range
  → normalized week/agenda projection
```

### Jellyfin playback

```text
Library shelf
  → item or episode detail
  → PlaybackInfo negotiation
  → native HLS or hls.js player
  → progress and stopped reports
```

### Paperless

```text
Files
  → server-checked PIN session
  → search and date filters
  → preview or download
  → optional document import
```

## Demo behavior

The public demo keeps the same shell, navigation and component behavior while
using deterministic synthetic state. Paperless is hidden because the static
demo does not run the companion. No live-service failure is silently replaced
with fake data in a normal live build.
