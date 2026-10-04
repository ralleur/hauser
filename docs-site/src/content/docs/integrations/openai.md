---
title: OpenAI (room pictures)
description: Connect your own OpenAI access for room illustrations, with external photo processing and provider usage limits.
sidebar:
  order: 3
---

OpenAI is one optional provider for the [room-image wizard](/hauser/docs/using/room-images/).
It is not needed for everyday control. Hauser only uses it after you connect
your own access and choose that provider. Your access plan, costs and usage
limits are set by OpenAI; Hauser’s call count is not a billing estimate.

The wizard can also use Cloudflare, accept pictures made in another service,
or keep your uploaded and bundled images. Compare these paths in the
[room-picture guide](/hauser/docs/using/room-images/).

## Access

**Settings → Home → Rooms & devices → Create room images**, then either:

- an **API key** (`YOUR_API_KEY`), or
- a **ChatGPT sign-in** through the device flow.

Both stay on the server in `room-image-auth.json` inside the data volume, the same file that holds a Cloudflare account ID and token if you chose that way instead. The browser never sees them. The status dot asks whether the sign-in still carries and says so if it does not.

## What is sent

The photo you picked, cropped as you chose, plus the prompt for the pass. Once per image set the wizard also asks a vision model for the surfaces it can see.

## Privacy

Your photograph leaves your house. Hauser states this before anything is uploaded, every paid step is confirmed by hand, and a count of provider calls is on screen. The hosted demo never calls the provider.

## Errors

An expired sign-in, an exhausted quota and a refused photo each get their own sentence with what to do next.
