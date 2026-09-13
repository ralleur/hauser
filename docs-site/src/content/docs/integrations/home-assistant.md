---
title: Home Assistant
description: Required. How Hauser reads state and sends commands.
sidebar:
  order: 1
---

Home Assistant is the one required service. Hauser uses the official WebSocket client for state, commands, reconnects and reconciliation.

## Two connection modes

| | Home Assistant App | Docker Compose |
|---|---|---|
| Mode | `supervisor` | `direct` |
| Who talks to Home Assistant | Only the Hauser server, through the Supervisor | The browser, straight to your Home Assistant URL |
| Token | Supervisor token, stays in the server process | Long-lived access token, entered in the wizard |
| URL to type | None | Yes |

In supervisor mode the browser speaks the familiar Home Assistant WebSocket contract to a same-origin gateway on the Hauser server, which forwards only an allow-list of message types. It is not an open bridge.

`GET /api/ha/connection` reports the active mode.

## What Hauser reads

Areas, devices and entities during setup. Entity state live. Calendars (`calendar.*`), to-do lists (`todo.*`), persons, `sun.sun` for day and night, the home location for weather and the map, five-minute and long-term statistics for energy, the logbook for notification history.

## What Hauser writes

Service calls for devices and scenes. To-do items. Automations built from Hauser blueprints for notifications. A `hauser_guest_checkout` event in hotel mode. Optionally a config flow for iCloud calendars or a Local To-do list, started from the settings.

Hauser never creates, renames or deletes Areas or entities.

## Connection behaviour

- Connecting has a 20-second limit, then the normal reconnect cycle.
- Returning from the background replaces a connection that only looks alive.
- Disconnected is shown as one word in the title bar. Controls dim. Nothing is faked.

## Renewing the token (Compose)

**Settings → Connections → Services → Renew access token**.
