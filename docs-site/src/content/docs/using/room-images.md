---
title: Room pictures
description: Use the bundled illustrations, upload your own pictures, or turn a room photo into an illustration with an optional provider.
sidebar:
  order: 20
---

A picture makes a room recognisable before you read its name. Hauser uses
prepared day, evening and lights-off versions, selected according to the sun
and the room’s lighting state. These are variants of the same room, not a live
camera view.

## Choose how to make yours

<dl class="guide-options not-content">
  <div><dt>Keep the defaults</dt><dd>Nothing extra to connect. The illustrations come bundled with Hauser.</dd></div>
  <div><dt>Upload a picture</dt><dd>Use your own JPEG, PNG, WebP or AVIF. Hauser stores it on your server and derives the darker variants locally.</dd></div>
  <div><dt>OpenAI</dt><dd>Connect your own API or ChatGPT access. Your selected photo and prompts go to OpenAI; provider charges or plan limits apply.</dd></div>
  <div><dt>Cloudflare Workers AI</dt><dd>Connect your Cloudflare account and API token. Cloudflare processes the photo under its own allowance and limits; Hauser derives darker variants locally.</dd></div>
  <div><dt>A service you choose</dt><dd>Take the wizard’s prompt to an image service you use, then upload the finished versions. That service determines the cost and where processing happens.</dd></div>
</dl>

Hauser does not charge for the wizard. It cannot promise that a provider is
free, available or included in your existing plan. Generation is optional;
everyday room control works without it. The hosted demo does not generate
pictures.

## 1. Keep the defaults

The bundled illustrations come from the maker’s home. Hauser selects a default
for each room by name. You can replace it later or restore it after removing
a custom picture.

## 2. Upload your own

Open **Settings → Home → Rooms & devices**, tap the room’s picture and upload
a JPEG, PNG, WebP or AVIF. Hauser derives darker evening and lights-off
versions plus a locally muted overcast version, without an AI call. Missing
overcast versions of older uploads are filled in after an update; supplied
versions are preserved. An upload does not recreate the room or find its windows; use the
editor if you want to mark window areas for weather effects.

## Adjust an existing picture

Open the room’s picture settings. Once a custom picture is assigned, the
overview shows its preview and creation method, followed by **Windows** and
the lighting variants. Mark or adjust the windows here, without reopening
the wizard. Draw a rectangle over each pane, then drag its corners to fit
slanted or perspective windows. Existing polygon markings keep their shape.
Tap inside a marking to remove it. On a phone, draw directly on the image.

For uploaded pictures, replace individual variants or derive them again from
the day picture, including **Overcast**. The local overcast version mutes the
colours and brightness; it does not redraw sunlight or shadows already in the
illustration. For manually created pictures, the prompts are available
with each variant. Generated sets show their available versions. Older
pictures without a recorded method use a general source label.

Use **Change method** to choose another creation path. The choices to upload,
use the library or open the wizard remain below the current picture under
**Use a different picture**. If no custom picture is assigned, these choices form
the initial setup instead.

The native iOS app offers the same overview. Changes to Home Assistant room
pictures are saved to the shared server; Apple Home pictures stay on the device.

## 3. Let the wizard draw it

The wizard turns a selected photo into an illustration in Hauser’s style.
The example below is the existing source photo and the illustration used for
the demo living room. Generated results need your review.

<div class="guide-comparison">
  <figure><a href="https://ralleur.github.io/hauser/media/wizard-input-raw-1100.webp"><img src="/hauser/media/wizard-input-raw-1100.webp" width="1100" height="825" loading="lazy" decoding="async" alt="The original living-room photo, with a sofa, dining table, balcony door and toys." /></a><figcaption>Source photo · the maker’s living room.</figcaption></figure>
  <figure><a href="https://ralleur.github.io/hauser/media/room-light-1100.webp"><img src="/hauser/media/room-light-1100.webp" width="1100" height="778" loading="lazy" decoding="async" alt="The same living room as Hauser’s bundled illustration, retaining the sofa, table and balcony door." /></a><figcaption>The illustration used in Hauser. Select either image to enlarge.</figcaption></figure>
</div>

1. Open **Settings → Home → Rooms & devices → Create room images**, or the
   room’s picture menu.
2. Choose a provider and connect your own access. The wizard guides this one
   choice at a time; you can change it later in the header.
3. Select the room and photo, then choose the crop and focus point.
4. Create and review the variants. OpenAI generates the lighting variants and
   analyses visible surfaces. With Cloudflare, Hauser derives darker variants
   from the day image; you mark the windows yourself.
5. Publish the reviewed set. Hauser activates it together and derives the
   smaller phone images.

An overcast variant can support rainy-day scenes. **Outside (energy)** is
also a target: a house picture becomes the stage of the
[energy screen](/hauser/docs/using/energy/).

:::caution[Before sending a photo]
With OpenAI or Cloudflare, the photo you select leaves your home. Provider
credentials are stored on the Hauser server. The wizard explains the upload;
OpenAI steps also show confirmations and a provider-call count, which is not
a bill estimate. Check your provider’s access and usage terms before starting.
See [OpenAI access](/hauser/docs/integrations/openai/) for that connection.
:::

## 4. Draw it yourself

Choose **you draw it yourself** to use the image service you prefer. That
service determines any cost and how your photo is handled. Hauser provides a
workbench with one card per variant: day, evening, lights-off and overcast.

1. Download the input image for the pass: the original photo for day, or the
   accepted day illustration for later variants.
2. Copy the prompt and use it with that image in your chosen service.
3. Upload the finished image to its matching card. Review which variants are
   supplied, derived from day, or still missing.

Under **Windows**, mark each pane so that rain and snow stay inside those
areas. This also works for sets generated with Cloudflare. Hauser does not
send a photo to the service for you in this manual path.

## The library

Finished sets stay in the library under **Rooms & devices**. Assign a set to a
room, switch between sets or delete an old one. Assigning a set updates that
room’s picture.

## Lamp placement

In the room editor, you can place lamps in the picture. Their light cones
follow their state. When the last lamp goes out, the room moves to its
lights-off variant. These effects use the prepared images; they do not
regenerate the room for each command.

## In the native iOS app

The [native app](/hauser/docs/integrations/companion-app/) has its own image
workflow and provider availability. Apple Intelligence image generation is
experimental and depends on the OS, hardware and beta build; do not rely on it
as part of the standard setup. Local model support for the web server remains
roadmap work.
