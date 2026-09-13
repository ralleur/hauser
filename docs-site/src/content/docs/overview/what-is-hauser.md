---
title: What is Hauser?
description: The idea behind Hauser and what it is not.
sidebar:
  order: 1
---

Hauser is a self-hosted web app that shows your home as rooms. Each room has a picture, its lights, its heating and its scenes. Around the rooms sit the things a household looks at every day: the calendar, reminders, the shopping list, energy and the weather.

## The idea

Home Assistant is a great automation engine. Its dashboards are grids of cards from many authors, and they rarely feel like one product.

Hauser takes a different path:

- **One design.** Every screen uses the same colours, type and motion.
- **Rooms first.** You do not look for a device in a list. You look at a room.
- **Instant feedback.** Tap a light and it turns on at once. If the house disagrees, the control moves back to the truth instead of lying.
- **Calm by default.** A panel spends most of its day in standby: a clock, the week, the notes. It gets out of the way.
- **Local first.** No cloud account, no telemetry. The only paid third party is optional and only used for room pictures.

## What Hauser is not

- **Not a replacement for Home Assistant.** Automations, integrations and device setup stay in Home Assistant.
- **Not a Lovelace card.** Hauser is its own app with its own server.
- **Not a hosted service.** It runs in your home, on your hardware.

## Who it is for

- People who want a wall panel that the whole family understands.
- Households that want one phone app for the daily basics.
- Home Assistant users who like a finished look more than a configurable grid.

## Two shells, one app

The same app renders a landscape **wall panel** and a one-handed **phone** layout. Both share the state, the components and the design tokens. Only navigation and overlays differ. See [Phones and panels](/hauser/docs/getting-started/phones-and-panels/).
