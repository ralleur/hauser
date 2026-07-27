# Performance budget

Performance is a release constraint. Build-size limits are enforced by the
repository; runtime targets are reviewed on the target viewport and hardware.
KiB means 1,024 bytes.

## Enforced build budgets

| Asset graph | Hard limit |
|---|---:|
| Initial-route JavaScript, minified and gzip-compressed | less than 80 KiB |
| Initial CSS, minified and gzip-compressed | less than 20 KiB |

`app/scripts/performance-budget.mjs` starts at the production
`dist/index.html`, follows the static ESM graph and measures the actual file
bytes with Node's gzip implementation. A file reachable only through
`import()` is reported as dynamic unless it is also statically reachable.
Missing assets, unsafe paths, parse failures and unresolved non-literal dynamic
imports make the report fail rather than under-counting the build.

Run the gate after a production build:

```bash
npm run build --prefix app
npm run performance:budget --prefix app
```

`npm run performance:report --prefix app` emits the same JSON inventory without
using a budget miss as its process exit code.

## Initial-route rules

The initial phone or panel route must not eagerly load work that belongs to an
inactive feature. In particular:

- `hls.js` and the video player stay behind a dynamic import;
- large icon-selection tooling is not part of normal startup;
- panel hero images do not enter the phone startup graph;
- inactive shells and administrative screens are loaded only when needed.

Fonts are self-hosted and make no third-party request. Their file-size review is
separate from the JavaScript and CSS gate.

## Interaction targets

| Metric | Target |
|---|---:|
| Pointer input to visible pressed feedback | under 16 ms |
| Pointer input to optimistic state | under 50 ms |
| Pointer input to backend dispatch | under 100 ms |
| Screen transition duration | at most 240 ms |
| Long tasks during normal interaction | none over 50 ms |
| Cumulative layout shift after shell mount | 0 |

Application-side timestamps are useful for regression testing, but do not
measure the complete physical touch-to-display path. Device testing is still
required for that claim.

## Rendering rules

Interaction-critical animation may change only `transform` and `opacity`.
Animating layout dimensions, position, margin, padding or font size is not
accepted. Large animated shadows and animated backdrop filters are also
excluded from critical paths.

Static blur can be used for an overlay when the device handles it, but the blur
value itself is not animated. Reduced-motion mode removes non-essential motion.

## Runtime review targets

| Metric | Target |
|---|---:|
| First contentful paint | under 1 second in a controlled run |
| Interactive after a cached start | under 2 seconds in a controlled run |
| Warm resume | under 500 ms to respond |
| Idle JavaScript heap | under 50 MB |
| Global DOM hard limit | under 1,500 nodes |
| Phone home including connection/login layers | under 800 nodes |

Lighthouse, browser performance entries and device traces are recorded as
separate measurement classes. Results are compared only when viewport, device
scale, cache state, throttling and login/connection state match.
