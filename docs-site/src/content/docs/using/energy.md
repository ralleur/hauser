---
title: Energy
description: Live load, solar and grid as notes pinned into a picture of your house.
sidebar:
  order: 13
---

The energy screen is a picture of a house. Live production, measured load and the grid sit as small paper notes in the picture, each pinned to the thing it measures. The free wall carries the day's figures.

![The energy screen: a house with solar panels, three notes pinned into the picture, today's figures top left, the day's curves along the bottom.](/hauser/media/energy-1100.webp)

## What it needs

Power sensors in Home Assistant. **Settings → Connections → Services → Energy** lists every power sensor Home Assistant reports: one source for generation, as many consumers as you like, or **Take all**. Without a saved selection Hauser uses everything it found.

## What it shows

- **Now:** live power. Several plugs are called *Measured devices*, not a house load.
- **Today, Week, Month, Total:** real sums from Home Assistant's long-term statistics. The day's curve comes from five-minute statistics.
- What the house cannot measure gets no note. No dashes, no zeros.

## Your own house

The [room-image wizard](/hauser/docs/using/room-images/) and the library offer **Outside (energy)** as a target. An image set assigned there becomes the stage of the energy screen, day and night. The wizard knows solar modules, so the generation note hangs on the real panels.

## The picture's menu

In edit mode, press and hold the background: create your own house with the wizard, pick a picture from the library, move the notes, or jump to the sensor assignment. Notes and their pins can be dragged. **Done** keeps the arrangement, **Reset** returns to the template.

## On the phone

The [phone](/hauser/docs/using/phone/) tells the story behind the numbers: power now, the period with a load curve and a comparison with yesterday, and a **Top consumers** list. The house picture lies pale behind the figures; the notes pinned into it stay on the wall panel.
