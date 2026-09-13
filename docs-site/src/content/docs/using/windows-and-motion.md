---
title: Windows and motion
description: Contacts and detectors feed the status strip of every room.
sidebar:
  order: 10
---

Every room can show a status strip at the bottom right: windows open or closed, motion or presence. The values come live from Home Assistant.

## What feeds it

Window and door contacts and motion or presence detectors found during setup. **Settings → Home → Windows & motion → Choose sensors** shows one card per room and one switch per sensor. Everything found is on to begin with. A button returns a room to automatic assignment.

## What you see

- **All quiet** when nothing is open and nobody moves.
- Otherwise a summary. The strip is a button that opens a list with one line per sensor, its room and its state.
- Rooms without an assigned sensor keep the strip as a plain display.

## Related

- The same detectors can wake the panel from [standby](/hauser/docs/using/standby/).
- Rules for open windows or motion can become [notifications](/hauser/docs/using/notifications/).
