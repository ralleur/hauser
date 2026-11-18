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

## Use a different weather source

Under **Settings → Appearance → Ambient & standby → Custom weather source &
sensors**, enter a `weather.*` entity from Home Assistant. This works with
providers exposed through HA, such as Weather Fusion AI. Hauser reads the
current conditions and requests the hourly and daily forecasts offered by that
entity through [Home Assistant's weather action](https://www.home-assistant.io/actions/weather.get_forecasts/).
Unsupported forecasts stay empty. The weather view names its source.

You can also choose sensors for outdoor temperature, current rain, wind speed
and humidity. A rain contact reports wet or dry; it does not invent a measured
rainfall amount. Use a current rain-rate sensor rather than a cumulative rain
total. Supported values are converted to Celsius, kilometres per hour and
millimetres. Sensor overrides change current readings; forecasts still come
from the chosen weather provider. Custom readings refresh every 30 seconds
while the surface is active.

Leave the weather entity empty to keep Open-Meteo as the forecast source.
Leave a sensor empty to use the provider's value. Both web and native iOS
save these choices to the same Hauser server. Route snow forecasts and rain
radar retain their separate sources.
