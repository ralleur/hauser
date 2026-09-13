---
title: Troubleshooting
description: Symptoms, likely causes and what to check.
sidebar:
  order: 5
---

### Hauser does not start

- **Check:** `curl -fsS http://localhost:4173/api/health`, then `docker compose logs --tail=100 hauser` or the App log.
- **Configuration invalid or too new.** The log names a `HOUSEHOLD_CONFIG_*` code and the first issue. Restore the backup next to the file, or the previous image.
- **Directory not writable.** `RUNTIME_DIRECTORY_NOT_WRITABLE`. Check volume permissions. The App entrypoint creates the directories in `HMI_REQUIRED_WRITABLE_DIRS` itself.
- **Room-image job store refuses to load.** The server still starts. Health shows `selfCheck.roomImageJobStore`. The wizard is off until the named job is fixed.

### The page loads but nothing works

- The browser origin is not in `HMI_ALLOWED_ORIGINS` (Compose). Add the exact origin you use, including the port.
- You opened Hauser through a reverse proxy with another hostname in the App. Not supported there; use Compose.

### Home Assistant cannot be reached

- **Compose:** the URL must be reachable from the browser *and* from the container. `localhost` inside the container is the container itself.
- **Token rejected:** create a new long-lived token and use **Renew access token**.
- **Stuck on Connecting:** since 0.8.0 the handshake times out after 20 seconds and retries. Check `GET /api/ha/connection`.

### No devices or the wrong room

- Home Assistant Areas win. Unassigned entities are ignored while any Area exists. Assign them in Home Assistant, or add the device by hand under **Rooms & devices**.
- Use **Manage rooms** to move devices between rooms.

### Room pictures do not load

- A room without a picture shows how to get one. Upload or use the wizard.
- On very old CPUs the image library falls back to a portable build. Room images then still work; if they do not, check the log for `sharp`.
- The wizard shows a red status: the sign-in expired, the quota is used up or the photo was refused. Each has its own sentence.

### The layout looks wrong on the phone

- Add Hauser to the home screen for the standalone layout with safe areas.
- Check the browser's reduced-motion or zoom settings.

### The panel is dark or empty at night

- Deep night dims the screen between 22:00 and 06:00. Switch it under **Ambient & standby**.
- When every resident is away, standby goes dark if presence dimming is on.

### The clock or the weather stopped

- The weather keeps the last reading if Open-Meteo does not answer. The clock catches up when the panel becomes visible again. If it stays frozen, reload from **Maintenance → Reload app** and please [report it](https://github.com/ralleur/hauser/issues).

### Updates do not apply

- The web app offers a waiting update with a hint. Tap it, or reload. Wall panels update while idle.
- The App: check the manifest version matches a published image; the release gate refuses drift.

### Docker container keeps restarting

- Health fails closed. Read the first `HOUSEHOLD_CONFIG_*` or `RUNTIME_DIRECTORY_*` code in the log.

### Where to ask

Open an issue with the [bug report or installation report form](https://github.com/ralleur/hauser/issues/new/choose). English or German is fine.
