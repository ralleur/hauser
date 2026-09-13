---
title: Notifications
description: Rules you configure in Hauser, automations Home Assistant runs.
sidebar:
  order: 11
---

Hauser is the configurator and the display. Home Assistant does the waiting and the triggering. That way a rule keeps working when every Hauser screen is off.

## Categories

**Settings → Home → Notifications** has eight categories you fill yourself:

Laundry, Doors & windows, Motion & presence, Safety, Climate, Device health, Energy, Custom.

Each category has a colour for the border of its tiles.

## A rule

A rule names an entity, the states that trigger it, a delay before it counts and, where it fits, a threshold to stay above or below. Every active rule becomes a Home Assistant automation built from one of three Hauser blueprints. Hauser keeps that set in step when you save.

- **Test send** shows what a rule will look like.
- **History** comes from the Home Assistant logbook.

## Laundry

**Settings → Home → Notifications → Laundry** is a guided setup for the washer and the dryer. Two paths:

- bind an existing status entity, or
- use the bundled **power-sensor blueprint**: choose the sensor, review thresholds and hold times, preview the exact Home Assistant objects, then confirm.

Cycle detection stays in Home Assistant.

## How notifications appear

As tiles in the notification layer on the panel, and flowing with the content on the phone.

## Not yet

Multi-device dismissal, quiet hours, browser push and other channels are later work.
