---
title: Room pictures
description: Default illustrations, your own photos, and the wizard that draws your room.
sidebar:
  order: 20
---

Every room has a picture in three lighting states: day, evening and lights-off. The picture follows the sun and the lamps. There are three ways to get one.

## 1. Keep the defaults

Hauser ships illustrations drawn from a real household. Each room gets one by its name, in every supported language. They are of the author's home, so they will not match yours.

## 2. Upload your own

Open **Settings → Home → Rooms & devices**, tap the room's picture, then upload a JPEG, PNG, WebP or AVIF. Replace or remove it any time. Without your own picture the default returns.

## 3. Let the wizard draw it

The room-image wizard turns a phone photo of your room into an illustration in Hauser's style.

| | |
|---|---|
| ![An ordinary phone photo of a living room.](/hauser/media/wizard-input-raw-1100.webp) | ![The same room as a warm illustration.](/hauser/media/room-light-1100.webp) |
| **Input** – evening light, a wide lens, toys on the floor | **Output** – the same room |

How it works:

1. Open **Settings → Home → Rooms & devices → Create room images**, or the room's picture menu.
2. Pick the room, pick the photo, choose the crop and the focus point.
3. The first pass may correct perspective. After that the camera, the geometry and the object positions are frozen, so what comes back is still your room.
4. Day, evening and lights-off are generated as one set, plus an overcast variant for rainy days. A vision model notes the surfaces it sees (windows, floor, seats) so rain is drawn only inside the windows.
5. Review the set and publish it. Publishing is atomic. Phone-sized variants are derived automatically.

**Outside (energy)** is a target too: a photo of your house becomes the stage of the [energy screen](/hauser/docs/using/energy/).

:::caution[This is the one paid step]
The wizard needs your own OpenAI access, either an API key or a signed-in ChatGPT account. Your photo is sent there to be redrawn. Hauser says so before anything is uploaded, every paid step is confirmed by hand, and a running count of provider calls stays on screen. No other feature calls OpenAI. See [OpenAI](/hauser/docs/integrations/openai/).
:::

:::note[ChatGPT is an interim solution]
OpenAI is the only way the wizard draws today. It is a bridge, not the final answer.

- **iOS app:** a completely free way through Apple Intelligence is in development. No plan, no key, nothing to pay, on iPhones and iPads that support Apple Intelligence.
- **Web app and Home Assistant app:** support for local models and your own API keys for other providers is planned.

Neither is available yet. The default pictures and your own uploads are free today.
:::

## The library

Finished sets stay in the library under **Rooms & devices**. Assign a set to a room, switch between sets, delete old ones. A set assigned to a room takes effect immediately.

## Lamp placement

In the room editor you can place the room's lamps in the picture. Placed lamps light their cone when they are on and fade out slowly when they go off. When the last lamp goes out the picture dims into its unlit version.
