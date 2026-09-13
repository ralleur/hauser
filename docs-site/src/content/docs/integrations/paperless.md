---
title: Paperless-ngx
description: Optional private documents behind a PIN.
sidebar:
  order: 7
---

Optional. The Hauser server bridges Paperless-ngx for the [Documents](/hauser/docs/using/documents/) screen.

## Setup

**Settings → Connections → Services → Private documents (Paperless)**: address and API token. The server picks them up on the next request.

The PIN that locks the screen is not a setting. The server reads it from the macOS keychain (service `smart-home-hmi.ablage`, account `pin`). The container image has no keychain, so the Documents screen is disabled in the App and in Compose today.

## Boundary

The API token and the PIN stay on the server. The browser gets a 15-minute HttpOnly session after the PIN. Only search, status, preview, download and import are proxied.
