---
title: Phones and panels
description: Opening Hauser on a wall panel, a tablet and a phone.
sidebar:
  order: 5
---

The wizard ends by showing the address Hauser was opened through. The same address is always available under **Settings → Services**, with a copy button and a QR code.

## Wall panel or tablet

1. Open the address in the tablet's browser.
2. Put the browser into full-screen or kiosk mode. On iPadOS, *Guided Access* keeps the panel on Hauser. Android kiosk browsers work too.
3. Hauser draws its own header, so the system status bar can stay hidden.
4. Consider [use mode](/hauser/docs/using/edit-and-use-mode/) so nobody changes the configuration by accident.

Landscape is the panel layout. Portrait works as well: the room tiles take the upper band, the controls the full width below.

## Phone

1. Open the address in the phone's browser.
2. Add Hauser to the home screen. It then runs standalone as a web app, with the [phone layout](/hauser/docs/using/phone/).
3. Someone who opened Hauser on the phone cannot scan the QR code on the same screen. The pairing card offers **Open in the app on this device** instead.

## Several devices

Every device shows the same household. Some settings belong to the device, not the household: the appearance mode, the standby switch, the city map switch, the phone bottom bar order, rooms per row and edit or use mode. So the hallway panel can be locked while your phone keeps configuring.

## Offline behaviour

When Home Assistant is unreachable the room picture stays, the controls dim and the title bar shows one word: *Disconnected*. A tap retries. Hauser never replaces a failed connection with fake data.

When the Hauser server itself is unreachable, the panel shows the time, the date and the coming days in the standby style, with one sentence about the cause and a reload button.
