---
title: Install as a Home Assistant App
description: The short path on Home Assistant OS and Supervised installations.
sidebar:
  order: 2
---

This is the recommended way. The App talks to Home Assistant by itself, so there is no URL to type and no token to create.

:::note
Apps (add-ons) need Home Assistant OS or a Supervised installation. Home Assistant Container has no app store. Use [Docker Compose](/hauser/docs/getting-started/docker-compose/) there.
:::

## Steps

1. In Home Assistant open **Settings → Apps → App Store → Repositories** and add:
   ```text
   https://github.com/ralleur/hauser
   ```
   Or use the button on the [project website](https://ralleur.github.io/hauser/#install).
2. Select **Hauser**, choose **Install**, then **Start**.
3. Choose **Open Web UI** and run the [setup wizard](/hauser/docs/getting-started/first-setup/).
4. At the end the wizard shows the address for phones and tablets, with a QR code.

## What the App does

- Declares `homeassistant_api` and talks to Home Assistant Core through the Supervisor. The token stays in the server process. It is never written to disk or sent to the browser.
- Publishes port `4173` directly on the host. It does **not** use Ingress, so a wall panel loads Hauser alone, without the Home Assistant frame.
- Keeps all state in `/data`, so Home Assistant backups include Hauser.
- Supports `amd64` and `aarch64`.

## Updates

Updates arrive through the normal Home Assistant app update flow. The changelog shipped with the App tells you what changed. Data is kept.

## Security boundary

The published port has **no separate login**. Every device on your network that can reach it can operate Hauser. Keep it on a trusted network and do not forward it through your router. The App has no configuration options, so a reverse proxy with another hostname is not supported here. Use Docker Compose if you need to set your own origins.

## Full packaging details

The add-on documentation in the repository covers persistence, health, backups and limits in full: [`hauser/DOCS.md`](https://github.com/ralleur/hauser/blob/main/hauser/DOCS.md).
