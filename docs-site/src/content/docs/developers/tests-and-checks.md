---
title: Tests and checks
description: The commands that gate a change.
sidebar:
  order: 4
---

From `app/`:

| Command | What it does |
|---|---|
| `npm test` | Vitest suite. Includes contract, migration, server and i18n checks. |
| `npm run check` | `svelte-check` type check |
| `npm run build` | Production build |
| `npm run build:demo` | Static demo build |
| `npm run performance:budget` | Bundle size against the performance budget |

Do not run `check` and `test` at the same time: both regenerate the compiled translations.

## The full package gate

```bash
./scripts/verify-public-package.sh
```

Runs both bundles, the licence boundary, the local link check on the Markdown documents, the Pages build, a disposable container lifecycle and the release metadata check. This is what the pull-request workflow repeats.

## Conventions

- Motion: transform and opacity only, respect reduced motion.
- Nothing hard-coded in the UI language: a lint test fails on German leftovers in English.
- No entity IDs, hostnames or personal data in fixtures. Use the neutral examples.
- Public Markdown documents in the repository are in English.
