---
title: Features
description: Everything Hauser can do today, one line each, with its status.
sidebar:
  order: 3
---

Status words follow the [roadmap](https://github.com/ralleur/hauser/blob/main/ROADMAP.md): **Live** runs daily in the author's home, **Built** works but is less exercised, **Experimental** is off by default or needs extra pieces.

## Rooms and control

| Feature | Idea | Status |
|---|---|---|
| [Home screen](/hauser/docs/using/home-screen/) | One room picture plus its controls. Or all rooms as tiles. | Live |
| [Rooms](/hauser/docs/using/rooms/) | Rooms come from Home Assistant Areas. Rename, reorder, add devices in the app. | Live |
| [Devices](/hauser/docs/using/devices/) | Lights, switches, climate, fans, blinds, sensors, locks, vacuums and more. Each has a second level with everything it supports. | Live |
| [Scenes](/hauser/docs/using/scenes/) | Bright, Cozy and Off per room, plus your own. Import scenes from Home Assistant. | Live |
| [Climate](/hauser/docs/using/climate/) | Room thermostat as a tile, one central control for the whole house. | Live |
| [Room pictures](/hauser/docs/using/room-images/) | Every room has a picture in three lighting states. Upload your own or let the wizard draw one from a photo. | Live / Built |
| Undo instead of confirm | After "everything off" or a scene, a five-second Undo toast. | Live |

## Everyday screens

| Feature | Idea | Status |
|---|---|---|
| [Standby](/hauser/docs/using/standby/) | Clock, week strip, notes and shopping list when the panel rests. Optional street map and weather. | Live |
| [Calendar](/hauser/docs/using/calendar/) | Home Assistant calendars as one sheet of paper. | Built |
| [Shopping list](/hauser/docs/using/shopping-list/) | Home Assistant to-do lists, one per shop. Notion as an alternative. | Built |
| [Reminders and notes](/hauser/docs/using/reminders-and-notes/) | Sticky notes per person on a pinboard. | Built |
| [Energy](/hauser/docs/using/energy/) | Live load, solar and grid as notes pinned into a picture of your house. | Live |
| [Notifications](/hauser/docs/using/notifications/) | Rules you configure, Home Assistant does the waiting. Laundry has a guided setup. | Built |
| [Windows and motion](/hauser/docs/using/windows-and-motion/) | Contacts and detectors feed a status strip per room. | Built |
| [Presence and moments](/hauser/docs/using/presence-and-moments/) | Greet the first person home, birthdays with confetti, the first snow. | Built |
| [Cameras](/hauser/docs/using/cameras/) | Live HLS streams with still images as fallback, movable pop-outs. | Built |
| [Media](/hauser/docs/using/media/) | Room audio through Home Assistant players, Jellyfin library with playback. | Live (Jellyfin), Experimental (room audio) |
| [Documents](/hauser/docs/using/documents/) | PIN-gated Paperless-ngx search, preview and import. | Built, disabled in the container (PIN needs a host keychain) |

## Interface

| Feature | Idea | Status |
|---|---|---|
| [Phone layout](/hauser/docs/using/phone/) | A one-handed layout with a floating bottom bar, not a squeezed panel. | Live |
| [Appearance](/hauser/docs/using/appearance/) | Follows the sun by default. Five explicit states. Glass or standard cards. | Live |
| [Edit and use mode](/hauser/docs/using/edit-and-use-mode/) | Lock configuration on a panel, optionally behind a PIN. | Built |
| [Languages](/hauser/docs/using/languages/) | German, English, French, Italian, Portuguese, Polish. | Built |
| [Hotel mode](/hauser/docs/using/hotel-mode/) | A panel as a guest surface for one holiday apartment. | Experimental |
| [Say something](/hauser/docs/reference/faq/#how-do-i-report-a-problem-or-make-a-suggestion) | The question mark in the title bar sends a problem or a wish to the author, no account needed. | Live |

## Installation

| Feature | Idea | Status |
|---|---|---|
| [Home Assistant App](/hauser/docs/getting-started/home-assistant-app/) | Install from the app store, no token, no URL. | Live |
| [Docker Compose](/hauser/docs/getting-started/docker-compose/) | Versioned image, three volumes, backup and restore scripts. | Built |
| [Setup wizard](/hauser/docs/getting-started/first-setup/) | Discovers Areas and entities, proposes rooms, activates a validated configuration. | Live |
| [Companion app pairing](/hauser/docs/integrations/companion-app/) | Pair a phone with a QR code. The app itself is a separate project. | Experimental |
| [Remote access](/hauser/docs/integrations/remote-access/) | Reach Hauser from outside through Tailscale, only for paired devices. | Experimental |

## Not planned

A Lovelace card version, cloud accounts, telemetry, and paid tiers. See the [roadmap](https://github.com/ralleur/hauser/blob/main/ROADMAP.md#not-planned).
