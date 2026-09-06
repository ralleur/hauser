#!/usr/bin/env bash
# Upgrade smoke test: previous release -> this build, on the same volumes.
#
# The container contract (scripts/verify-container.sh) proves that a *single*
# image keeps its data across restarts. This script proves the step that
# actually happens to a household: the version they run today is replaced by
# the version we ship, and nothing of theirs disappears.
#
#   ./scripts/upgrade-smoke.sh <new-tag> [previous-image]
#
# The previous image defaults to $HAUSER_PREVIOUS_IMAGE, otherwise to the
# published image of the latest release tag reachable from HEAD. Without a
# previous release the script exits 0 and says so — the first release has
# nothing to upgrade from.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

image_repository="${HAUSER_IMAGE_REPOSITORY:-hauser}"
new_tag="${1:-verify-pre-beta}"
new_image="${image_repository}:${new_tag}"

previous_image="${2:-${HAUSER_PREVIOUS_IMAGE:-}}"
if [[ -z "$previous_image" ]]; then
  previous_tag="$(git describe --tags --abbrev=0 --match 'v*' HEAD 2>/dev/null || true)"
  if [[ -n "$previous_tag" ]]; then
    previous_image="ghcr.io/${GITHUB_REPOSITORY:-ralleur/hauser}:${previous_tag#v}"
  fi
fi

if [[ -z "$previous_image" ]]; then
  printf '%s\n' 'No previous release found; nothing to upgrade from. Skipping.'
  exit 0
fi

docker image inspect "$new_image" >/dev/null

if ! docker image inspect "$previous_image" >/dev/null 2>&1; then
  if ! docker pull "$previous_image" >/dev/null 2>&1; then
    printf 'Previous image %s is not available; skipping upgrade smoke.\n' "$previous_image"
    exit 0
  fi
fi

project="hauser-upgrade-$$"
tmp="$(mktemp -d)"
export COMPOSE_PROJECT_NAME="$project"
export HAUSER_BIND_ADDRESS=127.0.0.1
export HAUSER_PORT=0

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

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

start_with() {
  export HAUSER_IMAGE_REPOSITORY="${1%%:*}"
  export HAUSER_IMAGE_TAG="${1##*:}"
  docker compose up -d --no-build
  after_healthy
}

health_field() {
  docker compose exec -T hauser node -e "
    fetch('http://127.0.0.1:4173/api/health')
      .then((response) => response.json())
      .then((health) => { process.stdout.write(String(health[process.argv[1]])); });
  " "$1" | tr -d '\r'
}

# ── 1. The household as it exists today, on the previous release ─────────────
start_with "$previous_image"

node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync("app/config/examples/neutral-small.json", "utf8"));
  fs.writeFileSync(process.argv[1], `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
' "$tmp/household.json"
docker compose cp "$tmp/household.json" hauser:/config/household.json >/dev/null
docker compose restart hauser >/dev/null
after_healthy

docker compose exec -T hauser sh -c '
  printf upgrade-data > /data/upgrade-marker
  printf upgrade-asset > /assets/upgrade-marker
  printf upgrade-config > /config/upgrade-marker
'
before_version="$(health_field schemaVersion)"
before_config="$(docker compose exec -T hauser sha256sum /config/household.json | cut -d' ' -f1)"

# ── 2. Replace the image, keep the volumes ───────────────────────────────────
docker compose down
start_with "$new_image"

status="$(health_field status)"
if [[ "$status" != "ready" ]]; then
  printf 'Upgraded container is not ready: %s\n' "$status" >&2
  exit 1
fi

docker compose exec -T hauser sh -c '
  test "$(cat /data/upgrade-marker)" = upgrade-data
  test "$(cat /assets/upgrade-marker)" = upgrade-asset
  test "$(cat /config/upgrade-marker)" = upgrade-config
'

after_version="$(health_field schemaVersion)"
after_config="$(docker compose exec -T hauser sha256sum /config/household.json | cut -d' ' -f1)"
if [[ "$before_config" != "$after_config" ]]; then
  # A migration is allowed to rewrite the config — but only with a backup next to it.
  docker compose exec -T hauser sh -c 'set -- /config/household.json.backup-v*; test -f "$1"'
  printf 'Household config migrated (schema %s -> %s), backup present.\n' "$before_version" "$after_version"
fi

printf 'upgrade-smoke: %s -> %s ok (schema %s -> %s)\n' \
  "$previous_image" "$new_image" "$before_version" "$after_version"
