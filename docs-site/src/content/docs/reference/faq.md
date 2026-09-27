---
title: FAQ
description: Questions a Hauser user is likely to ask.
sidebar:
  order: 4
---

### Do I need Home Assistant?

Yes. Hauser shows and controls what Home Assistant knows. Without it there is nothing to show.

### Does Hauser replace Home Assistant?

No. Automations, integrations and device setup stay in Home Assistant. Hauser is the everyday surface for the household.

### Can I run it as a Home Assistant Container user?

Yes, with [Docker Compose](/hauser/docs/getting-started/docker-compose/). Container has no app store.

### Can I use it on an iPad or an Android tablet?

Yes. Open the address in the browser and use full-screen or kiosk mode. See [Phones and panels](/hauser/docs/getting-started/phones-and-panels/).

### Can I install it as a PWA?

Yes. Add it to the home screen. It starts standalone and caches for offline start.

### Where is the configuration stored?

In the volumes, as JSON. See [Configuration reference](/hauser/docs/reference/configuration/). Some choices such as the appearance state are per device and stay in the browser.

### Does Hauser need cloud services?

No. Home Assistant, Jellyfin, Paperless and Notion are your own services. Weather and the street map use free public data. The room-image wizard is optional, and only its ChatGPT way is paid; it also draws with a free Cloudflare account, or you draw the pictures yourself.

### How are room pictures made?

Four ways: keep the defaults, upload your own, let the wizard draw one from a photo (with your ChatGPT plan or a free Cloudflare account), or draw it yourself with the wizard's wording in any image service and mark the windows by hand. See [Room pictures](/hauser/docs/using/room-images/).

### Will the room-image wizard become free?

It already is, in two ways: with a free Cloudflare account the wizard draws within Cloudflare's daily allowance, and without any account you copy the wizard's wording into Gemini, ChatGPT, Bing or any other service, bring the picture back and mark the windows yourself. The iOS app adds an experimental way through Apple Intelligence on iOS 27. Local models are still planned. See [Room pictures](/hauser/docs/using/room-images/).

### What happens when Home Assistant is unreachable?

The room picture stays, the controls dim, the title bar says *Disconnected*. Hauser reconnects on its own and never shows fake data.

### Can several people use Hauser?

Yes. Every device shows the same household. There are no user accounts. Residents come from Home Assistant persons and get their own notes and colour.

### Is there a login?

No. The port is meant for a trusted home network. For access from outside, use [Remote access](/hauser/docs/integrations/remote-access/), which only lets paired devices through.

### How do I update?

Through the Home Assistant app update, or `docker compose pull` and `up -d`. See [Updates and backups](/hauser/docs/getting-started/updates-and-backups/).

### Does the demo talk to my home?

No. The [demo](https://ralleur.github.io/hauser/demo/) runs against simulated devices and never connects to a Home Assistant.

### How do I report a problem or make a suggestion?

Tap the question mark at the top right of the title bar. Choose **Something is wrong** or **I would like …**, write a sentence, optionally leave a reply address and send. Hauser attaches its version, language, screen size and connection mode, nothing else. The message reaches the author's inbox without a GitHub account. In the demo nothing is sent. Bugs with details are still welcome as [GitHub issues](https://github.com/ralleur/hauser/issues).

Hauser also keeps an error log: when something fails on the server, in the browser or in the iOS app, it notes where and what kind of error it was. Repeats of the same error only raise a counter. Entity IDs, room and device names, readings, addresses and keys are removed before anything is written. The log stays in your home. If it has entries, the sheet offers **Include errors from the error log**, and **What gets sent** shows every line before you send. Nothing leaves on its own. The same applies to the iOS app, which also sends without a Hauser server.

### What licence is it under?

AGPL-3.0-only. Every running instance shows its licence, version and source link under **Status & Updates**.
