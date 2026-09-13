---
title: Notion (shopping list)
description: Optional alternative source for the shopping list.
sidebar:
  order: 6
---

Optional. By default shopping lists are Home Assistant to-do lists. Notion is for a page shared with people outside Home Assistant.

## Setup

**Settings → Content → Shopping list → Manage shops**. You need an internal integration token and the address of the page. Shops are headings there, items are checkboxes below them.

## Where it runs

Reading and writing happen on the Hauser server, because the Notion API rejects browser calls and the token must not reach the browser. Reminders never depend on Notion.
