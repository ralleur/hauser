---
title: Install with Docker Compose
description: For Home Assistant Container, NAS boxes and plain Docker hosts.
sidebar:
  order: 3
---

The release Compose file pulls the versioned image from GHCR and starts it with three persistent volumes.

## Prerequisites

- Docker Engine with Compose v2 (`docker compose`).
- Network access to `ghcr.io`.
- A reachable Home Assistant with a long-lived access token (created later, in the wizard).

## First start

```bash
git clone https://github.com/ralleur/hauser.git
cd hauser
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
docker compose exec hauser node container/healthcheck.mjs
```

Open `http://localhost:4173` and run the [setup wizard](/hauser/docs/getting-started/first-setup/).

:::tip[Make it reachable in your LAN]
The default bind is loopback only. To open it for panels and phones, set exact values in `.env`, then run `docker compose up -d` again:

```dotenv
HAUSER_BIND_ADDRESS=0.0.0.0
HAUSER_PORT=4173
HMI_ALLOWED_ORIGINS=http://localhost:4173,http://hauser-host.local:4173
```

Every browser origin that may operate Hauser must be listed in `HMI_ALLOWED_ORIGINS`.
:::

## What is persisted

| Volume | Content |
|---|---|
| `/config` | The active `household.json` and migration backups |
| `/data` | Home Assistant and Jellyfin settings, reminders, notification rules, room-image credentials, hotel-mode data |
| `/assets` | Room-image sets and the standby map |

The container runs read-only as the unprivileged `node` user with all capabilities dropped.

## Building from source

Only when you deliberately want the checked-out source instead of a release:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

## Health

```bash
curl -fsS http://localhost:4173/api/health
```

A fresh install answers `"status": "setup_required"`. After the wizard it answers `"status": "ready"`. See [API and health](/hauser/docs/reference/api/).

## Update, backup, rollback

See [Updates and backups](/hauser/docs/getting-started/updates-and-backups/). The complete operations contract is in [`docs/08-installation.md`](https://github.com/ralleur/hauser/blob/main/docs/08-installation.md).
