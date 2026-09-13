---
title: Hotel mode
description: A dedicated panel as a guest surface for one holiday apartment.
sidebar:
  order: 22
---

Hotel mode is experimental and off by default. It turns a permanently installed panel into a self-explanatory surface for guests of **one** holiday apartment.

## States

| State | What the panel shows |
|---|---|
| Inactive | A neutral surface. No names, no bookings, no device control. |
| Active | A welcome screen, then the room view limited to released rooms and devices. |
| Admin | The full panel and settings, unlocked by PIN, for 15 minutes. |

A Home Assistant calendar decides the state: every valid event of the configured calendar is one stay. Overlapping or unusable events keep the apartment neutral. A time-limited manual stay covers early arrival or calendar trouble.

## Guest releases

Default deny in four steps: released rooms, released entities in them, the actions each supports, and where useful a value range such as 18–24 °C. Scenes and scripts are released one by one. A new entity is never released automatically.

## Security

The kiosk mode of the tablet is required hardening but not the permission boundary. The boundary is the Hauser server: guests never receive a Home Assistant token, and their commands run through a narrow proxy that only knows released entities.

## Activation

Before hotel mode can be enabled, the server runs a preflight: kiosk checklist confirmed, admin PIN set, at least one device released, the proxy really reads a released entity, the calendar really answers. A failing check refuses activation and changes nothing.

## Checkout

If enabled, a guest ends the stay. Hauser neutralises the surface and fires the Home Assistant event `hauser_guest_checkout`. Choose the notification channel with a normal automation. A configured scene runs afterwards.

## PIN recovery and details

Recovery works through local server access, not the interface. The full contract is in [`docs/07-configuration.md`](https://github.com/ralleur/hauser/blob/main/docs/07-configuration.md#hotel-mode-holiday-apartment).
