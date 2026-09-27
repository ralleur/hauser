---
title: iOS app and pairing
description: The native Hauser app for iPhone and iPad, with Apple Home or Home Assistant, and how a phone pairs with a one-time QR code.
sidebar:
  order: 8
---

Hauser is also a native app for iPhone and iPad, drawn screen by screen in SwiftUI rather than wrapped around a web view: the same look, the same words and the same gestures as the panel. It is in TestFlight with a public link: [testflight.apple.com/join/WPcA1eE1](https://testflight.apple.com/join/WPcA1eE1). Install TestFlight from the App Store, open the link, accept the invitation.

## Three ways in

- **Home Assistant.** The app pairs with your Hauser installation, as a Home Assistant App or with Docker Compose. Rooms, devices, scenes, lists, energy and the notifications you configure come from the server, the same as on the panel.
- **Apple Home.** The app talks to HomeKit directly, with no server at all. Rooms and devices come from Apple Home, the shopping list and reminders are the lists of the Reminders app, and the standby map is drawn on the device.
- **Demo household.** A built-in home to look around before anything is connected.

On an iPad the app shows the wall-panel layout, on an iPhone the [phone layout](/hauser/docs/using/phone/).

## Pairing with a QR code

The System screen of the panel shows a one-time pairing code as a QR code. A paired phone gets its own device token. Only the hash is stored on the server.

- The code lives five minutes and is only shown on a panel in the LAN, so showing it proves presence.
- A device token replaces the browser-origin check for that device and is required over [remote access](/hauser/docs/integrations/remote-access/).
- Someone who opened Hauser in the phone's browser gets **Open in the app on this device** instead of a code to scan.

## What the app adds

- Widgets for a room, a scene, a device, the home and the energy; a lamp you switch on shows as a Live Activity in the Dynamic Island.
- A Siri shortcut and the share sheet for the shopping list; NFC tags that run a scene; notifications with buttons when you leave or arrive.
- The calendars of the device (iCloud, Google, Exchange) merged with the server's events.
- The shopping list sorts itself into shop sections on the device with Apple Intelligence, without a subscription.
- An offline queue for the shopping list and reminders; documents behind Face ID; the document scanner.
- An experimental way to draw a room picture on the device through Apple Intelligence, see [Room images](/hauser/docs/using/room-images/).

## Worth knowing

- The app needs iOS 17 or newer. The glass surfaces come with iOS 26, and the features that use Apple Intelligence need a device that supports it.
- TestFlight builds expire after ninety days and are replaced by the next one.
- [Notifications](/hauser/docs/using/notifications/) from Home Assistant reach the panel and the phone in the browser, not the app yet.
- The app is a project of its own beside the panel and has its own version numbers.
