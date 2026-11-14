---
title: API and health
description: The endpoints an operator needs.
sidebar:
  order: 3
---

The Hauser server has an explicit HTTP contract with about 80 routes. Most are internal to the app. These are the ones you may call yourself.

## Health

```bash
curl -fsS http://localhost:4173/api/health
```

| Status | Meaning |
|---|---|
| `ready` | Configuration valid, serving |
| `setup_required` | Fresh install, wizard pending. Still HTTP 200 so Docker stays healthy. |
| HTTP 503 with a code | Fail-closed: bundle missing, configuration invalid, directory not writable |

Codes include `APP_BUNDLE_NOT_FOUND`, `HOUSEHOLD_CONFIG_INVALID`, `HOUSEHOLD_CONFIG_VERSION_TOO_NEW`, `HOUSEHOLD_CONFIG_MIGRATION_*` and `RUNTIME_DIRECTORY_NOT_WRITABLE`. The payload also carries a `selfCheck` block, for example when the room-image job store refused to load.

## Build info

```bash
curl -fsS http://localhost:4173/api/build-info
```

Version, full commit revision and the source link. Also shown under **Settings → Status & Updates → License and source**. No authentication, as the AGPL asks.

## Connection mode

```bash
curl -fsS http://localhost:4173/api/ha/connection
```

Reports `mode: supervisor` in the App and `mode: direct` on Compose.

## Everything else

The contract lives in [`app/server/api-contract.mjs`](https://github.com/ralleur/hauser/blob/main/app/server/api-contract.mjs). Read routes answer repeated requests with `304` through ETags. Requests are checked for an allowed browser origin or a device token.

## Android WebView session

Since 0.50.3, `POST /api/pairing/web-session` accepts an existing paired-device Bearer token and returns protocol version 1 plus a host-only HttpOnly SameSite=Strict cookie. HTTPS responses mark it Secure. This does not create a device or extend its lifetime. Subsequent HTTP and WebSocket requests authenticate the same revocable token. Cookie-authenticated writes and upgrades require the exact effective Origin; cross-site cookie requests are rejected. Health alone does not prove the live Home Assistant socket works.
