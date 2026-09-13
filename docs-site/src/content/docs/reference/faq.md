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

No. Home Assistant, Jellyfin, Paperless and Notion are your own services. Weather and the street map use free public data. The room-image wizard is the only paid, cloud-based step and it is optional.

### How are room pictures made?

Three ways: keep the defaults, upload your own, or let the wizard draw one from a photo with your own OpenAI access. See [Room pictures](/hauser/docs/using/room-images/).

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

### What licence is it under?

AGPL-3.0-only. Every running instance shows its licence, version and source link under **Status & Updates**.
