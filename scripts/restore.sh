#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" != "--yes" || -z "${2:-}" ]]; then
  printf 'Usage: %s --yes BACKUP.tar.gz\n' "$0" >&2
  exit 2
fi
archive="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
[[ -f "$archive" ]] || { printf 'Backup not found: %s\n' "$archive" >&2; exit 2; }
if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  printf '%s\n' 'Refusing unsafe archive paths.' >&2
  exit 2
fi

container="$(docker compose ps -a -q hauser)"
if [[ -z "$container" ]]; then
  printf '%s\n' 'Hauser container does not exist. Start the stack once before restoring.' >&2
  exit 2
fi

was_running="$(docker inspect --format '{{.State.Running}}' "$container")"
restart_on_error() {
  code=$?
  if [[ "$code" -ne 0 && "$was_running" == "true" ]]; then docker compose start hauser >/dev/null || true; fi
  exit "$code"
}
trap restart_on_error EXIT

if ! tar -tzf "$archive" | grep -qx 'config/household.json'; then
  printf '%s\n' 'Backup has no config/household.json.' >&2
  exit 2
fi

docker compose stop hauser >/dev/null
docker compose run --rm --no-deps -T \
  --entrypoint sh hauser -c '
    find /config /data /assets -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar -xzf - -C / config data assets
  ' < "$archive" >/dev/null

trap - EXIT
if [[ "$was_running" == "true" ]]; then docker compose start hauser >/dev/null; fi
printf 'restored=%s\n' "$archive"
