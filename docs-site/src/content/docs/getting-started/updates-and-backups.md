---
title: Updates and backups
description: How to update, back up, restore and roll back.
sidebar:
  order: 6
---

## Home Assistant App

- **Update:** through Home Assistant's normal app update flow. Data is kept.
- **Backup:** create a Home Assistant backup that includes Hauser. The manifest declares a cold backup, so Home Assistant stops the App while it snapshots `/data`.
- **Restore:** through Home Assistant's backup UI. Then start Hauser, check the health endpoint and open the Web UI.

## Docker Compose

Back up first, then pull and recreate:

```bash
./scripts/backup.sh backups/before-update.tar.gz
git pull --ff-only
docker compose pull
docker compose up -d
docker compose ps
docker compose exec hauser node container/healthcheck.mjs
```

The backup script stops Hauser briefly, archives all three volumes plus image metadata and restarts if Hauser was running.

:::caution
Treat the archive as a secret. `/data/config.json` can contain access tokens.
:::

Restore is explicit and replaces the current volumes:

```bash
./scripts/restore.sh --yes backups/before-update.tar.gz
```

## Rollback

1. Put the previous image tag in `.env` (`HAUSER_IMAGE_TAG=v0.x.y`).
2. `docker compose up -d --no-build`
3. Check health and the core screens.
4. If the newer version changed the data format, restore the backup you took before the update.

## Configuration migrations

Hauser migrates the household configuration on start when the schema version changed. Before it replaces the file it writes the original next to it, for example `household.json.backup-v1-<timestamp>`. A failed migration keeps the old file and stops the server with a clear code, so it never starts half-migrated.

## In-app updates

The web app itself caches for offline start. When a new version is waiting, Hauser shows a quiet hint and applies it when you tap. A wall panel updates on its own while idle.
