---
title: Room pictures
description: Default illustrations, your own photos, the wizard that draws your room — with ChatGPT, a free Cloudflare account or by hand.
sidebar:
  order: 20
---

Every room has a picture in three lighting states: day, evening and lights-off. The picture follows the sun and the lamps. There are four ways to get one.

## 1. Keep the defaults

Hauser ships illustrations drawn from a real household. Each room gets one by its name, in every supported language. They are of the author's home, so they will not match yours.

## 2. Upload your own

Open **Settings → Home → Rooms & devices**, tap the room's picture, then upload a JPEG, PNG, WebP or AVIF. Evening and lights-off are derived from it, darkened, so the photo follows the day instead of staying bright at night. Replace or remove it any time. Without your own picture the default returns.

## 3. Let the wizard draw it

The room-image wizard turns a phone photo of your room into an illustration in Hauser's style. The first time, it asks one question at a time instead of showing four options:

1. **Do you have a ChatGPT plan?** Sign in with the device code, or store your own OpenAI key. ChatGPT draws day, evening and night and finds the windows by itself — the most convenient way, and the only paid one.
2. **Do you have a Cloudflare account?** Cloudflare gives every account a daily allowance of its Workers AI — a good sixty room pictures a day, no plan, no card. Enter the account ID and an API token with the *Workers AI* template; both stay on the server. Hauser derives evening and night from the day picture, and you mark the windows yourself.
3. **Otherwise you draw it yourself** — see way 4.

The way you chose stays until you change it in the wizard's header.

| | |
|---|---|
| ![An ordinary phone photo of a living room.](/hauser/media/wizard-input-raw-1100.webp) | ![The same room as a warm illustration.](/hauser/media/room-light-1100.webp) |
| **Input** – evening light, a wide lens, toys on the floor | **Output** – the same room |

How it works:

1. Open **Settings → Home → Rooms & devices → Create room images**, or the room's picture menu.
2. Pick the room, pick the photo, choose the crop and the focus point.
3. The first pass may correct perspective. After that the camera, the geometry and the object positions are frozen, so what comes back is still your room.
4. Day, evening and lights-off are generated as one set, plus an overcast variant for rainy days. With OpenAI, a vision model notes the surfaces it sees (windows, floor, seats) so rain is drawn only inside the windows; with Cloudflare, evening and night are darkened from the day picture and the windows are marked by hand.
5. Review the set and publish it. Publishing is atomic. Phone-sized variants are derived automatically.

**Outside (energy)** is a target too: a photo of your house becomes the stage of the [energy screen](/hauser/docs/using/energy/).

## 4. Draw it yourself

Free, anywhere, with whatever image service you already use. Choose **you draw it yourself** in the wizard, and it becomes a small workbench for the room: one card per version — day, evening with lights, night without lights, overcast — each saying whether a picture is there, only derived (the darkened day picture) or missing. Each card has three steps:

1. **Input picture** — for the day: your room photo. For the others: the day picture from Hauser, downloaded with one tap.
2. **Wording** — copy it. It is the wizard's own wording, one per version; paste it together with the input picture into Gemini, ChatGPT, Bing or any other service that redraws pictures.
3. **Finished picture** — upload it. Evening and night can be derived from the day picture again, an overcast picture can be removed.

Below the cards, **Windows**: drag a rectangle over each pane, and rain and snow are drawn only there. That works for every set, including the ones Cloudflare drew.

:::caution[Only ChatGPT is a paid step]
The ChatGPT way needs your own OpenAI access, either an API key or a signed-in ChatGPT account, and your photo is sent there to be redrawn. Hauser says so before anything is uploaded, every paid step is confirmed by hand, and a running count of provider calls stays on screen. No other feature calls OpenAI. See [OpenAI](/hauser/docs/integrations/openai/). The Cloudflare way sends the photo to Cloudflare's Workers AI within your own free allowance; drawing it yourself sends nothing anywhere Hauser can see.
:::

:::note[The iOS app]
The [iOS app](/hauser/docs/integrations/companion-app/) has the same four ways, plus an experimental fifth on iOS 27: Apple draws the day picture through Apple Intelligence, free within the daily limit of your iCloud account.
:::

## The library

Finished sets stay in the library under **Rooms & devices**. Assign a set to a room, switch between sets, delete old ones. A set assigned to a room takes effect immediately.

## Lamp placement

In the room editor you can place the room's lamps in the picture. Placed lamps light their cone when they are on and fade out slowly when they go off. When the last lamp goes out the picture dims into its unlit version.
