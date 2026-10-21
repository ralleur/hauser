---
title: Media
description: Room audio through Home Assistant players and a Jellyfin library.
sidebar:
  order: 18
---

Media has two parts. Both are off until you switch them on under **Settings → Connections → Services**.

## Room audio (experimental)

Home Assistant media players found during setup become playback targets. The Media screen shows what plays in which room, with pause, previous and next track, a source picker and presets. It is marked experimental and off by default. Targets found during setup stay in the configuration, so they are there the moment you enable it.

## Music Assistant

Install the Music Assistant server and add the **Music Assistant integration**
in Home Assistant. Installing only the server app does not expose its players
to Hauser. Enable the media module in Hauser as described above.

The web Media screen discovers Music Assistant players automatically. In the
native iPhone and iPad app, select **Music** in the media screen. Pick a player
to see the current title and artist, pause or resume, skip tracks and change
its volume if the player supplies a volume control.

Enter a track, album, artist or station name and select **Play**. Music
Assistant resolves the request using the music sources you configured there.
Provider URLs and Music Assistant library URIs can also be used. This first
integration starts playback by name or identifier; it does not include a
browsable library, search-result selection or a queue editor.

Music Assistant needs the Home Assistant connection. The Apple Home-only
mode has no Music Assistant server connection.

## Library (Jellyfin)

The Library screen shows continue watching, latest, series and movies from your Jellyfin server, with detail pages and playback in the browser. Progress is reported back, so you can resume on another device. See [Jellyfin](/docs/integrations/jellyfin/).

**Library mode** under **Settings → Content → Media & Music** is *Automatic* (follows the backend, so demo mode shows the demo library), *Live* or *Demo*. It takes effect after a reload. Media remembers on the phone whether you last opened room audio or the library.

## Removed

The song workshop (AI-generated songs) was removed in 0.7.0 because it did not come up in everyday use. Installations that still list it in their configuration start normally.
