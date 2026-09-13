---
title: Documents
description: Private documents from Paperless-ngx behind a PIN.
sidebar:
  order: 19
---

The Files screen searches your Paperless-ngx archive, shows previews, downloads documents and imports new ones. It is optional.

## Access

The screen is locked with a PIN. The Hauser server checks the PIN and keeps an HttpOnly session for 15 minutes. The Paperless token never reaches the browser.

## Setup

**Settings → Connections → Services → Private documents (Paperless)** takes the address and the API token. The server picks them up on the next request. See [Paperless-ngx](/hauser/docs/integrations/paperless/).

:::caution[Limited in the container]
The PIN is read from the macOS keychain of the machine running the server, not from the settings. The container image has no keychain, so in the Home Assistant App and in Docker Compose the Documents screen stays disabled today. It works on a developer machine with a keychain entry.
:::

## Not in the demo

Private documents do not belong in a public static demo, so the demo hides this screen.
