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

## Agent access and tokens

An agent helping with setup needs its own authorized browser session or API
connection. This is separate from Hauser's connection. The Hauser App uses its
Supervisor connection automatically; never extract its internal token for an
agent. Compose uses a separate token entered privately in Hauser's wizard.

Before creating an agent token, check that the agent has a Home Assistant API
tool, secure credential input and network access to your installation. A token
alone supplies none of these. Without them, continue through the browser or
follow individual UI instructions from the agent. Do not paste a token into
ordinary chat.

### Create a temporary agent token

1. Choose a separate Home Assistant user for setup access where practical.
   Start without administrator access; grant it only when the agreed task
   requires it. A token inherits the user's permissions, rather than a custom
   per-token list of allowed devices. A non-administrator can still operate
   devices: this is real home access.
2. Sign in as that user. Open the profile from the user name/avatar, then
   **Security → Long-lived access tokens → Create token**. Name it
   `Temporary Hauser setup agent` so you can identify it later.
3. Copy the displayed value directly into the agent tool's secure credential
   field. The agent should explain the exact field available in its tool; this
   guide does not install a connector. Keep only the credential's label in the
   conversation. If no secure field exists, cancel this branch.
4. Use the tool for a read-only `GET /api/` with the trailing slash. Expect
   HTTP 200 and `{"message":"API running."}`. Report only the outcome. HTTP 401
   indicates an authentication problem; a timeout suggests reachability.
   Stop before sending device commands until this check succeeds.

Authentication uses the `Authorization: Bearer …` header, not a token in a URL.
See [Home Assistant authentication](https://contributors.home-assistant.io/core/internals/auth-api/)
and its [REST API](https://contributors.home-assistant.io/core/internals/rest-api/).
Core API access does not automatically authorize installing Apps through the
Supervisor; use the signed-in HA UI for that step if necessary.

### Remove setup access

Delete the temporary token from the same profile's Security page when setup
is finished, and remove its stored credential from the agent tool. If you
used browser access, sign out the setup session. Remove a temporary setup
user only if it is no longer needed. Verify that the former API connection
now fails authentication. Do not revoke the separate token used by Hauser on
Compose.

If a token was accidentally shared, revoke it first and create a replacement
only if needed. Deleting a chat message alone does not revoke access.

For the complete beginner workflow, use
[Set up with your AI agent](/hauser/docs/getting-started/agent-guided-setup/).
