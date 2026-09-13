---
title: Supported platforms
description: Where Hauser runs and which devices can show it.
sidebar:
  order: 4
---

## Where the server runs

| Platform | Path | Notes |
|---|---|---|
| Home Assistant OS or Supervised | [Home Assistant App](/hauser/docs/getting-started/home-assistant-app/) | Recommended. `amd64` and `aarch64`. |
| Home Assistant Container | [Docker Compose](/hauser/docs/getting-started/docker-compose/) | Container has no app store. |
| NAS or any Docker host | [Docker Compose](/hauser/docs/getting-started/docker-compose/) | Confirmed on an Asustor NAS (Linux, x86_64). |

The image is multi-architecture. Older x86 CPUs without SSE4.2 work too: the image library falls back to a portable build.

## What shows the interface

Hauser is a web app. Any current browser can open it. In practice it is made for:

- **Wall panels and tablets** in landscape. Run the browser in kiosk or full-screen mode.
- **Phones** as a home-screen app. Add it to the home screen and it runs standalone, with safe areas and the phone layout.

Room pictures are delivered in AVIF, with JPEG for devices that cannot decode AVIF.

## Network

Hauser is meant for a trusted home network. The published port has no login of its own. Do not forward it to the internet. For access from outside, see [Remote access](/hauser/docs/integrations/remote-access/).
