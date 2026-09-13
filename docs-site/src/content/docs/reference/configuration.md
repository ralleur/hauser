---
title: Configuration reference
description: Environment variables, files, ports and paths.
sidebar:
  order: 1
---

Most settings live in the interface. This page lists what is set at deployment level. Replace secrets with placeholders such as `YOUR_API_KEY`; never commit them.

## Compose `.env`

| Setting | Required | Default | Description |
|---|---|---|---|
| `HAUSER_IMAGE_REPOSITORY` | no | `ghcr.io/ralleur/hauser` | Image to pull |
| `HAUSER_IMAGE_TAG` | no | the release pinned in `compose.yaml` | Version tag, or a local `sha-...` tag |
| `HAUSER_BIND_ADDRESS` | no | `127.0.0.1` | Host address to bind. `0.0.0.0` for the LAN. |
| `HAUSER_PORT` | no | `4173` | Host port |
| `HMI_ALLOWED_ORIGINS` | yes for LAN | `http://localhost:4173,http://127.0.0.1:4173` | Every browser origin that may operate Hauser |

## Server environment

Set by the Compose file or the App manifest. You rarely change them.

| Variable | Default | Description |
|---|---|---|
| `HMI_PORT` | `4173` | Port inside the container |
| `HMI_HOST` | `0.0.0.0` | Bind address inside the container |
| `HMI_HA_CONNECTION_MODE` | `direct` | `direct` (browser to Home Assistant) or `supervisor` (App) |
| `HMI_ALLOWED_ORIGINS` | | Allowed browser origins |
| `HMI_HOUSEHOLD_CONFIG_PATH` | | Path to `household.json` |
| `HMI_HOUSEHOLD_CONFIG_MODE` | | `active` (public path) or `shadow` (migration tool) |
| `HMI_CONFIG_PATH` | | Shared settings and, in direct mode, the Home Assistant URL and token |
| `HMI_FAMILY_DATA_PATH` | | Reminders and people |
| `HMI_NOTIFICATION_RULES_PATH` | next to config | Notification rules |
| `HMI_MOMENTS_STATE_PATH` | next to config | Which moments were already shown |
| `HMI_PAIRING_DEVICES_PATH` | next to config | Hashed device tokens |
| `HMI_ROOM_IMAGE_ASSET_ROOT` | `/assets` | Published room-image sets |
| `HMI_ROOM_IMAGE_CREDENTIAL_PATH` | | OpenAI access for the wizard |
| `HMI_ROOM_IMAGE_AUTH_MODE` | `direct` | Same-origin boundary for room-image uploads |
| `HMI_ROOM_IMAGE_VISION_MODEL` | | Override the vision model used for surfaces |
| `HMI_OPENAI_API_KEY` | | API key from the environment instead of the settings |
| `HMI_AMBIENT_MAP_CONFIG_PATH` | `/data/ambient-map.json` | Map location and asset reference |
| `HMI_AMBIENT_MAP_ASSET_ROOT` | `/assets/ambient-maps` | Rendered map SVGs |
| `HMI_HOTEL_MODE_DATA_PATH` | unset | Hotel-mode data with the PIN verifier |
| `HMI_PAPERLESS_HOST`, `HMI_PAPERLESS_PORT` | `127.0.0.1`, `8000` | Fallback Paperless address; the settings override it |
| `HMI_REQUIRED_WRITABLE_DIRS` | | Directories the entrypoint creates and hands to the runtime user |
| `HMI_REVISION`, `HMI_SOURCE_URL` | baked into the image | Commit and source link shown under License and source |
| `HMI_TUNNEL_BIN`, `HMI_TUNNEL_STATE`, `HMI_REMOTE_URL` | | See [Remote access](/hauser/docs/integrations/remote-access/) |
| `HMI_AI_CUSTOMIZING_ENABLED` | `0` in every public deployment | The author's private code-modifying agent. Not part of the product. |

## Files in the volumes

| File | Where | Content |
|---|---|---|
| `household.json` | `/config` (Compose), `/data` (App) | Rooms, devices, modules, sensors. Versioned, validated, migrated. |
| `household.json.backup-v*-*` | same | Originals kept by migrations |
| `config.json` | `/data` | Shared settings, Jellyfin and (direct mode) Home Assistant credentials. Mode `0600`. |
| `family-data.json` | `/data` | Reminders and people |
| `room-image-auth.json` | `/data` | OpenAI access for the wizard |
| `hotel-mode.json` | `/data` | Hotel-mode state and PIN verifier |
| `ambient-map.json` | `/data` | Map location |
| `assets/` | `/assets` or `/data/assets` | Room-image sets, maps |

## Ports

| Port | What |
|---|---|
| `4173` | Hauser web interface and API |
| `4174` (loopback) | Control interface of the remote-access sidecar |

## Per-device settings

Stored in the browser, not on the server: appearance state, standby delay, city map switch, edit or use mode with its PIN, phone bar order, rooms per row, control-surface widths.
