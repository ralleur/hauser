---
title: Jellyfin
description: Optional film and series library with playback.
sidebar:
  order: 2
---

Optional. Enable it in the setup wizard or later under **Settings → Connections → Services**.

## What it does

- Continue watching, latest, series and movies as shelves.
- Item, season and episode details with artwork.
- Playback in the browser: native HLS where available, `hls.js` elsewhere.
- Progress reports, so you can resume on another device.
- Audio track and subtitle language in the player.

## Setup

Address, user and password. The login creates a device identity for this browser. The token stays in the browser of that installation.

## Limits

Player volume control is planned. The browser talks to Jellyfin directly, so the Jellyfin address must be reachable from the panel and the phone.
