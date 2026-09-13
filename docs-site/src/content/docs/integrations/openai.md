---
title: OpenAI (room pictures)
description: Optional and the only paid third party. Used by the room-image wizard only.
sidebar:
  order: 3
---

OpenAI is inert until you supply your own access. Only the [room-image wizard](/hauser/docs/using/room-images/) uses it.

## Access

**Settings → Home → Rooms & devices → Create room images**, then either:

- an **API key** (`YOUR_API_KEY`), or
- a **ChatGPT sign-in** through the device flow.

Both stay on the server in `room-image-auth.json` inside the data volume. The browser never sees them. The status dot asks whether the sign-in still carries and says so if it does not.

## What is sent

The photo you picked, cropped as you chose, plus the prompt for the pass. Once per image set the wizard also asks a vision model for the surfaces it can see.

## Privacy

Your photograph leaves your house. Hauser states this before anything is uploaded, every paid step is confirmed by hand, and a count of provider calls is on screen. The hosted demo never calls the provider.

## Errors

An expired sign-in, an exhausted quota and a refused photo each get their own sentence with what to do next.
