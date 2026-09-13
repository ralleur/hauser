---
title: Companion app pairing
description: Pair a phone with a one-time QR code. Experimental.
sidebar:
  order: 8
---

Experimental. The System screen shows a one-time pairing code as a QR code. A paired phone gets its own device token. Only the hash is stored on the server.

- The code lives five minutes and is only shown on a panel in the LAN, so showing it proves presence.
- A device token replaces the browser-origin check for that device and is required over [remote access](/hauser/docs/integrations/remote-access/).
- Someone who opened Hauser in the phone's browser gets **Open in the app on this device** instead of a code to scan.

The companion app itself is a separate project and not part of the Hauser release.
