---
title: First setup
description: What the setup wizard does on the first start.
sidebar:
  order: 4
---

On first start Hauser opens a guided wizard. It ends with a validated household configuration. Nothing is written until you confirm the last step.

## The steps

1. **Language.** Choose the interface language. You can change it later.
2. **Home Assistant.**
   - As a Home Assistant App this step asks for nothing. The connection is automatic.
   - With Docker Compose, enter the Home Assistant URL and a long-lived access token. Hauser tests the connection from the browser and from the server.
3. **Discovery.** Hauser reads Areas, devices and entities and proposes rooms.
4. **Review.** Rename rooms, reorder them, delete empty ones, move devices between rooms, or leave devices out. Hauser never changes anything in Home Assistant.
5. **Jellyfin.** Enable it with address and login, or skip it.
6. **Activate.** The configuration is validated and written atomically. Then the wizard shows the address for phones and tablets with a QR code.

## What gets discovered

Lights, switches, climate, fans, covers (blinds, shutters, awnings), sensors, window and motion contacts, media players, cameras, scenes and scripts. A Home Assistant Area becomes a room even if only a scene points to it.

:::tip[Areas first]
If Home Assistant has Areas, unassigned entities are ignored on purpose. Assign entities to Areas in Home Assistant before you scan, or add them later in **Settings → Rooms & devices**.
:::

## Changing things later

Everything from the wizard can be changed under **Settings → Home → Rooms & devices**, including **Manage rooms**, which reopens the guided editor. Opening or cancelling it writes nothing.

## Where the result lives

The wizard writes `household.json` into the config volume (`/config` on Compose, `/data` in the App). Credentials go into a separate `config.json` and never into the household file. See [Household configuration](/hauser/docs/reference/household-config/).
