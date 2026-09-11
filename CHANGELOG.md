# Changelog

All notable user-visible changes to Hauser are documented here. The project uses
Semantic Versioning for its public release line.

## [Unreleased]

## [0.14.0] - 2026-09-11

### Added

- **Home: All rooms at a glance.** The layout menu (long press on the free
  area) gains a "View" pill: "Full screen" is the familiar stage — one room
  picture, the room picker at the top of the control surface. "All rooms"
  drops the picture and shows every room as a tile, the same tiles as on the
  phone, with picture, name and light status. The room picker leaves the
  control surface, which now belongs entirely to scenes and devices and
  carries the room name as its heading; a tap on a tile brings that room into
  the control surface. "Rooms per row" sets the tile columns. In portrait the
  tiles take the upper band, the controls the full width below.
- **Home: swipe the control surface away.** A swipe to the left on the
  control surface lets it fly out of the picture, in "Full screen" and in
  "All rooms" alike. The stage then belongs entirely to the room picture or
  the tiles, which spread to the full width. The next touch anywhere brings
  the surface back; a tap on a tile also selects that room.
- **Phone home with many rooms.** The room grid scrolls again and fades
  softly behind the quick actions (off, climate, custom button), which stay
  put at the bottom; before, with many rooms the tiles ran underneath them.
  A swipe to the left on the grid pulls a side sheet in from the right,
  following the finger like the control surface on the panel; it holds
  rooms per row (1 to 3) and a switch to hide the quick actions, and a
  swipe to the right drags it out again. Both are per device, like the
  order of the bottom bar.
- **Blinds come along from setup.** Covers (blinds, shutters, awnings) are
  now a role of the household: the setup wizard hands them over into their
  rooms like lights and switches, the household config accepts several per
  room, and the command contract carries open, close, stop, position and
  tilt. Before, a cover only reached a room through "Add device". The cover
  sheet (open, stop, close, position ladder, tilt) is unchanged; the demo
  shows one in the living room.
- **Sensors pick their symbol.** A sensor without a symbol of its own gets
  one from what it reports: device class first, then unit, then words in
  its name or entity id, German and English. Battery, temperature,
  humidity, power, energy, voltage, current, CO₂, air quality, pressure,
  light, rain, wind, water, gas, signal, motion, door, window, smoke and
  more; the neutral gauge stays for everything else.

### Changed

- **Layout menu without ceremony.** The layout menu has no title and no
  "Apply" or "Cancel": every setting takes effect the moment it is set. It
  stays on the right and flies in from there, over everything instead of
  pushing anything aside, and leaves on a swipe to the right, a tap beside
  it or Escape. A swipe from right to left anywhere on the stage opens it,
  in "Full screen" and "All rooms" alike. "Reset to default" sits top
  right. The second control surface is added at the bottom and gets a fixed
  room of its own, chosen right there.
- **Climate is a tile.** In the control surface the thermostat shrinks to a
  tile the size of a device, showing target and current temperature and the
  mode as its symbol, with no controls of its own. A tap opens the familiar
  thermostat as a sheet: current, setpoint with minus and plus, modes. A long
  press opens the tile's settings: "Controls in the surface" brings the
  thermostat card back into the control surface, "Tile shows" picks target,
  current or both, and "Step size" sets 0.5° or 1° per tap.
- **Sensor tiles show the value.** A sensor added to a room shows only its
  reading on the tile, not its name. The device sheet has a switch "Name on
  the tile" for the cases where the name matters.
- **Room: the thermostat never wraps.** When the controls stay in the
  surface, the climate card is one light control surface at full card width:
  the current temperature sits as a line above the setpoint, the frame around
  the controls is gone, and the setpoint takes three fifths of the card at
  hero size, the modes the rest. At any control-surface width the card keeps
  its shape instead of breaking into two rows.
- **Gestures forgive a crooked finger.** A horizontal swipe no longer breaks
  off when the finger drifts, and it claims the touch before the browser
  starts to scroll. Pressed feedback on a tile waits a moment on touch, so
  starting a scroll on a tile no longer makes it pop.

## [0.13.0] - 2026-09-10

### Added

- **Raum: The device search offers the types a room can take.** A tap into the
  search field brings up pills — Light, Switch, Climate, Sensor, Media and the
  rest — each with the number of devices behind it. One pill lists that type
  without typing a word; the first thirty, with the remainder named below. As
  soon as a letter is typed the pills step aside and the name search takes over.
- **Telefon: The pairing card opens the app on the same device.** Whoever
  reached Hauser from their phone's browser cannot scan a QR code that sits on
  the same screen. The card now offers "Open in the app on this device" — the
  same link the code carries, as a handle. The wall panel does not show it.

### Changed

- **Raum: The stage fades softly from room to room.** The slow dissolve that
  used to happen only when the last light in a room went out now carries every
  room change, whatever time of day it is. Switching a light on inside a room
  stays instant — that is a switch, not evening light.
- **Einstellungen: New symbols for the picture assistant and the catalogue.**
  Both are drawn now instead of pixelled: no background, crisp at any size, and
  they follow the theme like the Hauser mark — light on dark, dark on light,
  with the spark and the sun staying gold.
- **Everywhere: No more scrollbars.** Hauser is swiped and scrolled, not dragged
  by a bar; with a mouse attached the system used to draw fixed bars through
  cards and glass surfaces. Scrolling is unchanged, only invisible.

### Fixed

- **Raum: The climate card no longer breaks into two rows when the column gets
  narrow.** The current temperature, its symbol and its label shrink instead, so
  the target temperature stays beside them.
- **Raum: The first tap on a suggestion in the device search arrives.** Leaving
  the search field gave back the room the sheet had borrowed for the keyboard
  and moved the section between press and release, so the tap landed beside its
  target.

## [0.12.1] - 2026-09-10

### Fixed

- **Raum: One damaged picture set no longer keeps the house from starting.**
  After an update across several versions, a set could lose its files while the
  phone derivations were being added, leaving its catalogue entry in the old
  shape. The store then refused the whole catalogue and the service never came
  up. A set that breaks the contract is now passed over — the room falls back to
  its default picture, the house starts, and the log names what was skipped. The
  contract itself stays closed: what is passed over is not served and not
  written back.
- **Raum: The overcast variant survives the derivation.** Adding the phone
  derivations replaced the set's directory and dropped the optional overcast
  picture, which costs its own model call. It is now carried across.

## [0.12.0] - 2026-09-09

### Added

- **Telefon: The quick action next to the temperature can carry any device.**
  A long press on the vacation button opens an editor: pick any switchable
  device and it sits behind the button from then on. Its icon is suggested from
  the device itself, unless you deliberately choose your own from the icon
  catalogue.
- **Telefon: The bottom bar can be arranged from the More menu.** Two groups —
  the four slots of the bar and everything else. Drag a category upwards past
  the heading to pin it below, or use plus and minus. "More" holds the last
  slot as long as something sits behind it.
- **Raum: The house hands its room pictures to devices without AVIF.**
  `GET /api/app/hero/:roomId/:variant?w=` returns the room's picture as JPEG in
  the requested width — the same picture the wall shows, for the watch.
- **Raum: The demo has a ceiling fan.** It hangs in the bedroom and shows the
  fan panel with speed, presets, oscillation and direction.

### Changed

- **Blick: The day theme stands on a warm ground.** The light surfaces move
  from a cool grey to a warm off-white, and cards, overlays and borders follow
  the same undertone so the surfaces no longer look patchy against each other.
  The night theme is untouched.

- **Telefon: The More menu shows every category, not only the hidden ones.**
  It carries a grip, a subtitle and one button that leads to arranging the bar.
  Whoever looks here should not have to know where something hangs first.

- **Telefon: A swipe down closes a room from anywhere in it.** The gesture used
  to hang on the sheet's head alone; it now works across the whole surface,
  and the room editor has it too. While the content is scrolled, the downward
  movement belongs to the list again.

- **Telefon: The device search lifts itself above the keyboard.** Tapping the
  search field in a room's device list moves it to the top of the panel, so the
  suggestions stand above the keyboard instead of behind it.

- **Telefon: Energy reads as a page.** Four periods sit in two rows with the
  active one marked, the switch between flow and consumption says in plain
  words where it leads, and the readings fill their row instead of standing
  narrow at the edge.

- **Telefon: The shopping list fits a phone again.** Title and tools shared one
  line and pushed the page sideways on a 390 pixel screen; they now wrap and the
  page can no longer be scrolled horizontally.

- **System: The settings list sits evenly again.** The hairline between two
  groups carried eight pixels of air that fell to one side, so the last entry of
  a group sat visibly too high and the first of the next too low.

- **System: Without a Hauser server, the settings only show what works.** On the
  Apple Home path there is no Home Assistant, Jellyfin, Paperless, family data
  or room picture assistant — those sections and entries now stay out of the
  list and out of the search instead of reaching into nothing.

- **System: The settings load one section at a time.** The screen used to bundle
  all fourteen sections into a single 416 KB chunk that the companion app could
  not load at all; it is now 17 KB plus the section you open.

- **Steuerung: The first tap after opening the app arrives.** Until the socket
  stood, every command was dropped — exactly the window the first grab falls
  into. Commands are now accepted and sent as soon as the connection is up.

- **Panel: The iPad's own status bar steps aside.** Hauser draws its own header
  with clock, date and connection, so the system clock no longer stands above
  it twice. It returns as soon as the view switches to the phone shell.

- **Blick: The project page shows the standby in six places.** Cologne, Paris,
  Barcelona, New York, Amsterdam and a Bavarian village take turns behind the
  clock, by day or by night, to show that the map is your own streets and that
  the radius picks itself. The room section switches the real screen through
  sun, rain, evening and lights off, controls included, and the two voices
  section shows the lamp and fan panels stepping through their states.

- **Blick: The project page says what Hauser is, in the first sentence.** The
  headline used to sit inside the picture frame and was cut off on phones, so
  the first screen showed a living room and not one word about the product.
  Headline, a plain description and the install facts now come before the
  picture, followed by three sober paragraphs: what it sits on, what it runs
  on, and who owns the data.

### Fixed

- **Blick: Rain and snow fill the whole screen.** The drifting layer began each
  pass with its lower edge on the top of the screen, so it only snowed in the
  upper part of the picture until the pass was nearly over — in standby as well
  as in the window of a room. The movement now runs downwards out of its
  resting position and covers the surface at every moment.

## [0.11.0] - 2026-09-07

### Added

- **Steuerung: Every device Home Assistant can control has its own second
  level.** Blinds and valves get open, stop and close plus position and tilt;
  vacuums start, pause, return to the dock and choose their suction; locks
  lock, unlock and open the door; humidifiers and water heaters carry their
  target and operating mode; lawn mowers mow, pause and dock; alarm panels arm
  and disarm, asking for a code only when the device requires one; numbers,
  selections and buttons can be set, chosen and pressed. Thermostats show
  every mode they report, along with fan, preset and swing, and their scale
  follows the device's own limits. As with the fan: what the device does not
  report does not appear.

## [0.10.1] - 2026-09-07

### Changed

- **Blick: The project page tells the story of the panel, not a feature list.**
  The first thing on it is the living room without any controls, moving
  through sun, rain on the window, evening and night; then the three moments
  the interface is judged by, the two voices of paper and instruments, and
  what happens when the house does not answer. Every screenshot was retaken
  from the current default pictures.
- **Raum: The demo home has solar on the roof.** The energy picture in the
  demo carries all three notes — solar, measured load and grid — with a day
  curve for generation and consumption, and the notes sit where they do not
  cross the roof.
- **Blick: The demo opens quietly.** No promotional card for the room-image
  wizard, no camera tile without a camera image, and the scribbled tips wait
  until you touch the screen for the first time.

## [0.10.0] - 2026-09-07

### Changed

- **The room tiles on the phone go dark with the room.** In the evening a tile
  now shows the unlit night picture whenever no light is on in that room, and
  the lit one as soon as a lamp burns — the same reading the large stage has
  always had, and the change fades in the same way: when the last light in a
  room goes out, its tile sinks slowly into the dark instead of flipping.
  The tiles still load the small phone-sized picture, so the darkened version
  costs no more to show than the lit one.

## [0.9.1] - 2026-09-07

### Added

- **Fans have their own control panel.** A fan no longer hides behind an
  on/off tile alone: press and hold it and the panel shows what the fan can
  actually do — speed as a tick scale in percent, the preset modes the device
  reports (normal, breeze, sleep, turbo, whatever it offers), oscillation on
  or off, and the direction of rotation. Only what Home Assistant reports as
  supported appears; a plain on/off fan keeps its plain panel.

### Changed

- **A running fan turns.** Its symbol rotates while the fan runs, on the tile
  and in its control panel, and the tempo follows the speed: full speed turns
  fast, the lowest step turns slowly, off stands still. Reduced motion keeps
  the symbol still.
- **A dimmed lamp looks dimmed.** The symbol of a dimmable lamp now carries
  its brightness in its colour, on the tile and in its control panel: full
  brightness glows in the full accent, a low step stays visibly muted, off
  remains grey. The step is readable at a glance, without a number.

### Fixed

- **Hauser starts on older processors again.** The image library ships
  prebuilt binaries that require an x86-64-v2 processor; on older hardware —
  and in virtual machines that present a generic CPU without SSE4.2 — loading
  them failed, and because the image library is loaded at startup the whole
  add-on refused to start instead of merely losing room images. A portable
  WebAssembly build now ships alongside and is used automatically when the
  fast one is rejected, and a failure to load images can no longer take the
  panel down with it. Thanks to @nadi1971 for the report (#18).

## [0.9.0] - 2026-09-07

Everything below arrived between 0.8.2 and this release. It is one update:
the energy screen became a picture of your own house, the calendar became a
sheet of paper, and several places stopped claiming things the house cannot
measure.

### Added

- **The energy screen can show your own house.** The image assistant and the
  image library now offer "Outside (energy)" as a target next to the rooms.
  An image set assigned there becomes the stage of the energy screen: the day
  version by day, the night version at night, fading between the two at dusk
  exactly like a room. The detection knows solar modules as a new kind of
  area, so the generation figure hangs on the real modules and the load figure
  on a window; the grid figure points to the edge, where the grid is. Without
  an assigned set the built-in picture stays.
- **The energy picture has a menu.** Press and hold its background in
  configure mode and a small sheet offers what belongs there: create your own
  house with the assistant, pick a picture from the library, move the notes,
  or jump straight to the sensor assignment in the settings.
- **The notes on the energy picture can be moved.** Every note and its pin
  can be dragged; "Done" keeps the arrangement, "Reset" returns to the
  built-in positions. Positions belong to the picture they were set on, so a
  new picture starts again from its template. A note can never end up outside
  the visible picture, under the tab bar or over the figures at the top left.
- **The workshop simulator knows the energy screen.** Sliders for generation
  and load, presets for noon, evening and grid draw, and the two special
  cases — a house without a generation sensor and a house without any sensor.

### Changed

- **Energy lives in the picture.** The column of tiles is gone. Live
  production, measured load and the grid sit as small paper notes in the
  picture, each pinned by a hairline to the thing it measures, while the free
  wall carries the day: the period's leading figure large in the paper voice,
  the rest small beneath it. The period chips stay; the flow diagram, the
  consumption card and the grid of figures are gone. What the house cannot
  measure gets no note.
- **True curves.** The day's line was an invented shape. It now comes from
  Home Assistant's five-minute statistics of the configured sensors, and it is
  simply absent until there is data. Last week, last month and total show real
  sums from the long-term statistics of the meters — produced, fed in and
  drawn only where a sensor exists.
- **A new built-in picture for the energy screen.** No longer a balcony over a
  specific city composed for a sidebar that no longer exists, but a generic
  house from the garden in Hauser's illustration style, day and night. It is
  also the demo picture.
- **The calendar is a sheet of paper, not a table.** Hairlines instead of a
  grid, small caps weekdays, a serif month and serif day numbers. The current
  week sits at the top in full size, the coming weeks follow a step quieter,
  and a week without appointments folds down to its numbers. Today is a small
  pinned slip instead of a blue box. All-day entries are paper notes; timed
  entries are ink, with the time in the colour of their calendar instead of a
  coloured edge. Every calendar gets its own paper colour, and a resident's
  own calendar wears the resident's colour from the pinboard. The "updated at"
  line and the refresh button are gone: the sheet refreshes on its own.
- **A clock never goes out.** When the household configuration is missing or
  the server stays silent, the panel no longer imitates a dashboard. It shows
  the time, the date and the coming days in the quiet standby style; the cause
  is one translated sentence at the bottom, next to a reload button.
- **Losing the connection no longer stacks a banner over the stage.** The room
  picture stays where it is and the controls dim as before. On the panel the
  title bar carries the cause and reconnects on tap; on the phone a small
  floating chip does the same without pushing the content down.
- **No dashes where the house has nothing to measure.** A figure only exists
  with a reading: without a value the field is gone, and without fields the
  section is gone — on the panel, on the phone, in the sensor tile and detail
  window, and for the media source.
- **The settings fit on one screen.** The sidebar lists nine areas without
  scrolling, separated by hairlines instead of five headings. Maintenance and
  diagnostics, the library override and the unfinished hotel mode are folded
  away: they appear when the hidden gesture reveals them (tap the logo three
  times) and the search finds them at any time.
- **The consent line in the image assistant names the purpose**, not a number
  of image calls. The number of provider calls still shows next to the button.
- **The ambient street map is on by default.** It still appears only once a
  location is set and the server has rendered the map, so nothing changes for
  installations without one; a second device no longer starts without the
  background. Turning it off is what gets stored now.

### Fixed

- **The calendar is there from the first minute.** On a freshly set-up panel
  the calendar tab and the standby week strip only appeared after the first
  five-minute refresh, because the first fetch ran before the connection to
  Home Assistant stood. Now every stale reading reloads the moment the
  connection is established.
- **A house photo stays a house.** Sending a photo of your house through the
  image assistant with "Outside (energy)" as the target produced a living
  room, because every prompt spoke of a room. The outside target now has its
  own recipe for all five passes.
- **A green dot that tells the truth.** The image assistant showed "Connected"
  as long as a credential file existed, even when the ChatGPT sign-in behind
  it had long expired. The status now asks whether the sign-in still carries;
  if it does not, the card says so and offers the sign-in right there. If the
  machine is simply offline, nothing is claimed either way.
- **The image assistant says why it stopped.** Every failure from the image
  provider read the same sentence. An expired sign-in, an exhausted quota and
  a refused photo need different next steps; each reason now has its own
  sentence, and it names what to do.
- **The image assistant keeps its target** while the pictures are generated,
  even if the dialog is closed in between.

## [0.8.2] - 2026-09-06

### Fixed

- **The room editor opens again.** Since 0.8.0 the build ships a shared chunk
  named `room-images-<hash>` next to the room-image assets, and the asset
  route claimed everything starting with that prefix, answering 404. The
  route now claims only the `/assets/room-images/` folder; bundle chunks are
  served statically.
- The startup self-check no longer logs a bogus "0 files missing" line when
  only the room-image job store failed to load.

## [0.8.1] - 2026-09-06

### Fixed

- **The App starts even when the room-image assistant's job store refuses to
  load.** A single inconsistent job record used to stop the whole server, so
  Home Assistant kept the App in an error state. The store stays fail-closed
  (nothing is repaired or deleted), but the house now starts without the
  assistant: its routes answer 503, `/api/health` reports
  `selfCheck.roomImageJobStore`, and the log names the offending job and the
  rule it breaks.

## [0.8.0] - 2026-09-06

### Added

- **The room picture follows the weather.** Each generated image set gains an
  overcast variant, so a room shows grey window light on a rainy day instead
  of the same golden afternoon. The room-image assistant asks a vision model
  once per image set for the surfaces it can see (windows, floor, seats,
  tables and more) and keeps them in the catalogue; rain and snow are drawn
  only inside the windows. Nothing runs in the browser at start or on a room
  change.
- **Weather in the standby screen.** Rain, snow and cloud pass quietly behind
  the clock and the notes. Switchable under Ambient & Standby.
- **Undo instead of confirm.** After "everything off", a scene or a climate
  change, a five-second toast offers Undo; the command goes out immediately.
  A switch that gets no echo from Home Assistant within a second pulses once.
- **Presence and person.** A motion detector from Window & Motion can wake the
  panel from standby; when every resident is away the standby goes dark; the
  first person home is greeted by name with their own notes first. Residents
  are mapped to Home Assistant persons, which are imported on first start.
  All off by default.
- **Ambient light.** A brightness sensor in the room or in the panel dims the
  interface continuously between two levels.
- **Hidden gestures.** Long-press the clock for a large date and seconds;
  tap the logo three times for a diagnostics view with frame rate, connection
  age, snapshot age and version.
- **Calendar moments.** Birthdays and selected fixed days from the family
  calendar show a quiet morning confetti and a line in the standby; the first
  snow of the season is noticed once. Fixed days are selectable in Settings.
- **Dusk in real time.** Around sunrise and sunset the room picture and the
  interface tones cross-fade over the sun's elevation instead of switching.
  Light cones come on quickly and fade out slowly; when the last lamp in a
  room goes out the picture dims into its unlit version.
- **New default room pictures** drawn from a real household, chosen by room
  name in every supported language.
- **Cameras stream live over HLS** as in Home Assistant, with still images as
  the fallback.
- **Shopping list sources.** Stores can be Home Assistant to-do lists (created
  from Hauser) or a Notion page.
- **Companion app pairing.** The System screen shows a one-time QR code; a
  paired phone gets its own device token. The app itself is a separate
  project and not part of this release.
- Standby can be switched off or given its own delay; the layout dialog uses
  the same tick scale as the light dimmer.

### Changed

- **The outdoor weather is your own.** The server reads the home location
  from Home Assistant and asks Open-Meteo itself; the interface no longer
  carries fixed city coordinates and the response contains no coordinates
  ([#15](https://github.com/ralleur/hauser/issues/15)).
- **The room-image assistant is quieter.** The room is chosen up front, the
  final screen is gone, progress is one plain sentence, and the notification
  centre tells you when drafts, the final set or the detected surfaces are
  ready. A spinning mark in the header shows the house is working.
- **Everything at once.** Weather, energy curves, camera stills and
  notification rules start from a snapshot; hero images decode in a worker
  and neighbouring rooms are preloaded on tap. Notes, reminders, shopping
  list and the library reappear instantly after a cold start; stale snapshots
  refresh when the app becomes visible or the network returns.
- **Phone: notifications flow with the content**, tab names match the panel,
  and the room-image onboarding card appears once per device.
- **English without German leftovers**; a lint keeps it that way.
- **Failure states explain themselves.** The minimal shell has a reload
  button and a one-line cause; the disconnected banner appears once, names the
  cause and offers a retry while climate and scenes stay locked.
- **Appearance modes** separate interface tone and dusk cleanly.
- **Every read route** of the API answers repeated requests with 304 via
  ETag; the server pre-computes the city map, phone variants and last week's
  energy statistics overnight and reports a self-check in its health payload.
- Screen and sheet transitions share one motion system with durations and
  curves from the design tokens.

### Fixed

- **Connecting no longer hangs forever.** A handshake that never completes,
  for example after a resume behind a proxy, now times out after 20 s and
  falls back to the normal reconnect cycle
  ([#15](https://github.com/ralleur/hauser/issues/15)).
- **The lamp-placement editor shows your own room picture** instead of the
  bundled illustration ([#16](https://github.com/ralleur/hauser/issues/16)).
- The unlit night picture is used as soon as no lamp in the room is on, not
  only when placed lamps are off; a room without known lamps stays lit.
- Room-image sets are no longer deleted when the server starts without an
  asset catalogue; published sets are kept and reported.
- Assigning an image set takes effect immediately; a mouse click opens a
  notification again; the falling temperature trend points down; the deep
  night dimming is opaque.

### Internal

- The server is split into modules under `app/server/` (room images, hotel
  mode, laundry, setup, configuration core, family data, notifications,
  ambient, songs, files). `server.mjs` keeps the request dispatcher and
  re-exports the public surface, so existing imports keep working.
- The HTTP API has an explicit contract (`app/server/api-contract.mjs`) with
  84 routes. A generated TypeScript table and a typed browser client are
  derived from it, and a test fails when a route literal in server or UI code
  drifts away from the contract.

## [0.7.0] - 2026-09-02

This release documents the work that shipped alongside 0.6.3 but was left out of
its notes, together with the changes made since.

### Added

- **Notifications you configure yourself, as categories with rules.** A new
  **Notifications** section under **Home** replaces the fixed set of messages
  with eight categories you fill yourself. A rule names an entity, the states
  that should trigger it, a delay before it counts and, where it fits, a
  threshold to stay above or below. Hauser is the configurator and the display,
  Home Assistant does the waiting and the triggering: every active rule becomes
  an automation built from one of three Hauser blueprints, and Hauser keeps that
  set in step when you save. Each category carries a colour for the border of
  its tiles, chosen from the palette so light and dark both hold up. A test
  send shows what a rule will look like, and the history comes from the Home
  Assistant logbook.
- **Window contacts and motion detectors are really connected now.** The status
  strip said "All quiet" no matter what the house was doing, because the values
  behind it were never filled. Windows and presence are read live from Home
  Assistant on every screen, and the strip has become a button that opens a
  list with one line per sensor, its room and its state. Rooms without an
  assigned sensor keep the strip as a display rather than offering a button
  with nowhere to go.
- **Choose which sensors count.** Detection no longer has the last word. A new
  section under **Home** shows one card per room and one switch per sensor.
  Everything found is on to begin with, so deselecting is the exception. A
  button returns a room to automatic assignment.
- **Choose what the energy page measures.** The energy card in
  **Connections · Services** now lists every power sensor Home Assistant
  reports: one source for generation, as many consumers as you want to tick,
  plus "Take all". Without a saved selection Hauser uses everything it found.
- **An operate mode that locks configuration away.** A button in the middle of
  the header switches between **Edit** and **Operate**. In operate mode the
  long-press routes into layout, the room device editor, the scene editor and
  the central climate control are closed, while every device stays fully
  operable, including a long press on a light. Someone who only wants to
  operate the panel cannot break anything. Under **Interface & operation** you
  can set how long the panel waits before falling back to operate mode on its
  own, and a PIN that protects leaving it. If a locked long-press is tried
  twice within thirty seconds, a line under the button explains the way back.
- **Central climate control from anywhere.** A long press on the reading area
  of the all-rooms pill opens the settings that decide what it controls, on the
  panel and on the phone, from any screen. The step buttons keep switching, so
  a longer press there does not open configuration.
- **Paperless is set up in the interface.** Address and API token used to live
  in environment variables and the keychain only. Both are now fields in
  **Connections · Services**, and the server picks them up on the next request
  instead of on the next restart. The PIN that locks the documents screen stays
  in the keychain, because it is not a service credential.
- **Sheets on the phone close by swiping down.** The room sheet and the more
  sheet arrive from the bottom and now leave the same way. Dragging the sheet
  header pulls the surface with your finger. Past a quarter of its height it
  closes, below that it springs back. The gesture sits on the header so it
  disturbs neither scrolling nor the sliders inside.
- **Home and Energy keep separate widths for their control areas.** The layout
  dialog now adjusts the area it was opened from and names it on the slider
  row. Existing installations inherit the energy width from the previous
  setting, so nothing shifts when you update.

### Changed

- **The bottom navigation on phones is a floating pill.** The full-width bar
  read as a foreign object below the room grid. It now floats above the
  content as a rounded, translucent pill that follows the rounded corners of
  the phone, and the active entry is marked by a soft highlight that glides
  along instead of a line under the label.
- **One climate pill for the panel and the phone.** The all-rooms control is
  the same component on both: two symmetric round buttons, one dominant target
  value, a quieter range label and the measured current value behind a fine
  divider. Blue and red now mark only the two directions. On the phone it
  shares a single row with the off and holiday actions, which became round
  buttons to fit.
- **Room tiles read as calm product cards.** The veil used to lie flat across
  the whole tile and dulled the picture without forming a clear zone. It now
  carries only the lower information area and is gone by about two thirds of
  the height. Both themes share the same, much weaker gradient, so the
  illustration keeps its depth in light mode too. Room name and status have
  their own hierarchy and a halo that keeps them legible on changing pictures.
  The crop is rendered at its target size, so the fine lines of the
  illustrations no longer step at high pixel density.
- **The media area is off by default.** It stays in the catalogue and is
  switched on under **Connections · Services**, where it is marked as
  experimental. Playback targets that were found during setup remain in the
  configuration, so they are there the moment you enable it.
- **The services page is arranged by module.** Home Assistant sits on top as
  the foundation, and below it one block per module: Home, Energy, Calendar,
  Notes, Media, Library and Documents. Each block carries the switch for its
  module and the setup of the service that fills it.
- **Long device names shrink instead of being cut off.** In the control panel a
  name that did not fit was truncated. It is now reduced in size until it fits
  the space the tile already grants it, which turns two clipped lines into
  three smaller complete ones without making the tile taller.
- **The song workshop was removed.** It did not come up in everyday use. The
  screen, its tab and its search entry are gone. Existing installations that
  still list it in their configuration start normally.

### Fixed

- **A switched-off module stayed in the bar until the next restart.** The
  switch wrote the configuration and the message asked you to restart.
  The module now disappears from the tab bar and the phone navigation
  immediately, and comes back complete when you switch it on again. The saved
  order of the phone entries is left untouched.
- **The camera tile stayed empty in the Home Assistant add-on.** The browser
  loaded the live image directly from the built-in Home Assistant address,
  which wall panels and phones without mDNS cannot reach. The image is passed
  through Hauser's own server now. For generic cameras, whose stream Home
  Assistant serves through ffmpeg, the stream ends without delivering a single
  frame; those tiles reload the still picture instead and retry after an error
  rather than staying blank.
- **A second test notification kept the old colour.** Without a Home Assistant
  connection the test tile is created locally, and an existing tile with the
  same id was ignored. It is replaced now, as Home Assistant does it.
- **The climate card broke out of a narrow sidebar.** The card now scales with
  the width of the sidebar, and the current-value line no longer wraps.

## [0.6.3] - 2026-09-02

### Added

- **Import a scene from Home Assistant.** If you already keep scenes in Home
  Assistant, you no longer have to rebuild them by hand. The scene editor now
  offers "From Home Assistant" next to "Add new scene": it lists your existing
  scenes, those belonging to the room first, and turns the one you pick into a
  Hauser scene with its devices and their brightness and colour temperature.
  Home Assistant does not hand out a scene's stored target states, so the scene
  is applied in the room once to read them back — the editor restores the
  previous state when you close it, as it does for any other change you preview
  there.
- **Rooms that only carry scenes are set up as rooms.** During setup, a Home
  Assistant area now becomes a Hauser room even when no device is assigned to
  it and only a scene points there — via the scene's own area or the areas of
  the devices it controls.

### Fixed

- **A panel flashed on the right before an overlay opened.** Long-pressing a
  room, a light or a scene briefly showed an empty dialog on the right edge
  while the overlay was still loading. The placeholder no longer draws
  anything.

## [0.6.2] - 2026-09-01

### Fixed

- **The Home Assistant add-on stayed on "Connecting…" even though it was
  connected.** Home Assistant may bundle several messages into a single packet,
  and the add-on's connection relay discarded such bundles because a bundle
  carries no message type of its own. The confirmation the app waits for to
  finish subscribing arrives in exactly such a bundle, so the app kept showing
  "Connecting…" while live values were already updating behind it. Bundles are
  now unpacked. This only affected the add-on; installations where the browser
  talks to Home Assistant directly were never impacted.

## [0.6.1] - 2026-09-01

### Added

- **A city map on the standby screen.** When the panel rests, Hauser can place a
  subtle street map of your surroundings behind the clock and notes. The place
  comes from Home Assistant, from the device's own location, from a place search
  ("Dortmund, Germany") or from coordinates you type. The map is rendered once on
  the server and stored as a small monochrome image; light and dark share the
  same file, and Deep Night shows no map at all. Setup offers it as an opt-out
  with an example picture, and it can be turned off at any time under
  **Appearance → Ambient & standby**.
- **Place search instead of coordinates.** Type a town and pick it from a list.
  The search runs on the server against OpenStreetMap's geocoder; what leaves the
  server is a search term, never your address.

### Changed

- **The app starts noticeably faster and reaches a usable state sooner.** When a
  validated configuration is already known, the real interface is mounted
  directly instead of a placeholder shell that is torn down again a moment later.
  Independent startup requests now run in parallel, and the Home Assistant
  connection no longer waits for unrelated configuration.
- **Room pictures on phones are about a fifth of their previous size.** Hauser
  now derives a phone-sized variant of every room image when the image enters the
  library, so a room tile shows its background in the first paint instead of
  decoding a multi-megabyte file. Existing libraries are migrated automatically
  on the first start after the update.
- **The offline cache shrank from roughly 17 MB to 3.5 MB**, which makes every
  service worker installation faster. Full-size room pictures are fetched when
  they are first shown and cached from then on.
- **A waiting update is offered, not forced.** Hauser no longer reloads itself
  while you are looking at it. A quiet hint appears and applies the update when
  you tap it; without a tap the running version keeps working. Wall panels still
  update on their own while idle.
- **Automatic appearance follows the time of day when Home Assistant has not
  reported a sun position yet**, instead of staying dark until it does.
- **Settings are easier to navigate.** "Appearance" and "Layout & controls" are
  now one section, **Interface & controls**. Hotel Mode and guest access moved
  into a new **Experimental** group at the end of the list.
- **Unfinished room edits survive leaving the section.** Renaming rooms,
  reordering them or adding devices and then switching to another settings
  section no longer discards the draft silently. A restored draft is marked as
  such and can be discarded deliberately.

### Fixed

- Reconnecting after the app returns from the background no longer waits for the
  next retry window; a connection that only looks alive is detected and replaced.
- Room tiles no longer decode a second set of images when Home Assistant data
  arrives shortly after start.

## [0.6.0] - 2026-08-31

### Changed

- **As a Home Assistant App, Hauser no longer asks for a Home Assistant address
  or a Long-Lived Access Token.** The App connects to Home Assistant Core over
  the internal Supervisor endpoints, and the browser reaches live state through
  a same-origin WebSocket on the Hauser server. The Supervisor token stays
  inside the server process and is never written to `/data`, handed to the
  browser or logged. Installations that previously stored a Long-Lived Access
  Token have it removed on the first start in App mode. Docker Compose keeps its
  existing setup wizard, address and token unchanged.
- **The setup wizard ends by showing the address phones and tablets use**, with
  a copy action and a QR code. The same address stays available under
  **System → Services**. It is the address the current session was opened
  through, not a guess from the Home Assistant host name.

### Security

- The App's direct LAN port is documented as a trusted-network boundary: it
  carries no separate login and no device pairing, and must not be published to
  the internet.

## [0.5.3] - 2026-08-31

### Added

- **One climate control can set every thermostat.** The status bar and phone
  quick actions show the shared target temperature and raise or lower all
  configured climate entities together.

### Changed

- **Climate controls are clearer and more compact on phones.** Current and
  target temperatures have distinct labels, the thermostat card uses the
  available width more efficiently, and temperature steps consistently use
  plus and minus buttons.
- Phone quick actions and optional room-editor state are loaded only when they
  are needed, reducing the initial phone bundle.

### Fixed

- **Room-image generation with a ChatGPT subscription works again.** Hauser now
  uses the native Codex image-edit endpoint and its JSON image result instead
  of waiting for an image-generation tool result from a Responses stream.
- **Custom room images work from the direct Home Assistant App address.** The
  manual upload endpoint now accepts an exact same-origin request such as
  `http://homeassistant.local:4173` while continuing to reject foreign origins.
- Manual room-image upload failures follow the selected interface language
  instead of exposing the server's German message.

## [0.5.2] - 2026-08-28

### Added

- **Camera feeds can become movable pop-outs.** A long press opens the camera
  menu, moves the feed out of the control surface and onto the room background,
  and lets it be dragged and resized. A pop-out follows its room by default or
  can stay visible across room changes; its title bar can be hidden, and it can
  return to the control surface at any time.
- **Room tiles per row are adjustable.** The home layout now supports one to
  four room tiles in each row instead of enforcing a fixed two-column grid.

### Changed

- **Home layout editing is a live mirrored drawer.** A long press on the room
  background opens an unblurred panel on the right with the same dimensions as
  a control surface. The former Compact, Balanced and Wide choices are one
  continuous size control, with a default action and direct preview.
- **The camera, climate and new layout controls are fully localized** in German,
  English, French, Italian, Polish and Portuguese.
- The redundant **Temperature** heading above the climate card and the Safari
  install hint have been removed.

### Fixed

- Saving reconfigured rooms now refreshes the active household cache before
  returning to the dashboard, so the new room state appears immediately.

## [0.5.1] - 2026-08-28

### Added

- **Scenes are configurable per room.** The scene editor lists the devices a
  scene drives and the state each one takes — on or off, and, where the lamp
  supports it, brightness and colour temperature. Every change runs on the
  lights straight away as a preview and is taken back when the editor closes,
  so the room is never left in an editing state.
- **Rooms can have their own scenes.** Beside the three built-in scenes, a room
  can gain its own through **Add new scene**, and every scene — built-in ones
  included — can be renamed or deleted. All of it belongs to the room where it
  was made: a *Movie night* in the living room does not appear in the kitchen.
- **The active scene is highlighted.** A scene lights up when the room actually
  stands at its target state, whether it was tapped or the lamps were set there
  by hand.
- **Advanced room settings.** A room's tile on the home screen can show
  temperature, humidity, both or neither, and the sensor behind each is picked
  automatically from the Home Assistant area the room maps to. Another sensor
  can be chosen where several fit.
- **The room-image assistant opens from the room overlay**, next to uploading an
  image and picking one from the library.

### Changed

- **Configuration overlays share one set of controls.** Reordering is a six-dot
  handle that drags — with the arrow keys as the keyboard path — deleting asks
  once in place of a dialog, and creating something new is a dashed tile. The
  room editor's device list follows suit: the up/down chevrons are gone.
- **The room editor opens on a quick-setup grid.** Room image, scenes, lamp
  placement and the new advanced view sit as four tiles above the device list.

## [0.5.0] - 2026-08-27

### Added

- **Rooms & devices is a real room list.** Every room now shows its current
  room image, its name and how many devices it holds. **Configure devices**
  opens the room editor, **Rename** edits the name in place, the six-dot handle
  drags the room into position — with the arrow keys as the keyboard path — and
  the overflow menu keeps move, rename and delete. **New room** and **Save
  changes** sit where the list ends.
- **Tapping a room's image opens the image editor.** The thumbnail in the
  settings list leads straight to the room-image view of the room overlay,
  where an image can be uploaded, picked from the library or removed.
- **The room-image assistant and the library have their own cards.** Both sit
  as illustrated tiles under the room list instead of two anonymous rows.

### Changed

- **Version numbers drop the `-beta.N` suffix.** Every release below `1.0.0` is
  a beta; the version number says so on its own. `0.4.0-beta.10` is followed by
  `0.5.0`.
- **Settings open on Rooms & devices.** That is the page where a home is
  actually set up. Coming back within 30 seconds still returns to the section
  that was open, so a quick detour costs nothing; a later visit starts fresh.
- **Resetting is one card with three tiles.** Device names and icons, scenes,
  and re-reading rooms and devices from Home Assistant — the last one used to
  be a separate section at the bottom of the page.

### Fixed

- **The room-image card kept coming back.** Dismissing it only applied to that
  one room and only until the next reload. A checkbox on the card now switches
  it off for good on that device.
- **Saving room changes could be blocked by Jellyfin.** In Settings there are
  no Jellyfin fields, yet an unverified sign-in disabled **Save changes**. The
  first-run wizard still requires the tested sign-in.

## [0.4.0-beta.10] - 2026-08-26

### Added

- **Rooms without a background explain how to get one.** A room that has no
  image set assigned showed nothing but an empty tile. The home screen now
  carries an onboarding card with a before/after band, the three steps the
  assistant takes, and three ways out: generate an image, pick one yourself,
  or dismiss the card. The assistant and the library are loaded only when one
  of them is actually opened.
- **Rooms without devices offer a way to add one.** Instead of a blank area, an
  empty room shows an **Add device** placeholder tile that opens the same room
  editor as a long press on the room tile.
- **The people on the pinboard can be named and added.** Tapping a name renames
  that person, a header button adds another, and each gets a note colour from a
  fixed palette. Existing tasks stay with their person.

### Changed

- **The room-image assistant leads with the photograph.** The OpenAI access
  step now appears only when access is missing and stays reachable as a chip in
  the header afterwards; the consent text is one line with the long form behind
  an info button. Choosing the photograph is the first thing the assistant asks
  for and offers the camera directly on touch devices. Cropping and zoom moved
  to step two, next to the style variants, because the perspective correction
  changes the framing anyway. The focus picker is gone entirely — the generated
  sets already match the panel format exactly, so it changed nothing.
- **The standby button sits in the title bar by default.** The setting in the
  long-press menu now switches to the large floating button instead of away
  from it.

### Fixed

- **The room-image assistant failed with a 403 in the Home Assistant app.**
  Every write of the assistant — starting a ChatGPT sign-in, uploading a
  photograph, creating variants — was answered with `ORIGIN_FORBIDDEN` when
  Hauser ran as a Home Assistant add-on. The add-on can only configure the
  loopback origins, while the browser reaches Hauser under the host's own
  address, so the request never matched the static allowlist. A request whose
  `Origin` matches its own effective origin — protocol, host and port,
  compared exactly — is now accepted in addition to the configured list.
  Foreign origins, differing ports or protocols, `null`, malformed values, a
  missing origin on a write, and duplicate `Origin` headers stay rejected.
- **Room-image errors appeared in German in an English install.** The assistant,
  the library and the access panel showed the server's message verbatim, and
  the server writes German only. They now use the translated message for the
  operation that failed.
- **A published image set could break the next server start.** The expiry pass
  marked already published sets as expired without detaching the asset, which
  the metadata validation forbids — so the service refused to start with
  "incoherent room-image job metadata". Records that carry an asset are left
  alone.

## [0.4.0-beta.9] - 2026-08-26

### Fixed

- **The published container did not say where its source came from.** Hauser
  serves its exact revision and the URL of the corresponding source at
  `/api/build-info`, without authentication and before any configuration
  exists — that is how the project meets section 13 of the AGPL. In every
  image published since the license change the two fields came back empty,
  because the release workflow's publish step never passed
  `HAUSER_REVISION` and `HAUSER_SOURCE_URL` to the build. It also never
  passed `HAUSER_RELEASE=1`, the Dockerfile's own guard that fails a release
  build rather than publishing an image which cannot back its source claim,
  so nothing caught the omission. The image labels
  (`org.opencontainers.image.revision` and `.source`) were always correct;
  only what the running container reports about itself was missing. The
  publish step now passes all three, and the guard makes a repeat a build
  failure. `v0.4.0-beta.7` and `v0.4.0-beta.8` are both affected.

### About v0.4.0-beta.8

`v0.4.0-beta.8` was tagged and its image published, but no release was issued
for it: the defect above was found while verifying that exact image digest.
Everything beta.8 contained is in this release; its entry below stays as the
record of what landed when. Update straight from `v0.4.0-beta.7` if you are
still on it.

## [0.4.0-beta.8] - 2026-08-26

### Added

- **Calendar and Notes are part of the generated navigation.** Onboarding
  produced a navigation with only Home and System (plus Media when a media
  player was discovered), while the Calendar and Notes screens existed with no
  way to reach them — the README's hero image showed tabs an onboarded install
  never had. New installs now get Home, Calendar, Notes, optionally Media, and
  System. An existing install whose navigation is still the untouched
  onboarding result is migrated to the same set on load; a navigation you have
  customized yourself is left alone. Reported in #8.
- **An image-set library for generated room backgrounds.** Finished sets were
  reachable from nowhere once the assistant had produced them. Settings →
  Rooms & Devices now lists every set with a preview, its size, its creation
  date and the room it is assigned to, and lets you assign a set to a room,
  remove that assignment, or delete it after a confirmation. The header shows
  how many sets exist and how much storage they occupy.
- **Room configuration behaves the same from everywhere.** There were two
  routes into a room's configuration with different capabilities. Tapping a
  room under Rooms & Devices now opens the same overlay as a long press from
  the home screen; the embedded list keeps creating, deleting and reordering.
  The overlay also assigns image sets from the library, and a long press on a
  device row moves that device to another room.

### Fixed

- **The room-image assistant could not start a job over plain `http://`.**
  Generating an ID used `crypto.randomUUID`, which browsers expose only in a
  secure context, so on a panel reached over `http://` in the LAN the request
  failed while it was still being assembled — before any network call and
  before the error handling. Pressing **Create variants** did nothing at all:
  no request, no status change, no message. The assistant now falls back to
  `getRandomValues`, reports unexpected failures instead of swallowing them,
  and places error messages directly above the action buttons where they are
  in view. The ChatGPT authorization code can be copied with a click.
- **The assistant returned photographs where it should have returned a
  composition.** The composition step received the already-cropped tile rather
  than the whole photograph, so the prompt discussed a framing the model never
  saw, and protective wording in the first phase suppressed the free
  recomposition entirely. The two candidates now differ as intended: a
  realistic composition with corrected perspective, and an illustration.
- **Both clocks froze.** The dashboard and ambient clocks stopped advancing
  and only a manual reload brought them back. They now resynchronize when the
  page is restored, the tab becomes visible or the window regains focus, in
  addition to their regular tick. Reported in #8.
- **Status & Updates showed invented services and updates.** The screen listed
  six pending updates and five connected services from hard-coded prototype
  data, none of it reflecting the connected instance — misleading about
  security-relevant state. A productive install now shows only the verified
  Home Assistant connection and genuine pending `update.*` entities, and says
  **No updates available** when there are none. The fictional list remains only
  in the demo build, which is marked as such. Reported in #8.
- **The floating power button covered controls beneath it.** While System
  settings are open, the power control now sits in the title bar even when the
  floating button is the general preference — it no longer obscures the Scenes
  **Reset** button. Reported in #8.
- **German text remained in the English interface.** The connection indicator,
  the Safari *Add to Home Screen* hint, and the room-image assistant, its
  library and its access dialog are now translated in all six languages, and
  the ambient hero text keeps the selected language consistently instead of
  switching between English and German across visits. Reported in #8.
- Room-image dialogs opened from the room overlay were unstyled, and the
  device-move sheet appeared behind the overlay, because their styles were
  loaded only by the System screen.

### Changed

- **The AI line on the lock screen is off by default.** It calls a language
  model service, which should be a deliberate choice rather than something that
  happens on first start. Turning it on is remembered; the default is off on
  every install.
- The public demo starts in English until a visitor picks a language, and it
  now shows the room-image assistant and the image-set library in full, with
  prepared example photographs instead of an upload. A marked note in both
  dialogs states that no account and no AI service is involved.

### License

The project's license identifier is now **AGPL-3.0-only** instead of
`AGPL-3.0-or-later`. The license text in [LICENSE](LICENSE) is unchanged: it
remains the unmodified GNU Affero General Public License, version 3. What
changes is that the project no longer offers the option of using it under a
later version of the AGPL should the Free Software Foundation publish one.
Releases up to and including v0.4.0-beta.7 keep the terms they were published
under.

Contributions are made under [CLA.md](CLA.md), now at version 2. Contributors
keep the copyright in their work.

## [0.4.0-beta.7] - 2026-08-24

### License change

Starting with this release, Hauser is licensed under the GNU Affero General
Public License instead of MIT.

Everything released up to and including v0.4.0-beta.6 stays MIT licensed and can
be forked from there. This change applies going forward only; no release has
been withdrawn or retagged.

**If you run Hauser at home, nothing changes for you.** The AGPL only creates
obligations for someone who modifies Hauser and then offers it to other people
over a network — they have to make their modified source available to those
users.

The reason is straightforward: the AGPL keeps improvements to a networked
application flowing back to the people who use it, instead of disappearing into
closed forks.

Contributions now require agreement to a [CLA](CLA.md).

### Fixed

- The setup wizard's reconfigure flow (Settings → Rooms & Devices) never sent
  the `If-Match` / `X-Hauser-Shared-Config-If-Match` preconditions that
  `POST /api/setup/activate` requires when reconfiguring, so every reconfigure
  save was rejected with `428 CONFIG_PRECONDITION_REQUIRED` before anything
  was written. **Save changes** appeared to do nothing — no console error, no
  visible feedback near the button — and any rooms or devices found by
  **Reload rooms and devices** reverted to the previously active configuration
  on leaving the screen. The wizard now captures both ETags on load and sends
  them back on save. Reported in #7, reproduced on v0.4.0-beta.6 in #9.

## [0.4.0-beta.6] - 2026-08-21

### Fixed

- `POST /api/setup/activate` and other API routes rejected direct browser
  requests with `403 SETUP_REQUEST_FORBIDDEN` whenever the App was reached
  through a hostname absent from the static `HMI_ALLOWED_ORIGINS` allowlist —
  for example the Home Assistant App's default `homeassistant.local:4173`.
  A request is now also accepted when its Origin header exactly matches the
  effective request host, independent of hostname, so installs no longer need
  manual origin configuration. Reported in #8.

## [0.4.0-beta.5] - 2026-08-16

### Fixed

- The setup wizard discovered only lights, climate, temperature, presence,
  window and camera entities. Switches were dropped without a trace — the
  domain was never mapped, so room-assigned switches reached neither the
  generated room configuration nor the ignored list. Media players were never
  offered as media targets even though the runtime already supported them.
  Reported in #7.
- A room accepted only one entity per non-light role, so several switches in
  the same room collapsed into a single entry. Switches may now appear as often
  per room as lights do.

### Added

- Vacuums are discovered and exposed as a start / return-to-base control. This
  path follows Home Assistant's documented `vacuum` service set and has not yet
  been verified against physical hardware.

## [0.4.0-beta.4] - 2026-08-16

### Fixed

- The Home Assistant App failed to start with
  `RUNTIME_DIRECTORY_NOT_WRITABLE` on `/data/assets`. The App manifest
  requires that directory for generated room images, but the container
  entrypoint never created it. The entrypoint now derives the directories it
  prepares from `HMI_REQUIRED_WRITABLE_DIRS` — the same list the readiness
  check verifies — so a deployment cannot require a directory that nothing
  creates. Reported in #6.
- Startup and household-configuration diagnostics are reported in English.

### Changed

- The App manifest and the container entrypoint ship from the release
  pipeline instead of being maintained by hand, and the release preflight
  fails when the manifest version and the published image version drift apart.
- Tagged releases publish the plain `<version>` image tag alongside `v<version>`,
  which is the tag the Home Assistant Supervisor resolves from the manifest.

## [0.4.0-beta.1] - Unreleased

This is the planned first public release. It remains a self-hosted hobby-project
beta without a support or compatibility promise beyond the documented paths.

### Added

- Source-built Docker/Compose installation with read-only root filesystem,
  unprivileged runtime, health checks and persistent config, data and asset
  volumes.
- Deterministic first-run and reconfiguration wizard for Home Assistant Areas,
  relevant entities, room mappings and optional Jellyfin setup.
- Versioned external household configuration with fail-closed validation and
  automatic schema v1-to-v2 migration backed by an exact rollback copy.
- Backup, restore, commit-bound image build and manual image rollback helpers.
- Isolated development pilot with its own synthetic Home Assistant, network and
  volumes, including explicit-Area and no-Area onboarding paths.
- Six interface languages: German, English, French, Italian, Portuguese and
  Polish.
- Local custom room-background upload under room editing for JPEG, PNG, WebP and
  AVIF files up to 12 MiB, including replacement and restore to the project default.
- Tag-gated quality and container-image workflow. A matching version tag can
  publish immutable `linux/amd64` and `linux/arm64` images to GHCR only after the
  full quality job passes.

### Changed

- The Home Assistant adapter now recovers entity state correctly after a lost
  and restored connection.
- Release evidence is split honestly: the isolated clean-room pilot proves the
  technical beta contract; an external real-home installation remains mandatory
  during beta stabilisation before the release candidate.

### Known limitations

- The clean-room pilot was operated by the maintainer and does not prove
  external-user usability or compatibility with a second real device topology.
- The documented tested container path is Docker Desktop on Apple Silicon;
  `linux/amd64` is built by release automation but still requires post-publish
  smoke evidence.
- Jellyfin is optional. The isolated clean-room pilot exercised the disabled
  path; the live integration was verified separately against the maintainer's
  installation.
- Non-German and non-English translations have not been reviewed by native
  speakers.
