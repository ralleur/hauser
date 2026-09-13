---
title: Media
description: Room audio through Home Assistant players and a Jellyfin library.
sidebar:
  order: 18
---

Media has two parts. Both are off until you switch them on under **Settings → Connections → Services**.

## Room audio (experimental)

Home Assistant media players found during setup become playback targets. The Media screen shows what plays in which room, with pause, previous and next track, a source picker and presets. It is marked experimental and off by default. Targets found during setup stay in the configuration, so they are there the moment you enable it.

## Library (Jellyfin)

The Library screen shows continue watching, latest, series and movies from your Jellyfin server, with detail pages and playback in the browser. Progress is reported back, so you can resume on another device. See [Jellyfin](/hauser/docs/integrations/jellyfin/).

**Library mode** under **Settings → Content → Media & Music** is *Automatic* (follows the backend, so demo mode shows the demo library), *Live* or *Demo*. It takes effect after a reload. Media remembers on the phone whether you last opened room audio or the library.

## Removed

The song workshop (AI-generated songs) was removed in 0.7.0 because it did not come up in everyday use. Installations that still list it in their configuration start normally.
