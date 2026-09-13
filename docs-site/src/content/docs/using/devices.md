---
title: Devices
description: Which device types Hauser shows and what each one can do.
sidebar:
  order: 3
---

A device is a Home Assistant entity in a room. A tap does the obvious thing. A long press opens the second level with everything the device supports. What Home Assistant does not report, Hauser does not show.

## Supported types

| Type | Tap | Long press |
|---|---|---|
| Light | On or off | Brightness, colour temperature or colour where supported. The symbol carries the brightness in its colour. |
| Switch, plug | On or off | Details |
| Climate | Opens the thermostat sheet | Current, setpoint with minus and plus, every mode the device reports, fan, preset and swing. See [Climate](/hauser/docs/using/climate/). |
| Fan | On or off | Speed as a tick scale, presets (breeze, sleep, turbo, ...), oscillation, direction. The symbol turns while the fan runs. |
| Cover (blind, shutter, awning, valve) | Opens the sheet | Open, stop, close, position ladder, tilt |
| Vacuum | Start or pause | Return to dock, suction level |
| Lock | Lock or unlock | Open the door |
| Humidifier, water heater | On or off | Target and operating mode |
| Lawn mower | Mow or pause | Dock |
| Alarm panel | Arm or disarm | Asks for a code only when the device needs one |
| Number, select, button | Set, choose, press | |
| Sensor | Shows the value | Details. A sensor without a symbol picks one from its device class, unit or name. |
| Binary sensor (window, door, motion) | Feeds the [windows and motion](/hauser/docs/using/windows-and-motion/) strip | |
| Camera | Shows the live picture | Movable pop-out. See [Cameras](/hauser/docs/using/cameras/). |
| Media player | Room audio. See [Media](/hauser/docs/using/media/). | |
| Scene, script | Runs it | See [Scenes](/hauser/docs/using/scenes/). |

## Instant feedback

Tap a light and it turns on at once. The command travels afterwards. If Home Assistant answers with a different state, the control animates back. A switch that gets no echo within a second pulses once.

## Sensor tiles

A sensor tile shows only its reading, not its name. The device sheet has a switch **Name on the tile** for the cases where the name matters.

## Managing devices

Add, hide, rename, assign to a room and reorder devices under **Settings → Home → Rooms & devices**. Long device names shrink to fit instead of being cut off.

## Vacuum note

The vacuum path follows Home Assistant's documented service set and has not been verified on real hardware yet.
