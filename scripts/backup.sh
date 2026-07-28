#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

archive="${1:-backups/hauser-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}"
mkdir -p "$(dirname "$archive")"
archive="$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")"

container="$(docker compose ps -a -q hauser)"
if [[ -z "$container" ]]; then
  printf '%s\n' 'Hauser container does not exist. Start the stack once before backing it up.' >&2
  exit 2
fi

was_running="$(docker inspect --format '{{.State.Running}}' "$container")"
tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
  if [[ "$was_running" == "true" ]]; then docker compose start hauser >/dev/null; fi
}
trap cleanup EXIT

if [[ "$was_running" == "true" ]]; then docker compose stop hauser >/dev/null; fi
mkdir -p "$tmp/config" "$tmp/data" "$tmp/assets"
docker cp "$container:/config/." "$tmp/config/"
docker cp "$container:/data/." "$tmp/data/"
docker cp "$container:/assets/." "$tmp/assets/"
{
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'image=%s\n' "$(docker inspect --format '{{.Config.Image}}' "$container")"
  printf 'image_id=%s\n' "$(docker inspect --format '{{.Image}}' "$container")"
} > "$tmp/manifest.txt"
tar -C "$tmp" -czf "$archive" config data assets manifest.txt
printf 'backup=%s\n' "$archive"
