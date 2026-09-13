---
title: Scenes
description: Built-in scenes per room, your own scenes, and importing from Home Assistant.
sidebar:
  order: 4
---

Every room has three built-in scenes:

- **Bright.** Dimmable lights at full brightness, everything else switched on.
- **Cozy.** The same lights dimmed to 20 %.
- **Off.** Turns off every device it contains.

The active scene is highlighted when the room actually matches it.

## Your own scenes

Long-press a scene in edit mode to open the scene editor.

- **Add new scene** creates a room scene. Add lights and switches with the search, set brightness and colour temperature per device.
- **From Home Assistant** lists your existing Home Assistant scenes, the room's own first. Hauser applies the scene once in the room to read back the states, then stores them as a Hauser scene.
- Changes are applied live in the room while you edit. Closing restores the previous state.
- **Reset to default** returns the built-in scenes to their defaults.

## Undo instead of confirm

Applying a scene or **Everything off** goes out immediately. A five-second toast offers **Undo**. There is no confirmation dialog by default. **Confirmation for "Off"** in the appearance settings adds one if you want it.

## Scenes and scripts from Home Assistant

Scenes and scripts assigned to a room during setup appear as scene tiles and run in Home Assistant. A Home Assistant Area that only has a scene still becomes a room.
