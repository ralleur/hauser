---
title: Calendar
description: Home Assistant calendars as one sheet of paper.
sidebar:
  order: 14
---

The calendar is a sheet of paper, not a table. Hairlines instead of a grid, a serif month, small-caps weekdays. The current week sits at the top in full size, the coming weeks follow a step quieter, and a week without appointments folds down to its numbers.

![The calendar screen.](/hauser/media/calendar-1100.webp)

## Where the events come from

From Home Assistant `calendar.*` entities. Hauser reads them with Home Assistant's own calendar API. There is no separate calendar account in Hauser.

- **Settings → Content → Calendar & Reminders → Calendars shown** chooses which calendars appear.
- **Settings → Connections → Services → Connect iCloud account** starts Home Assistant's iCloud/CalDAV setup flow. The credentials go to Home Assistant, not to Hauser.

## Colours

Every calendar gets its own paper colour. A resident's own calendar wears the resident's colour from the pinboard.

## Refresh

The sheet refreshes on its own and reloads the moment the Home Assistant connection is established. The week strip on the [standby screen](/hauser/docs/using/standby/) uses the same data.
