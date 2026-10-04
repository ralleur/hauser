---
title: Supported platforms
description: Choose the native iOS app or a self-hosted Hauser server, and see where each runs.
sidebar:
  order: 4
---

Hauser has a web interface for Home Assistant and a native iOS app. The native
app can use Apple Home directly or pair with a Hauser server. Choose the
connection first, then the device you want to use.

## Native iPhone and iPad app

| Connection | What you need |
| --- | --- |
| **Apple Home** | iOS 17 or newer, your configured Apple Home and permission to access it. No Hauser server. |
| **Home Assistant** | iOS 17 or newer and a Hauser server installed using one of the paths below. Pair the app by QR code. |

The native app is available through [TestFlight](/hauser/docs/integrations/companion-app/).
iPhone uses a room grid and room controls; iPad uses the panel layout. Optional
Apple Intelligence features need additional hardware and OS support.

## Where the server runs

| Platform | Installation | Architecture |
| --- | --- | --- |
| Home Assistant OS or Supervised | [Home Assistant App](/hauser/docs/getting-started/home-assistant-app/) | `amd64`, `aarch64` |
| Home Assistant Container | [Docker Compose](/hauser/docs/getting-started/docker-compose/) | `amd64`, `aarch64` |
| NAS or another Docker host | [Docker Compose](/hauser/docs/getting-started/docker-compose/) | `amd64`, `aarch64` |

Both packages use the same Hauser server and guided setup. Home Assistant
Container has no App store, so it needs the Compose path.

## What shows the web interface

- **Wall panels and tablets:** a current browser, usually in full-screen or kiosk mode.
- **Phones:** open the server address in a browser, or add it to the home screen for the web app layout.
- **Desktop browsers:** useful for initial setup and arranging rooms.

See [Phones and panels](/hauser/docs/getting-started/phones-and-panels/) for the
steps. Room pictures have fallback formats for devices that cannot decode AVIF.

## Network

The server’s web port has no separate login and belongs on a trusted home
network. Do not forward it to the internet. The
[remote-access guide](/hauser/docs/integrations/remote-access/) covers the
separate path for paired devices.
