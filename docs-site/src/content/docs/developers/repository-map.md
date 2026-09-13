---
title: Repository map
description: Where things live.
sidebar:
  order: 3
---

```text
app/
  src/lib/
    shells/        wall-panel and phone shells
    screens/       Home, Energy, Calendar, Notes, Media, Library, Files, System
    components/    UI components; settings/ and phone/ subfolders
    state/         state projections (rooms, ambient, calendar, edit mode, ...)
    adapter/       backend adapters: Home Assistant, fake backend
    config/        household configuration contract, validator, migration
    room-images/   room-image transform and prompt policies
    demo/          fixtures for the static demo
  server.mjs       request dispatcher
  server/          server modules, one area each
  messages/        translations, one JSON per language
  config/examples/ neutral household examples
  public/          static assets: default room pictures, brand, legal
  scripts/         build helpers, performance budget
design-tokens/     CSS custom properties, the visual source of truth
website/           the project website (GitHub Pages root)
docs-site/         this wiki (Astro Starlight)
docs/              technical reference documents
hauser/            Home Assistant App manifest and documentation
container/         entrypoint and healthcheck
scripts/           build image, backup, restore, dev pilot, verifiers
dev/               synthetic Home Assistant for the dev pilot
tools/tunnel/      the remote-access sidecar (Go)
compose*.yaml      release, source-build and dev Compose files
```

## Which folder for which task

| Task | Look at |
|---|---|
| A new device type | `state/` for the projection, `components/DeviceDetail.svelte` and `DeviceTile.svelte`, the adapter's command mapping |
| A new screen | `screens/`, both shells, the navigation in the household configuration |
| A settings entry | `components/settings/`, `state/settings-registry.ts` |
| Translations | `messages/` |
| A server route | `server/`, `server/api-contract.mjs` |
| Container or App | `Dockerfile`, `container/`, `hauser/config.yaml`, `compose.yaml` |
