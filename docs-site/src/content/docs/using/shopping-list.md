---
title: Shopping list
description: One Home Assistant to-do list per shop, or a Notion page.
sidebar:
  order: 15
---

Every shop is a list. Items are grouped by shop and, inside a shop, by category in the order you walk through it.

![The notes screen: a shopping list on the left grouped by shop, reminders as coloured notes on the right.](/hauser/media/notes-1100.webp)

## Sources

- **Home Assistant to-do lists** (default). Every shop is a `todo.*` entity, for example from the *Local To-do* integration. The same list works in the Home Assistant app and with voice assistants. As a Home Assistant App, Hauser can create a list for you.
- **Notion** (optional). A shared page where shops are headings and items are checkboxes. See [Notion](/hauser/docs/integrations/notion/).

## Settings

**Settings → Content → Shopping list**:

- **Manage shops** adds shops and binds them to lists.
- **Category order** sets the route through the products per shop.

## On the panel

The Notes screen shows the list on the left. Add an item per shop, tick it off, sort and refresh.

## On the phone

A quiet checklist: tap a row to tick it, five seconds to undo, an **Add item** row per store. See [Phone layout](/hauser/docs/using/phone/).

## On the standby screen

The open items appear at the left of the [standby](/hauser/docs/using/standby/) screen.
