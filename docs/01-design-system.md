# Hauser design system

Hauser uses a small, explicit design system for a touch-first wall panel and a
one-handed phone shell. The source of truth is `design-tokens/`; components
consume the generated CSS custom properties rather than introducing local
colors, spacing scales, radii or motion curves.

## Principles

1. **Glanceable before interactive.** The resting screen must be useful from
   across the room. Detail appears only after intent.
2. **One visual language.** Home, media, energy and household tools share the
   same surfaces, typography, state model and motion rules.
3. **State is visible.** Pending, unavailable, warning and error states may not
   be hidden behind color alone.
4. **Motion is feedback.** Animation confirms an action or explains a state
   transition. Decorative loops are avoided.
5. **Large touch targets.** Interactive areas are at least 44 px, normally
   48 px or larger.
6. **Quiet defaults.** The home control panel starts compact. The light theme is
   the presentation default; the live app can follow `sun.sun` automatically.
7. **Contrast is non-negotiable.** Meaningful text and controls target WCAG AA.

## Color system

Both themes use four surface levels:

| Token | Purpose |
|---|---|
| `--color-surface-0` | application background and persistent bars |
| `--color-surface-1` | cards and primary controls |
| `--color-surface-2` | raised or active controls |
| `--color-surface-3` | overlays and modal surfaces |

Warm accent is reserved for the current selection, a primary action or a
warning. Cool accent communicates neutral action and information. Success,
warning, error and information have dedicated semantic tokens.

The light theme uses neutral grey surfaces and dark inverse pills. The dark
theme uses cool charcoal surfaces and restrained borders. Neither theme changes
component geometry or information hierarchy.

## Typography

- **Inter Variable** is the interface typeface.
- **Instrument Serif** is limited to human, ambient moments such as the resting
  screen.
- Numeric values use tabular figures where movement would otherwise disturb the
  layout.
- The scale deliberately separates small labels from large household values;
  every intermediate size must earn its place.

The bundled fonts and their licenses are listed in `NOTICE`.

## Spacing and geometry

The layout follows a 4/8 px rhythm. Core values are exported as `--space-*`
properties. Cards use 12–20 px radii depending on hierarchy. Persistent panel
chrome is kept visually quiet so room imagery and current state remain the
focus.

The primary panel viewport is **1696 × 1200 CSS pixels** at device scale 1. The
physical target has a higher pixel density, but screenshots and layout review
use CSS pixels; downscaling a physical-resolution capture makes the interface
look artificially small.

The home panel offers three width presets:

| Preset | Control width | Use |
|---|---:|---|
| Compact | 34% | default; one room context and maximum room visibility |
| Balanced | 44% | more controls without dominating the illustration |
| Wide | 56% | deliberate dense-control mode |

## Motion

| Token | Duration | Use |
|---|---:|---|
| instant | 0 ms | atomic state assignment |
| fast | 80 ms | press-in and toggle snap |
| quick | 120 ms | release feedback |
| normal | 180 ms | state transition |
| slow | 240 ms | screen transition |
| enter | 300 ms | modal or overlay entrance; upper limit |

Only `transform` and `opacity` are animated on interaction-critical paths.
`prefers-reduced-motion` reduces all motion durations to zero.

## Interaction states

Every interactive component accounts for:

- default
- hover where a pointing device exists
- pressed
- active or selected
- disabled
- pending/loading
- success
- error with correction to server truth
- unavailable

Optimistic controls update immediately, dispatch the backend command, and then
reconcile against authoritative state. See
[`02-interaction-contract.md`](02-interaction-contract.md).

## Themes and ambient mode

The live panel follows Home Assistant's `sun.sun` state unless a temporary
manual override is active. Public screenshots use light mode by default. A dark
capture should be paired and labelled when the purpose is to demonstrate both
themes.

Ambient mode is a separate resting surface rather than a dimmed application
screen. It presents time, date, weather, household status, upcoming events and
notes at wall-reading distance. Touch zones wake directly into Home, Calendar or
Notes according to the content touched.

## Source of truth

- `design-tokens/tokens.json` — machine-readable tokens
- `design-tokens/tokens.css` — runtime custom properties
- `app/src/styles/` — component and shell composition
- [`06-component-catalog.md`](06-component-catalog.md) — public component map
- [`03-performance-budget.md`](03-performance-budget.md) — measurable limits
