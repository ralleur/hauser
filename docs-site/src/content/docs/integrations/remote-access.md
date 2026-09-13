---
title: Remote access
description: Reach Hauser from outside through Tailscale. Experimental.
sidebar:
  order: 9
---

Experimental. Hauser can publish itself through Tailscale Funnel, so paired phones reach it from anywhere without port forwarding.

## How it works

- The image ships a small sidecar (`hauser-tunnel`). It joins your tailnet as a userspace node and publishes Hauser as `https://<hostname>.<tailnet>.ts.net`.
- Every forwarded request is marked as remote. The Hauser server then requires a device token from [pairing](/hauser/docs/integrations/companion-app/). Without a token only health and build info answer.
- The panel and the LAN keep working as before if the sidecar is missing.

## Setup

**Settings → Connections → Services → Remote access**:

1. **Sign in to Tailscale** with Google, Apple, Microsoft or GitHub. Open the link or scan the QR code.
2. Approve HTTPS certificates and Funnel once in the Tailscale console. Hauser keeps retrying.
3. The card shows **Active at ...** with the address.

**Own address** replaces the tunnel in the pairing code if Hauser is already reachable through your own reverse proxy.

## Environment

| Variable | Purpose |
|---|---|
| `HMI_TUNNEL_BIN` | Path to the sidecar binary. Set in the image. |
| `HMI_TUNNEL_STATE` | State directory. Default `tunnel/` next to `config.json`. |
| `HMI_REMOTE_URL` | Your own public address instead of the tunnel. |
