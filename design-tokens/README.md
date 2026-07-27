# Design tokens

`tokens.css` is the runtime source of truth. `tokens.json` mirrors the same
values for tooling and machine-readable inspection.

## Files

- `tokens.css` — CSS custom properties consumed directly by the application
- `tokens.json` — structured values for tooling, validation and future code generation

## CSS usage

```css
@import './design-tokens/tokens.css';

.my-component {
  background: var(--color-surface-1);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  transition: transform var(--duration-fast) var(--ease-out);
}

.my-component:active {
  transform: scale(0.97);
}
```

## JavaScript usage

```javascript
const style = getComputedStyle(document.documentElement);
const accentColor = style.getPropertyValue('--color-accent-warm');
```

## JSON usage

```javascript
import tokens from './design-tokens/tokens.json' with { type: 'json' };
const surface = tokens.tokens.color.dark.surface['1'].value;
```

## Synchronization

CSS remains authoritative. Any token change must update the JSON mirror in the
same change and preserve semantic names used by the application.

## Token groups

| Group | Contents |
|---|---|
| `color.dark` / `color.light` | surfaces, accents, semantic colors, text and borders |
| `color.dot` | status aliases backed by semantic colors |
| `typography` | font families, sizes, weights, line heights and letter spacing |
| `spacing` | the application spacing scale |
| `radius` | component and hero radii |
| `elevation` | theme-aware overlay shadows |
| `motion` | easing curves and durations |
| `touch` | touch-target and slider-thumb sizes |
| `icon` | icon sizes |
| `grid` | gaps, padding and columns |
| `breakpoint` | documented responsive thresholds; CSS uses the matching literals |

See [the design system](../docs/01-design-system.md) for the usage rules.
