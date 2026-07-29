# Installation and operation

Hauser is still in private pre-beta development. The container path described
here is built from a local checkout; there is no published registry image or
support promise yet. Its purpose is to make installation, persistence and
recovery reproducible before the public beta gate.

## Tested platform

The current path is qualified on Linux containers through Docker Desktop on
Apple Silicon. Other Docker Engine and CPU combinations are expected to work
because the pinned Node base is multi-architecture, but they are not yet part of
a tested support matrix.

Prerequisites:

- Docker Engine with Docker Compose v2 (`docker compose`) and Buildx;
- enough access to build an image from the checkout;
- a browser that can reach the published port;
- later, a reachable Home Assistant instance and a dedicated long-lived token.

## First start

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose exec hauser node container/healthcheck.mjs
```

Open <http://localhost:4173>. A fresh config volume starts the restricted setup
runtime. Enter a Home Assistant URL and long-lived token; Hauser verifies the
connection from both browser and server, reads the HA area/device/entity
registries, proposes rooms and relevant entities, validates the result and only
then activates `/config/household.json`. Before activation, room and entity names
can be corrected, entities can be omitted, and compatible entities can be moved
between rooms. Ambiguous singleton roles are not offered as invalid moves.

The default binding is deliberately loopback-only.
To make Hauser reachable on a trusted home LAN, set exact values in `.env`, for
example:

```dotenv
HAUSER_BIND_ADDRESS=0.0.0.0
HAUSER_PORT=4173
HMI_ALLOWED_ORIGINS=http://localhost:4173,http://hauser-host.local:4173
```

Do not expose this directly to the public internet. Put authentication and TLS
in front of it if traffic crosses an untrusted network.

## What the stack persists

Compose creates three project-scoped named volumes:

| Container path | Content | Backup requirement |
|---|---|---|
| `/config` | Active `household.json` (`schemaVersion: 1`) | Required |
| `/data` | Home Assistant/Jellyfin connection settings, shared household data and generated song catalogue/audio | Required; may contain credentials |
| `/assets` | User-owned assets reserved for installation-specific media | Required when used |

The image does not seed a household configuration. A missing
`/config/household.json` is the explicit first-run marker. The wizard writes the
file atomically with mode `0600`; later image updates do not overwrite it.

The root filesystem is read-only. The service runs as the unprivileged `node`
user, drops Linux capabilities, enables `no-new-privileges`, and can write only
to the three volumes and its temporary in-memory filesystem.

## Replace the household configuration manually

Export the current file, edit it using the contract in
[`07-configuration.md`](07-configuration.md), and copy it back:

```bash
docker compose cp hauser:/config/household.json ./household.json
# edit and review ./household.json
docker compose stop hauser
docker compose cp ./household.json hauser:/config/household.json
docker compose start hauser
docker compose ps
```

Startup validates the complete document with the same validator used by the
browser runtime. Invalid JSON or schema data makes the service fail closed; it
does not silently load another household. Inspect the exact first issue with:

```bash
docker compose logs --tail=100 hauser
```

The wizard stores the Home Assistant URL and token in `/data/config.json`, not
in the image or Git. Manual config replacement does not alter those credentials.
An active installation can reopen the guided editor from **System → Services →
Edit setup**. Opening or cancelling does not write anything; only a confirmed,
validated change atomically replaces `/config/household.json`.

## Health and startup errors

`GET /api/health` is the readiness contract used by Docker. A healthy response
is HTTP 200:

```json
{
  "ok": true,
  "status": "ready",
  "householdConfigMode": "active",
  "schemaVersion": 1
}
```

Readiness returns HTTP 503 with a stable code when the frontend bundle, active
configuration or writable runtime directories are invalid. A deliberately
missing active configuration is different: it returns HTTP 200 and keeps Docker
healthy while exposing only health, static setup assets and setup activation:

```json
{
  "ok": true,
  "status": "setup_required",
  "householdConfigMode": "active",
  "schemaVersion": null
}
```

All regular API and proxy paths return `503 SETUP_REQUIRED` in this state.
Relevant fail-closed codes are:

- `APP_BUNDLE_NOT_FOUND`
- `HOUSEHOLD_CONFIG_NOT_CONFIGURED`
- `HOUSEHOLD_CONFIG_INVALID_JSON`
- `HOUSEHOLD_CONFIG_INVALID`
- `RUNTIME_DIRECTORY_NOT_WRITABLE`

The Docker healthcheck calls this endpoint from inside the container; it does
not treat an open TCP port as sufficient.

## Versioned local images

A clean checkout can be built into a commit-bound local tag:

```bash
./scripts/build-image.sh
```

The script refuses a dirty tree and produces a tag such as
`hauser:sha-<12-character-commit>`, with the full revision stored as an OCI
label. It also normalizes build timestamps to the commit timestamp and disables
provenance metadata. Two clean no-cache builds from the same checkout therefore
produce the same image ID in the same BuildKit/platform environment. This is not
a claim that different CPU architectures share one image ID. Set the exact tag
in `.env` before starting it:

```dotenv
HAUSER_IMAGE_TAG=sha-<12-character-commit>
```

No pre-beta image is pushed to a public registry. Registry publication starts
only with the public beta gate.

## Backup

The backup helper stops Hauser briefly to get a coherent snapshot, archives all
three volumes plus image metadata, and restores the previous running state:

```bash
./scripts/backup.sh
# or choose the destination explicitly
./scripts/backup.sh backups/before-update.tar.gz
```

Treat the archive as a secret: `/data/config.json` can contain access tokens.
Store it with restricted permissions and encryption appropriate to your threat
model.

## Restore

Restore is intentionally explicit and destructive for the current volumes:

```bash
./scripts/restore.sh --yes backups/before-update.tar.gz
```

The helper rejects unsafe archive paths and archives without
`config/household.json`, stops the service, replaces all three volume contents,
and restarts only if the service had been running before the restore.

## Update

For a source-built pre-beta checkout:

```bash
./scripts/backup.sh backups/before-update.tar.gz
git pull --ff-only
docker compose build --pull=false
docker compose up -d
docker compose ps
docker compose exec hauser node container/healthcheck.mjs
```

The pinned base-image digest and `package-lock.json` prevent mutable dependency
resolution during that build. A source update can still intentionally change
either pin. Use `./scripts/build-image.sh` instead of `docker compose build` when
the exact commit-bound image identity matters.

## Rollback

Keep the previous commit-tagged image locally. To roll the application back
without rebuilding:

1. Put its previous `sha-...` tag in `.env`.
2. Run `docker compose up -d --no-build`.
3. Verify health and the core UI.
4. If the newer version changed persistent data incompatibly, restore the backup
   taken before the update.

There is no automatic schema migration yet. Until migrations exist, update and
rollback remain an operator-controlled transaction.

## Stop and remove

```bash
docker compose down
```

That removes containers and the network but keeps all volumes. The following is
destructive and deletes configuration, data and assets:

```bash
docker compose down -v
```
