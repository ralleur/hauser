---
title: Cameras
description: Live streams in a room and as movable pop-outs.
sidebar:
  order: 17
---

A camera assigned to a room shows its picture on a tile.

- **Live** streams use HLS through Home Assistant, as in the Home Assistant app. A still image is the fallback.
- **Long press** opens a movable pop-out that floats over any screen.
- Pictures pass through the Hauser server, so panels and phones without mDNS reach them too.
- For generic cameras whose stream Home Assistant serves through ffmpeg, the tile reloads the still picture and retries after an error rather than staying blank.

The demo shows no camera tile without a camera image.
