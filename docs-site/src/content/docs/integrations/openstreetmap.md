---
title: OpenStreetMap
description: The standby street map and the place search.
sidebar:
  order: 4
---

Optional, free, no account. The standby screen can show a faint street map of your own town behind the clock.

## How it works

1. The location comes from Home Assistant, from a one-off browser geolocation after a tap, from a place search, or typed coordinates. The place search runs on the server against OpenStreetMap's geocoder. What leaves the server is a search term.
2. When the location is set or you press **Regenerate**, the server sends **one** request to a public Overpass endpoint: a bounding box and a list of road types. Nothing on start, reload or standby.
3. The server renders a monochrome SVG of roads and stores it. The browser uses it as a mask, so light and dark share one file and the road colour follows the theme. Deep night shows no map.

## Switch

**Settings → Appearance → Ambient & standby → City map background**. The switch is per device. Setup offers the map as an opt-out with an example picture.

## Attribution

Map data © OpenStreetMap contributors, ODbL. Hauser shows that line on the standby screen whenever the map is visible.

## Storage

`ambient-map.json` and `assets/ambient-maps/` in the data volume. The public endpoint `/api/ambient-map` returns the asset URL and radius, never coordinates or a place name.
