---
title: Key concepts
description: The words this wiki uses and what they mean in Hauser.
sidebar:
  order: 2
---

A few words come up on every page. Here is what they mean.

| Word | Meaning |
|---|---|
| **Room** | A Hauser room. Usually created from a Home Assistant Area during setup. It has a picture, devices and scenes. |
| **Device** | A Home Assistant entity that Hauser shows in a room, for example a light, a thermostat or a window contact. |
| **Stage** | The large room picture on the panel. It changes with daylight, weather and the lights in the room. |
| **Control surface** | The panel area with the room's scenes and devices. It sits next to the stage and can be swiped away. |
| **Room picture** | The illustration of a room. Hauser ships default pictures. You can upload your own or let the room-image wizard draw one from a photo. |
| **Standby** | The resting screen: clock, date, the week, notes and the shopping list. A tap opens the home screen. |
| **Edit mode / Use mode** | Edit mode allows configuration through long presses. Use mode locks configuration away but keeps every control working. |
| **Household configuration** | The JSON file Hauser writes during setup. It holds rooms, devices, modules and sensors. See [Household configuration](/hauser/docs/reference/household-config/). |
| **Module** | A part of the interface you can switch on or off: Home, Energy, Calendar, Notes, Media, Library, Documents. |
| **Hauser server** | The small Node.js server that serves the app, keeps the configuration and talks to services on your behalf. |
| **Home Assistant App** | Hauser packaged as a Home Assistant add-on. It talks to Home Assistant through the Supervisor. |
| **Wizard** | The guided setup that runs on first start. It discovers rooms and devices from Home Assistant. |

## How Hauser talks to Home Assistant

There are two modes. Hauser picks one per installation, you never choose it by hand.

- **Supervisor mode** (Home Assistant App): only the Hauser server talks to Home Assistant. The browser never sees a token.
- **Direct mode** (Docker Compose): the browser connects to the Home Assistant address you typed in the wizard, with a long-lived access token.

Details are in [Home Assistant integration](/hauser/docs/integrations/home-assistant/).
