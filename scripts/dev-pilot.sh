#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose -f "$root/compose.dev.yaml")
command="${1:-status}"
shift || true

find_host_address() {
  if [[ -n "${HAUSER_DEV_HOST_ADDRESS:-}" ]]; then
    printf '%s\n' "$HAUSER_DEV_HOST_ADDRESS"
    return
  fi
  if command -v ipconfig >/dev/null 2>&1; then
    local interface address
    interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    address="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    if [[ -n "$address" ]]; then
      printf '%s\n' "$address"
      return
    fi
  fi
  if command -v hostname >/dev/null 2>&1; then
    local address
    address="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [[ -n "$address" ]]; then
      printf '%s\n' "$address"
      return
    fi
  fi
  printf '%s\n' 'No LAN address found. Set HAUSER_DEV_HOST_ADDRESS explicitly.' >&2
  exit 2
}

export HAUSER_DEV_HOST_ADDRESS="$(find_host_address)"
export HAUSER_DEV_HA_PORT="${HAUSER_DEV_HA_PORT:-18123}"
export HAUSER_DEV_APP_PORT="${HAUSER_DEV_APP_PORT:-14173}"
export HAUSER_DEV_APP_BIND_ADDRESS="${HAUSER_DEV_APP_BIND_ADDRESS:-127.0.0.1}"

ha_url="http://${HAUSER_DEV_HOST_ADDRESS}:${HAUSER_DEV_HA_PORT}"
if [[ "$HAUSER_DEV_APP_BIND_ADDRESS" == "127.0.0.1" ]]; then
  app_url="http://localhost:${HAUSER_DEV_APP_PORT}"
else
  app_url="http://${HAUSER_DEV_HOST_ADDRESS}:${HAUSER_DEV_APP_PORT}"
fi

wait_for_url() {
  local name="$1" url="$2" attempts="$3"
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error --max-time 3 "$url" >/dev/null 2>&1; then
      printf '%s ready: %s\n' "$name" "$url"
      return 0
    fi
    sleep 2
  done
  printf '%s did not become ready: %s\n' "$name" "$url" >&2
  "${compose[@]}" ps >&2 || true
  return 1
}

print_urls() {
  cat <<EOF
Home Assistant: $ha_url
Hauser:         $app_url
Wizard HA URL: $ha_url
EOF
}

case "$command" in
  up)
    "${compose[@]}" up -d --build
    wait_for_url 'Home Assistant' "$ha_url/manifest.json" 90
    wait_for_url 'Hauser' "$app_url/api/health" 90
    print_urls
    ;;
  status)
    "${compose[@]}" ps
    printf '\n'
    print_urls
    printf '\nHauser health:\n'
    curl --fail --silent --show-error --max-time 3 "$app_url/api/health" || true
    printf '\n'
    ;;
  logs)
    "${compose[@]}" logs --tail="${HAUSER_DEV_LOG_LINES:-200}" "$@"
    ;;
  down)
    "${compose[@]}" down
    ;;
  reset)
    if [[ "${1:-}" != "--yes" ]]; then
      printf '%s\n' 'This deletes only the hauser-dev Home Assistant, Hauser config, data and asset volumes.' >&2
      printf '%s\n' 'Run: scripts/dev-pilot.sh reset --yes' >&2
      exit 2
    fi
    "${compose[@]}" down -v --remove-orphans
    printf '%s\n' 'The isolated hauser-dev stack and all of its volumes were removed.'
    ;;
  urls)
    print_urls
    ;;
  *)
    printf 'Usage: %s {up|status|logs [service]|down|reset --yes|urls}\n' "$0" >&2
    exit 2
    ;;
esac
