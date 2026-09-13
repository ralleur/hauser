---
title: Open-Meteo (weather)
description: Free weather for the standby screen and the room pictures.
sidebar:
  order: 5
---

Free, no account. The Hauser server reads the home location from Home Assistant and asks Open-Meteo itself. The response the browser sees contains no coordinates. Open-Meteo sees the server's address, not the panel's.

## What it feeds

- The outdoor temperature and trend on the standby screen.
- Rain, snow and cloud behind the clock in standby.
- The overcast variant of a room picture and rain drawn inside its windows.
- The first snow moment.

If Open-Meteo does not answer, the last reading stays.
