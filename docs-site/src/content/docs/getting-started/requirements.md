---
title: Requirements
description: What you need before installing Hauser.
sidebar:
  order: 1
---

## You need

- **Home Assistant.** Hauser reads rooms, devices and calendars from it and sends every command through it. Without Home Assistant there is nothing to show.
- **A place to run the Hauser server.** Either Home Assistant OS (as an App) or a Docker host.
- **A browser** on a tablet, wall panel or phone in the same network.

## Nice to have

- **Areas in Home Assistant.** The setup wizard turns Areas into rooms. Without Areas it infers rooms from entity names, but Areas give better results.
- **A phone camera.** The room-image wizard starts from a photo of your room. This is optional.

## Optional services

| Service | Used for | Required? |
|---|---|---|
| Jellyfin | Film and series library | No |
| Paperless-ngx | Private documents behind a PIN | No |
| Notion | Shopping list outside Home Assistant | No |
| OpenAI (API key or ChatGPT account) | Room pictures drawn from your photos | No, and the only paid service |

Everything else, including weather and the standby street map, uses free public data and needs no account.

## Network rules

Hauser is designed for a trusted home LAN. The published port has no login. Keep it inside the house, or use [Remote access](/hauser/docs/integrations/remote-access/), which only lets paired devices through.
