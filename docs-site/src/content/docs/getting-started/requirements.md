---
title: Choose your setup
description: What you need for Apple Home on iOS, or for a Hauser installation connected to Home Assistant.
sidebar:
  label: Choose your setup
  order: 1
---

Start with the system that already knows your rooms and devices. Apple Home
uses the native iOS app. Home Assistant uses a Hauser server, with a web
interface and optional pairing to the native app.

## Apple Home

You need an **iPhone or iPad with iOS 17 or newer**, a configured Apple Home,
and access to the Hauser beta through **TestFlight**. Grant Hauser permission
to read and control your home. Home Assistant and a Hauser server are not
required.

[Open the iOS setup guide](/hauser/docs/integrations/companion-app/#apple-home).
Apple Intelligence features have additional device and OS requirements; they
are optional and are not needed to operate your rooms.

## Home Assistant

You need a working Home Assistant installation, somewhere to run Hauser, and
a current browser on a device that can reach it.

| Where Home Assistant runs | Install Hauser with |
| --- | --- |
| Home Assistant OS or Supervised | [The Home Assistant App](/hauser/docs/getting-started/home-assistant-app/) — the connection is automatic, with no token to create. |
| Home Assistant Container, a NAS or another Docker host | [Docker Compose](/hauser/docs/getting-started/docker-compose/) — the wizard asks for your Home Assistant URL and a long-lived access token. |

Both server packages support `amd64` and `aarch64`. After installation, the
[setup wizard](/hauser/docs/getting-started/first-setup/) discovers your devices.
**Assigning them to Home Assistant Areas first** gives the clearest starting
point. You can review and arrange the proposed rooms before activating them.

For the native iOS app, install the server first and then
[pair by QR code](/hauser/docs/integrations/companion-app/#pairing-with-a-qr-code).

## Optional services

None of these is required to switch a light or open a room. Enable only the
services you want to use; their availability also depends on your platform.

| Service | What it adds | What to know |
| --- | --- | --- |
| [Jellyfin](/hauser/docs/integrations/jellyfin/) | Film and series library | A reachable Jellyfin server and your login. |
| [Paperless-ngx](/hauser/docs/integrations/paperless/) | Private documents | Optional bridge with extra host requirements; see its guide before installing. |
| [Notion](/hauser/docs/integrations/notion/) | Alternative shopping-list source | An external cloud service with its own account and integration token. |
| [Room-image providers](/hauser/docs/using/room-images/) | Illustrations from your photos | Your own provider access; selected photos are processed externally. Costs and limits depend on the provider. |
| [Weather](/hauser/docs/integrations/open-meteo/) and [street map](/hauser/docs/integrations/openstreetmap/) | Weather information and an optional standby map | Requests to external public-data services, without a Hauser account. |

You can keep the supplied illustrations or upload existing pictures without
connecting an image provider.

## Network rules

The Hauser server is designed for a **trusted home network**. Its web port has
no separate login: devices that can reach it can operate the home. Do not
forward the port through your router. Read the
[remote-access guide](/hauser/docs/integrations/remote-access/) for the separate,
paired-device path.

## Before you begin

Hauser is in public beta. Read the [release notes](https://github.com/ralleur/hauser/releases)
for your server version and the [TestFlight notes](/hauser/docs/integrations/companion-app/)
for the native app. Keep a backup before updating an existing installation.
