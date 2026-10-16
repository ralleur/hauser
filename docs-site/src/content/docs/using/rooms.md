---
title: Rooms
description: Where rooms come from and how you change them.
sidebar:
  order: 2
---

Rooms are the backbone of Hauser. Everything hangs on a room: its picture, its devices, its scenes, its sensors.

## Where rooms come from

The [setup wizard](/hauser/docs/getting-started/first-setup/) turns Home Assistant Areas into rooms. Hauser only reads Areas. It never renames or deletes them.

## Editing rooms

Open **Settings → Home → Rooms & devices**. Every room shows its picture, its devices and a quick-setup grid.

| Task | How |
|---|---|
| Rename or reorder rooms, add or delete rooms | **Manage rooms** opens the guided editor. Reordering is a six-dot drag handle. |
| Add a device | Tap **Add device** in a room, or use the empty-room hint. Tap into the search field for type pills (Light, Switch, Climate, Sensor, Media, ...) or type a name. |
| Hide or rename a device, change its icon | Long-press the device tile, then open its settings. |
| Choose what lights the room's bulb | Open the device's settings and use **Counts for the room light indicator**. See [The lightbulb indicator](#the-lightbulb-indicator). |
| Change the room picture | Tap the picture. See [Room pictures](/hauser/docs/using/room-images/). |
| Edit scenes | See [Scenes](/hauser/docs/using/scenes/). |
| Place lamps in the picture | The lamp-placement editor shows your own room picture. Placed lamps light their cone when they are on. |

Unfinished room edits survive leaving the section. A restored draft is marked and can be discarded on purpose.

## What a room shows

- **On the panel:** the stage picture, scenes and device tiles in the control surface, the room's climate tile, the windows and motion strip.
- **On the phone:** a room card with picture, name and light status. A tap opens a full-height room sheet. Swipe down closes it.

## The lightbulb indicator

The bulb on a room tile, the light count on the phone card and the lights count in the iOS widgets only count devices that are marked as lights. Smart plugs, configuration switches, blinds and vacuums can be listed and controlled in a room without lighting the bulb.

- **New setups:** the setup wizard marks lights as counting and switches, covers and vacuums as not counting.
- **Existing setups:** nothing changes by itself. Until you set a device explicitly, a room counts what it counted before.
- **Change it per device:** open the device's settings and switch **Counts for the room light indicator** on or off. A smart plug that powers a lamp can count; an open blind does not have to. The choice is stored with the shared device settings, so every panel and phone sees it.

- **Change a whole room at once:** in the room editor (**Settings → Home → Rooms & devices**, then open the room), the **Room light indicator** row has two buttons. **Count only lights** marks every light as counting and every switch, cover and vacuum as not counting. **Count everything** marks all of them as counting. Both overwrite earlier per-device choices of that room, save once, and can be followed by single-device changes.

The setting does not hide or disable the device. It only decides whether the device counts for the bulb.

## Room pictures follow the room

A room has three lighting states: day, evening and lights-off. When the last lamp goes out, the picture dims into its unlit version. Rain and snow show in the windows when the picture set has an overcast variant. See [Room pictures](/hauser/docs/using/room-images/).

## Advanced room settings

A room's tile can show its current temperature and other status lines. The thermostat tile can show target, current or both. These live in the room's settings in **Rooms & devices** and in the tile's long-press settings.
