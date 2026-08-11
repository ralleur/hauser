# Installation and operation

The currently installable release is `v0.4.0-beta.3`, using
`ghcr.io/ralleur/hauser:v0.4.0-beta.3`. Its Home Assistant App package and both
release image tags are published for the focused real-HAOS smoke. An explicit
source-build overlay remains available for development and source-level
verification. No path comes with a support promise.

## Tested platform

The current path is qualified on Linux containers through Docker Desktop on
Apple Silicon. Other Docker Engine and CPU combinations are expected to work
because the pinned Node base is multi-architecture, but they are not yet part of
a tested support matrix.

Prerequisites:

- Docker Engine with Docker Compose v2 (`docker compose`);
- network access to GHCR, or Buildx when deliberately building from source;
- a browser that can reach the published port;
- later, a reachable Home Assistant instance and a dedicated long-lived token.

## First start

The pull-based commands below are for the published `v0.4.0-beta.3` checkout and
its immutable image.

```bash
git clone --branch v0.4.0-beta.3 https://github.com/ralleur/hauser.git
cd hauser
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
docker compose exec hauser node container/healthcheck.mjs
```

When deliberately building the checked-out source instead of pulling a release,
use the explicit override:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Open <http://localhost:4173>. A fresh config volume starts the restricted setup
runtime. Enter a Home Assistant URL and long-lived token; Hauser verifies the
connection from both browser and server, reads the HA area/device/entity
registries, proposes rooms and relevant entities, validates the result and only
then activates `/config/household.json`. Before activation, rooms can be created,
renamed, reordered and deliberately deleted. Deleting a populated room requires
moving its compatible entities and room references to another room or explicitly
omitting them from Hauser. Entity names can be corrected, individual entities can
be omitted, and compatible entities can be moved between rooms. These edits affect
Hauser's configuration only — the wizard never creates, renames or deletes Home
Assistant Areas. Ambiguous singleton roles are not offered as invalid moves.

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

## Setup and entity troubleshooting

### Token rejected

Home Assistant HTTP 401 or 403 means that HA rejected the token. Create or
replace a dedicated, valid Long-Lived Access Token in the Home Assistant profile
and retry setup. Never log the token or copy it into Git, an issue or support
text.

### HA unreachable from the Hauser container/server

Setup checks Home Assistant reachability from the browser during discovery and
from the Hauser server/container during activation; both paths must succeed.
Inside the container, `localhost` names the Hauser container, not automatically
the Home Assistant host. Check the configured URL, DNS or host address, port,
container network and firewall, and TLS. Do not work around the failure by
disabling TLS verification or authentication.

### Unexpected HTTP/proxy response

Home Assistant or an upstream reverse proxy responded, but not successfully.
Check the Home Assistant base URL, proxy routing and returned HTTP status; treat
401 and 403 as the token problem above. Do not copy a raw response or secret
headers into public error or support text.

### Origin rejected

`HMI_ALLOWED_ORIGINS` must contain the exact browser origins in
`scheme://host[:port]` format, separated by commas. Do not use paths or bare
hostnames. After changing `.env`, recreate the service with
`docker compose up -d --force-recreate hauser`. Do not bypass origin enforcement
with `*` or by disabling the check.

### Configured entity removed or unavailable

Hauser keeps the last known value only as context, marks the entity unavailable
and blocks actions for it. Open **System/Settings → Home → Rooms & devices** and
use the secondary **Reload from Home Assistant** / **Reload rooms and devices**
path at the bottom. Review the resulting assignments, then use **Save changes**
to validate and activate them. Do not keep trying to toggle or otherwise control
the unavailable entity.

## What the stack persists

Compose creates three project-scoped named volumes:

| Container path | Content | Backup requirement |
|---|---|---|
| `/config` | Active `household.json` (`schemaVersion: 2`) plus migration backups | Required |
| `/data` | Home Assistant/Jellyfin connection settings, shared household data and generated song catalogue/audio | Required; may contain credentials |
| `/assets` | User-owned assets reserved for installation-specific media | Required when used |

The image does not seed a household configuration. A missing
`/config/household.json` is the explicit first-run marker. The wizard writes the
file atomically with mode `0600`; later image updates do not overwrite it.

The root filesystem is read-only. The service runs as the unprivileged `node`
user, drops Linux capabilities, enables `no-new-privileges`, and can write only
to the three volumes and its temporary in-memory filesystem.

## Automatic configuration migration

On active startup, Hauser reads the schema version before exposing productive
APIs. A deployed v1 document is migrated deterministically to v2. Before the
atomic replacement, the exact original bytes are written with mode `0600` next
to the active file, for example:

```text
/config/household.json.backup-v1-20260729T094500000Z
```

The migrated document must pass the current parser and productive runtime
projection before any backup or replacement is written. Unsupported old versions,
future versions, invalid migrated data, a failed backup or a failed final rename
keep the original activation marker unchanged. The production process exits with a
non-zero status and a stable `HOUSEHOLD_CONFIG_*` log code before opening its
listener, so the orchestrator cannot route productive traffic to a partially
migrated installation.

To roll back the document after an upgrade, stop the service and copy the selected
backup over the active file. The old application image must be restored as well
when it does not support the newer schema:

```bash
docker compose stop hauser
docker compose run --rm --no-deps --entrypoint sh hauser -c \
  'ls -1 /config/household.json.backup-*'
docker compose run --rm --no-deps --entrypoint sh hauser -c \
  'cp /config/household.json.backup-v1-<timestamp> /config/household.json && chmod 600 /config/household.json'
docker compose start hauser
```

Replace `<timestamp>` with an actual backup name listed from the protected config
volume. Do not guess it, and preserve the complete `/config` volume backup before
a destructive restore.

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
  "schemaVersion": 2
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
- `HOUSEHOLD_CONFIG_VERSION_INVALID`
- `HOUSEHOLD_CONFIG_VERSION_UNSUPPORTED`
- `HOUSEHOLD_CONFIG_VERSION_TOO_NEW`
- `HOUSEHOLD_CONFIG_MIGRATION_INVALID`
- `HOUSEHOLD_CONFIG_MIGRATION_BACKUP_FAILED`
- `HOUSEHOLD_CONFIG_MIGRATION_WRITE_FAILED`
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

Registry publication is controlled by the tag-gated release workflow. It
requires the Git tag,
`app/package.json`, `app/package-lock.json`, the Docker image version and dated
changelog entry to agree before it can publish a multi-architecture image.

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

For the currently published `v0.4.0-beta.3`, keep that exact version in `.env`
and pull before recreating the service:

```bash
./scripts/backup.sh backups/before-update.tar.gz
git pull --ff-only
docker compose pull
docker compose up -d
docker compose ps
docker compose exec hauser node container/healthcheck.mjs
```

For a source build, use `docker compose -f compose.yaml -f compose.build.yaml
build --pull=false` and start with the same two-file Compose command. The pinned
base-image digest and `package-lock.json` prevent mutable dependency resolution
during that build. A source update can still intentionally change either pin.
Use `./scripts/build-image.sh` when the exact commit-bound local image identity
matters.

## Rollback

Keep the previous immutable release reference or commit-tagged local image. To
roll the application back without rebuilding:

1. Put its previous `sha-...` tag in `.env`.
2. Run `docker compose up -d --no-build`.
3. Verify health and the core UI.
4. If the newer version changed persistent data incompatibly, restore the backup
   taken before the update.

Automatic configuration migration currently covers schema v1 to v2. Image
update and rollback nevertheless remain an operator-controlled transaction:
take a backup first, keep the previous immutable image reference, and restore
both image and data when reverting across an incompatible schema change.

## Stop and remove

```bash
docker compose down
```

That removes containers and the network but keeps all volumes. The following is
destructive and deletes configuration, data and assets:

```bash
docker compose down -v
```
