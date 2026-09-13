---
title: Reminders and notes
description: Sticky notes per person on a pinboard.
sidebar:
  order: 16
---

Reminders are coloured sticky notes grouped per person. They live on the Notes screen next to the shopping list, on the standby screen and on the phone.

## Where they are stored

The Hauser server keeps them in a family data file (`family-data.json` in the data volume). Selected Home Assistant `todo.*` lists can be merged in addition: **Settings → Content → Calendar & Reminders → Reminders shown**.

## People

The people on the pinboard come from Home Assistant persons. Tap a name to rename it. **Add resident** adds a column. Each person has a colour that also marks their calendar.

## Writing a note

- **Add a reminder for ...** at the bottom of a person's column. Type, then **Save entry**.
- A reminder can carry a date and a **Show on the lock screen from** date, so it appears in standby only when it matters.
- Tap a note to edit it or mark it as done.
- **Show all reminders as a table** lists everything at once.
