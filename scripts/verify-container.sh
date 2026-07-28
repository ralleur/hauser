#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

image_repository="${HAUSER_IMAGE_REPOSITORY:-hauser}"
image_tag="${1:-verify-pre-beta}"
image="${image_repository}:${image_tag}"
project="hauser-verify-$$"
tmp="$(mktemp -d)"
export COMPOSE_PROJECT_NAME="$project"
export HAUSER_IMAGE_REPOSITORY="$image_repository"
export HAUSER_IMAGE_TAG="$image_tag"
export HAUSER_BIND_ADDRESS=127.0.0.1
export HAUSER_PORT=0

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

docker image inspect "$image" >/dev/null

after_healthy() {
  local id status
  id="$(docker compose ps -q hauser)"
  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && return 0
    [[ "$status" == "exited" || "$status" == "dead" ]] && break
    sleep 1
  done
  docker compose ps >&2 || true
  docker compose logs --tail=100 hauser >&2 || true
  return 1
}

# Cycle 1: fresh volumes, hardening and readiness.
docker compose up -d --no-build
after_healthy
docker compose exec -T hauser node container/healthcheck.mjs
test "$(docker compose exec -T hauser id -u | tr -d '\r')" = "1000"
if docker compose exec -T hauser sh -c 'touch /opt/hauser/rootfs-must-be-read-only' 2>/dev/null; then
  printf '%s\n' 'Root filesystem unexpectedly writable.' >&2
  exit 1
fi
docker compose exec -T hauser sh -c '
  printf persistent-data > /data/verify-marker
  printf persistent-asset > /assets/verify-marker
  printf persistent-config > /config/verify-marker
'
config_hash_before="$(docker compose exec -T hauser sha256sum /config/household.json | cut -d' ' -f1)"

# Cycle 2: recreate the container without deleting volumes and prove persistence.
docker compose down
docker compose up -d --no-build
after_healthy
docker compose exec -T hauser sh -c '
  test "$(cat /data/verify-marker)" = persistent-data
  test "$(cat /assets/verify-marker)" = persistent-asset
  test "$(cat /config/verify-marker)" = persistent-config
'
config_hash_after="$(docker compose exec -T hauser sha256sum /config/household.json | cut -d' ' -f1)"
test "$config_hash_before" = "$config_hash_after"

# Backup and destructive restore remove post-backup state and preserve the snapshot.
backup="$tmp/hauser-backup.tar.gz"
./scripts/backup.sh "$backup"
after_healthy
docker compose exec -T hauser sh -c 'printf post-backup > /data/post-backup-marker'
./scripts/restore.sh --yes "$backup"
after_healthy
docker compose exec -T hauser sh -c '
  test "$(cat /data/verify-marker)" = persistent-data
  test "$(cat /assets/verify-marker)" = persistent-asset
  test "$(cat /config/verify-marker)" = persistent-config
  test ! -e /data/post-backup-marker
'

# A semantically invalid active config must terminate before listening.
printf '%s\n' '{"schemaVersion":1,"rooms":[]}' > "$tmp/invalid.json"
set +e
invalid_output="$(docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  --volume "$tmp/invalid.json:/config/household.json:ro" \
  "$image" 2>&1)"
invalid_status=$?
set -e
test "$invalid_status" -ne 0
printf '%s' "$invalid_output" | grep -q 'HOUSEHOLD_CONFIG_INVALID'

printf 'project=%s\nimage=%s\nconfig_hash=%s\ncycles=2\nbackup_restore=PASS\ninvalid_config=PASS\n' \
  "$project" "$image" "$config_hash_after"
