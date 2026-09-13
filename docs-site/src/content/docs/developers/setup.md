---
title: Development setup
description: Run the app locally against simulated devices or a synthetic Home Assistant.
sidebar:
  order: 2
---

## Prerequisites

- Node.js 24 and npm
- Docker with Compose, only for the container paths

## Frontend against the fake backend

```bash
git clone https://github.com/ralleur/hauser.git
cd hauser/app
npm ci
npm run dev
```

This starts Vite with simulated devices. It is the fastest way to look around. The `predev` step generates the icon registry, phone hero variants and the compiled translations.

## Frontend plus the server

Build once, then run the server with an example household:

```bash
cd app
npm run build
HMI_HOUSEHOLD_CONFIG_PATH="$PWD/config/examples/neutral-small.json" \
HMI_HOUSEHOLD_CONFIG_MODE=active \
node server.mjs
```

Open `http://localhost:4173`.

## Synthetic Home Assistant (dev pilot)

For the complete install and first-run flow, the dev pilot starts a synthetic Home Assistant and a fresh Hauser in isolated containers:

```bash
./scripts/dev-pilot.sh up
./scripts/dev-pilot.sh status
./scripts/dev-pilot.sh down
./scripts/dev-pilot.sh reset --yes
```

See [`docs/09-dev-pilot.md`](https://github.com/ralleur/hauser/blob/main/docs/09-dev-pilot.md).

## Demo build

```bash
cd app
npm run build:demo
```

Produces a static bundle in `app/dist-demo/` with the fake backend and a permanent demo badge.

## Local container image

```bash
./scripts/build-image.sh
```

Refuses a dirty tree and produces `hauser:sha-<commit>`.
