# Hauser component catalog

This catalog describes the public component model. Exact styling values live in
`design-tokens/`; interaction behavior is specified in
[`02-interaction-contract.md`](02-interaction-contract.md).

## Shared state contract

Interactive components must represent the states that apply to them:
`default`, `pressed`, `active`, `disabled`, `pending`, `success`, `error` and
`unavailable`. Hover is progressive enhancement for desktop development, not a
requirement for touch operation.

A pending command may not block the visible state change. Reconciliation either
confirms the optimistic state or visibly corrects it to backend truth.

## Primitives

### Button

- minimum 44 px touch target; 48 px preferred
- ghost variant for secondary actions
- filled warm-accent variant for one primary action
- press feedback via transform, never layout

### Status dot and badge

- semantic color plus a text or icon label
- never the sole carrier of critical meaning
- stable geometry between online, warning and offline states

### Value slider

- 2 px visual track inside a 48 px touch zone
- current value sits in the thumb badge
- dragging updates locally; release dispatches the command
- correction animates to authoritative state

### Tick scale

Used for discrete or continuous household values where relative position matters
more than a heavy track. It supports horizontal and vertical orientations and
keeps numeric width stable with tabular figures.

### Modal and scrim

- fixed overlay above the shell
- static blur; only opacity/transform animate
- outside tap closes when it cannot discard unsaved work
- focus and escape behavior remain keyboard accessible

## Navigation and shell

### Status bar

Shows time, connection state and global actions. It is persistent on the wall
panel and respects standalone safe-area insets.

### Panel tab bar

Keeps primary destinations centered while reserving equal edge zones for global
climate and security controls. Active state uses a short underline instead of a
large filled tab.

### Phone navigation

A four-item, one-handed bottom bar with an overflow destination. Order is
configurable without changing the underlying screen model.

### Ambient layer

The default resting surface for the wall panel. It contains:

- time and date
- indoor/outdoor context
- upcoming week events
- reminders and shopping notes
- an optional deep-night clock

Touching the week opens Calendar; touching notes opens Notes; touching the
remaining surface opens Home.

## Home components

### Room control panel

A configurable surface over the room illustration. Width presets are Compact,
Balanced and Wide; Compact is the default. One or two independently assigned
room slots are supported.

### Room tile

Summarizes room name, measured temperature, target direction, climate mode,
light state, presence and open-window warnings. Selecting a room opens its
controls without replacing the current screen.

### Light control

Variants: toggle, dimmer and color-temperature control. The visible state flips
immediately, then reconciles with Home Assistant.

### Climate control

Shows measured and target temperatures, mode and step controls. Warm/cool target
direction is redundant with text or icon meaning.

### Scene row

A short list of household scenes. Scene application uses the same optimistic
command pipeline as individual devices.

## Media components

### Media zone control

Represents one room player with playback state, transport, volume and source.
Unavailable players preserve the card position and explain the state.

### Library shelf

Horizontal content rail with stable cover geometry, lazy loading and explicit
empty/error states.

### Media detail and player

Detail view keeps title, metadata and primary action visible before extended
information. HLS playback supports resume and reports progress without exposing
the separate media-server interface.

## Energy components

### Energy flow

Shows only measurements the configured home can actually provide. Missing solar
or grid data remains visibly absent rather than estimated.

### Consumption chart

Uses a stable axis and theme-aware contrast. Empty and partial periods are
represented honestly.

### Device consumption list

Ranks measured devices while preserving a readable name/value relationship at
wall distance.

## Everyday components

### Calendar

Week and agenda projections share one event model. Dense information remains
scannable from across the room.

### Notes and reminders

Shopping groups and person-coloured reminder notes have separate semantics but
share the same screen. Color is supplemented by labels.

### Notification layer

Generic notification core with source adapters such as laundry. Repeated refresh
of the same event must not duplicate a tile.

## Configuration components

### Device manager

Adds, hides, renames, assigns and reorders discovered entities. Changes are
previewed before persistence.

### Layout configuration dialog

Configures room slots and width preset. Cancel restores the applied state; Save
persists the draft; Reset returns to the Compact one-slot default.

### Connection settings

Configures Home Assistant and media endpoints. Secrets are never rendered back
into public screenshots or documentation.

## Accessibility and performance

- semantic buttons and landmarks
- visible focus indicators
- labels for icon-only controls
- reduced-motion support
- interaction-critical visual feedback within 16 ms
- no animated layout or backdrop blur
