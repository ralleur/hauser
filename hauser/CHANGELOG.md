# Changelog

## Unreleased

## 0.21.1 - 2026-09-23

- The standby city map is generated again: Hauser asks a working map service
  first, falls back to a second mirror and retries once before giving up.

## 0.21.0 - 2026-09-20

- On the phone, the room configuration opens in place: the room picture turns
  into its own blueprint, and the scene bar, device tiles and climate card stay
  exactly where you operate them.
- Arrange devices by holding and dragging their tiles, remove one with the
  minus on its corner, and add one with the dashed tile after the last device.
- A scene can now set a colour per lamp, next to brightness and colour
  temperature.
- On the phone, temperature, humidity and presence now sit under the room name
  above the scenes; a tap on the temperature opens the climate controls.
- On the phone, the energy page shows your house pale behind the figures.
- The laundry notification can be set up again: it no longer ends in
  “Laundry setup failed” on add-on installations (#21).
- The hint under “Generation” now says which sensor is meant: what your solar
  system produces right now, not the feed-in to the grid.
- Saving the energy sensors under Services now keeps showing what you saved and
  tells you to reload; before, the page fell back to the old selection.
- A room you created yourself can now choose its temperature and humidity
  sensor from every sensor in the home, not only from a matching Home
  Assistant area.

## 0.20.6 - 2026-09-20

- Sorting the devices of a room by dragging stays calm: the row follows your
  finger, the others glide aside, and nothing shivers.
- Removing a device from a room now has a short animation instead of the row
  disappearing on the spot.
- The bar at the bottom of the phone view now keeps the same distance above
  and below itself, instead of sitting closer to the quick actions.

## 0.20.5 - 2026-09-18

- A fresh install right after a release no longer fails with
  `manifest unknown`: the image is published before the new version becomes
  visible.
- The standby texts no longer ask for a language model that is not
  configured, so the browser console stays quiet. Docker Compose
  installations with a hand-written Compose file get the picture wizard
  without extra variables.

## 0.20.4 - 2026-09-17

- The energy screen accepts your own photo as the house picture, without the
  picture wizard.

## 0.20.3 - 2026-09-17

- A calendar with a recurring event opens again instead of failing to build.

## 0.20.2 - 2026-09-16

- Housekeeping for Docker Compose installations: releases are published as
  GitHub releases and a moving `latest` image tag exists. Add-on installations
  are unaffected — Home Assistant already shows updates and their changelog.
- A view that fails to open says what went wrong and offers to try again,
  instead of showing "Loading view." forever.
- A damaged job no longer keeps the picture wizard switched off: the job store
  opens empty again instead of answering 503 forever.
- Homes with more than 64 power sensors can save their energy selection again.

## 0.20.1 - 2026-09-15

- An all-day event fills one day again, not two: plain dates from iCloud and
  CalDAV were read as UTC.
- Document storage can be set up from the panel — its PIN now sits beside the
  address and the token under Settings → Services, instead of only in the Mac
  keychain.
- Picking your own room picture names the reason when the image library does
  not run on the device.
- Sheets on the phone come and go like app cards: same time and curve in both
  directions, and a swipe carries on from where your finger let go.

## 0.20.0 - 2026-09-14

- Demo only: the first visit opens on the standby screen over a map of
  Cologne. Installed panels are unaffected.

## 0.19.1 - 2026-09-14

- The room goes dark again when the last lamp goes out: an open blind no
  longer counts as a light.
- Phone room tiles in the demo show their pictures again.

## 0.19.0 - 2026-09-14

- A new house on the Energy screen: the bundled placeholder, shown wherever no
  exterior picture of your own is assigned, is a modern family house with a
  solar roof, day and night.

## 0.18.6 - 2026-09-14

- Home, Shopping list and Reminders are the phone's default bottom tabs; a
  device with its own saved order keeps it.

## 0.18.5 - 2026-09-14

- The active tab's highlight on the phone encloses icon and label completely;
  on Energy and Shopping list the icon used to peek out at the top.

## 0.18.4 - 2026-09-14

- The phone's off button is all symbol: the power sign nearly fills it.
- The "off" safety prompt is off by default; it can be turned on under
  System → Interface & controls. Devices that already had it on keep it.

- The climate pill and "All quiet" stand at the left and right edge of the
  panel's footer again; in the published build they had crowded around the
  navigation.

## 0.18.3 - 2026-09-14

- The off button on the phone shows only its power symbol, without the word.

## 0.18.2 - 2026-09-14

- Phone controls now match the panel's footer exactly: the same dark frosted
  glass with light text and the amber highlight behind the active tab, in
  both themes. The taupe ground behind the room tiles stays.

## 0.18.1 - 2026-09-14

- Stronger contrast on the phone controls: darker text and icons on quick
  actions and the navigation pill, slightly denser glass, deeper amber for
  the active tab; dark mode lifted the same way.

## 0.18.0 - 2026-09-14

- A quieter phone home in the glass card style: the room tiles stand on a
  calm warm taupe ground instead of the panel's relief, and off, climate,
  holiday and the navigation pill share one matte frosted glass with dark
  warm text. The control rows sit closer to the tiles and a little more
  compact. Dark mode gets the same material in its dark form.

## 0.17.1 - 2026-09-14

- The phone navigation pill is frosted glass too, on every phone screen,
  matching the quick actions and the panel's footer pills.

## 0.17.0 - 2026-09-14

- The phone home stands on the same light or dark relief as "All rooms" on
  the panel; the quick actions row becomes frosted glass like the panel's
  footer pills, and the tiles shimmer through behind it.

## 0.16.1 - 2026-09-14

- Swiping down closes the room sheet on the phone again, even when the device
  list scrolls. As long as the list sits at the top, the drag pulls the sheet
  away; further down it scrolls the list.

## 0.15.0 - 2026-09-12

- The phone shopping list becomes a quiet checklist: smaller title, store
  names as compact headings with the count beside them, no separator lines.
  Every row is fully tappable with an empty circle on the left; a tap fills
  it, moves the item to "Done" at the bottom and offers "Undo" for five
  seconds. Each store ends in an "Add item" row that turns into the input and
  stays open for the next item. Sort and refresh are two icons at the top.
- The phone energy page tells a story: power now in watts, then the period
  with today's load curve and a comparison with yesterday up to the same
  time, then the top consumers with share bars. The period control moves
  below the live value; several plugs are called "Measured devices".

## 0.14.0 - 2026-09-11

- The layout menu offers a "View" pill: "Full screen" keeps the room picture
  and picker; "All rooms" shows every room as a tile beside a control surface
  that belongs entirely to scenes and devices. A tap on a tile selects the
  room; "Rooms per row" sets the tile columns.
- The layout menu itself has no title, "Apply" or "Cancel" any more: every
  setting takes effect at once. It stays on the right, flies in from there and
  leaves on a swipe to the right, a tap beside it or Escape; a swipe from
  right to left on the stage opens it. The second control surface is added at
  the bottom with a fixed room of its own.
- Swipe left on the control surface and it flies out of the picture, in
  "Full screen" and "All rooms" alike; the next touch anywhere brings it back.
- Phone home: the room grid scrolls and fades behind the quick actions;
  a swipe to the left pulls a side sheet in from the right, following the
  finger, with rooms per row (1 to 3) and a switch for the quick actions.
- Covers (blinds, shutters) are a household role now: the setup wizard hands
  them over into their rooms, several per room; the cover sheet is unchanged.
- Sensors without a symbol get one from their device class, unit or name:
  battery, temperature, humidity, power, energy, voltage and many more.
- The thermostat in the control surface is a device-size tile; a tap opens
  the thermostat sheet, a long press its settings (controls back in the
  surface, what the tile shows, step size). Kept in the surface, it is one
  light card at full width that never wraps.
- Sensor tiles show only their reading; a switch in the device sheet adds
  the name when needed.
- Horizontal swipes forgive a crooked finger and no longer break off into
  scrolling; a tile no longer pops when a scroll starts on it.

## 0.13.0 - 2026-09-10

- The device search in a room offers pills for the device types it can take,
  each with a count; one pill lists that type without typing anything.
- The stage now fades softly from room to room, not only when a room's last
  light goes out.
- The picture assistant and the picture catalogue carry new, drawn symbols that
  follow the light and dark themes.
- Scrollbars are gone everywhere; scrolling itself is unchanged.
- The climate card keeps target and current temperature side by side and
  shrinks the current value instead of breaking into two rows.
- The first tap on a device suggestion arrives instead of landing beside it.
- On a phone, the pairing card can open the app on the same device.

## 0.12.1 - 2026-09-10

- One damaged picture set no longer keeps the house from starting: the room
  falls back to its default picture and the log names what was skipped.
- The overcast variant of a room picture survives the phone derivation.

## 0.12.0 - 2026-09-09

- The quick action next to the temperature can carry any device: hold it to
  pick one, and its icon is suggested from the device.
- The bottom bar can be arranged from the More menu, which now lists every
  category instead of only the hidden ones.
- A swipe down closes a room and its editor from anywhere in it, and the
  device search lifts itself above the keyboard.
- The day theme stands on a warm off-white ground instead of a cool grey.
- Energy reads as a page, and the shopping list fits a 390 pixel phone again.
- The settings list sits evenly, loads one section at a time, and hides what
  cannot work without a Hauser server.
- The first tap after opening the app arrives instead of being dropped.
- The iPad's own status bar steps aside where Hauser draws its own header.
- The house hands its room pictures to devices without AVIF (`/api/app/hero`),
  so a watch can show the same picture as the wall.
- Rain and snow now fill the whole screen instead of only its upper part.
- The project page names what Hauser is before it shows the picture.
- The demo has a ceiling fan in the bedroom, so the fan panel can be tried.

## 0.11.0 - 2026-09-07

- Every device Home Assistant can control has its own second level: blinds
  and valves, vacuums, locks, humidifiers, water heaters, lawn mowers, alarm
  panels, numbers, selections and buttons. Thermostats show every mode they
  report. What the device does not report does not appear.

## 0.10.1 - 2026-09-07

- The project page now tells the story of the panel instead of listing
  features, with every screenshot retaken from the current default pictures.
- The demo opens quietly: no wizard card over the room, no empty camera tile,
  and the scribbled tips wait for the first touch.
- The demo home has solar on the roof: the energy picture carries all three
  notes and a day curve for generation and consumption.

## 0.10.0 - 2026-09-07

### Changed

- On the phone, a room tile shows the unlit night picture when no light is on
  in that room and the lit one as soon as a lamp burns — as the large stage
  already did, with the same slow fade when the last light goes out. The tiles
  keep loading the small phone-sized picture.

## 0.9.1 - 2026-09-07

### Added

- Fans get a full control panel: speed in percent, the preset modes the device
  reports, oscillation and direction of rotation. Only the abilities Home
  Assistant reports are shown.

### Changed

- A running fan turns: its symbol rotates on the tile and in the control
  panel, the tempo follows the speed. Reduced motion keeps it still.
- A dimmable lamp carries its brightness in the colour of its symbol, on the
  tile and in the control panel: full brightness glows, a low step stays
  muted, off remains grey.

### Fixed

- Hauser starts again on older processors and in virtual machines with a
  generic CPU: the image library's prebuilt binaries require x86-64-v2, and
  their failure to load stopped the whole add-on instead of only the room
  images. A portable fallback now ships alongside (#18).

## 0.9.0 - 2026-09-07

Everything between 0.8.2 and this release, as one update.

### Added

- The energy screen can show your own house: assign an image set to
  "Outside (energy)" in the image assistant or the library. Solar modules are
  detected and carry the generation figure; day and night fade at dusk.
- Press and hold the energy picture (configure mode) for a menu: own house,
  picture from the library, move the notes, sensor assignment.
- Notes and pins on the energy picture can be dragged into place and kept;
  Reset returns to the template. They always stay on screen.
- The workshop simulator drives the energy screen: generation and load
  sliders, presets, no-sensor cases.

### Changed

- Energy lives in the picture: no tiles, live figures as paper notes pinned to
  what they measure, the day's totals on the free wall.
- The day's line and the week, month and total sums come from Home Assistant
  statistics; nothing is invented.
- New built-in picture for the energy screen: a generic house from the garden,
  day and night.
- The calendar is a sheet of paper: current week large, empty weeks folded,
  all-day entries as paper notes, times in the calendar's colour, distinct
  papers per calendar, no refresh controls.
- A clock never goes out: without a configuration or a server the panel shows
  time, date and the coming days instead of imitating a dashboard.
- Losing the connection dims the controls instead of stacking a banner.
- No dashes where the house has nothing to measure.
- The settings fit on one screen: nine areas without scrolling.
- The consent line in the image assistant names the purpose instead of a call
  count.
- The ambient street map is on by default.

### Fixed

- The calendar tab and the standby week strip appear as soon as the connection
  stands, not after the first five-minute refresh.
- A house photo sent to "Outside (energy)" no longer turns into a room.
- The image assistant no longer reports a connected account when the ChatGPT
  sign-in has expired, and it names the reason a run stopped.
- The image assistant keeps its chosen target while pictures are generated.

## 0.8.2 - 2026-09-06

### Fixed

- The room editor opens again: a bundle chunk named like the room-image
  assets was answered with 404 by the asset route.

## 0.8.1 - 2026-09-06

### Fixed

- The App starts even when the room-image assistant's job store refuses to
  load; the assistant stays off, the health check names the reason, and the
  log names the offending job.

## 0.8.0 - 2026-09-06

### Added

- The room picture follows the weather: an overcast image variant per set,
  surfaces detected once per image set, rain and snow only inside the windows.
- Weather passes quietly through the standby screen.
- Undo after "everything off", scenes and climate changes; a switch without an
  echo pulses once.
- Presence and person: wake on motion, dark when everyone is away, a personal
  greeting for the first one home. Residents map to Home Assistant persons.
- Ambient light dims the interface with a brightness sensor.
- Hidden gestures: long-press the clock, triple-tap the logo for diagnostics.
- Calendar moments: birthdays, selected fixed days and the first snow.
- Dusk in real time around sunrise and sunset; light cones fade naturally.
- New default room pictures from a real household, by room name in every
  language.
- Cameras stream live over HLS; shopping stores can be Home Assistant to-do
  lists or a Notion page; companion-app pairing by QR code.

### Changed

- The outdoor weather uses the home location from Home Assistant; the
  interface no longer carries fixed city coordinates (#15).
- The room-image assistant chooses the room up front and reports through the
  notification centre.
- Weather, energy, camera stills and rules start from a snapshot; read routes
  answer with 304 via ETag; the server pre-computes overnight and reports a
  self-check.
- Failure states name their cause and offer a retry.

### Fixed

- Connecting no longer hangs forever after a resume (#15).
- The lamp-placement editor shows your own room picture (#16).
- The unlit night picture applies as soon as no lamp in the room is on.

## 0.7.0 - 2026-09-02

Includes the work that shipped with 0.6.3 but was missing from its notes.

### Added

- Notifications you configure yourself: eight categories, each holding rules
  with an entity, its states, a delay and thresholds. Home Assistant does the
  waiting and the triggering through three Hauser blueprints; Hauser keeps the
  automations in step, shows the tiles and the history, and gives every
  category its own colour. A test send shows what a rule will look like.
- Window contacts and motion detectors are connected: the status strip shows
  the real state and opens a list with one line per sensor and room. Which
  sensors count is selectable per room under Home.
- The energy page lists every power sensor Home Assistant reports; pick one
  source for generation and any number of consumers.
- An operate mode locks the configuration routes while devices stay fully
  operable, with an optional PIN and an idle return.
- Central climate control opens with a long press on the all-rooms pill, on the
  panel and on the phone.
- Paperless is set up in the interface instead of environment variables; the
  server picks up address and token without a restart.
- Sheets on the phone close by swiping their header down.
- Home and Energy keep separate widths for their control areas.

### Changed

- The bottom navigation on phones floats as a rounded pill above the content
  instead of sitting as a full-width bar.
- Panel and phone share one climate pill; on the phone it stands in a single
  row with the off and holiday actions.
- Room tiles read as calm cards: a weaker gradient that carries only the lower
  area, clearer titles and a crop rendered at its target size.
- The media area is off by default and marked experimental; the services page
  is arranged by module.
- Long device names shrink to fit instead of being cut off.
- The song workshop was removed. Installations that still list it start
  normally.

### Fixed

- A switched-off module now leaves the navigation immediately instead of on the
  next restart.
- The camera tile stayed empty in the add-on because the browser loaded the
  image from an address it could not reach. It is passed through the add-on's
  own server now, and generic cameras reload the still picture when their
  stream delivers no frame.
- A repeated test notification kept the old colour.
- The climate card broke out of a narrow sidebar.

## 0.6.3 - 2026-09-02

### Added

- Import a scene from Home Assistant: the scene editor lists your existing
  scenes and takes over their devices and states, so you do not have to rebuild
  them. The scene is applied once in the room to read its states back.
- Setup creates a room for a Home Assistant area that only carries a scene.

### Fixed

- A long press no longer flashes an empty panel on the right before the overlay
  opens.

## 0.6.2 - 2026-09-01

### Fixed

- The add-on could stay on "Connecting…" although it was already connected and
  values were updating. Home Assistant sometimes bundles several messages into
  one packet, and those bundles were being dropped — including the confirmation
  the app waits for. Bundles are now unpacked.

## 0.6.1 - 2026-09-01

### Added

- A subtle city map on the standby screen, off or on by your choice during
  setup. The place comes from Home Assistant, from a place search, from the
  device's location or from coordinates. Rendered once on the server; Deep Night
  shows no map.

### Changed

- Faster start: the real interface is mounted from a known-good configuration
  instead of a placeholder that is replaced moments later.
- Room pictures on phones are about a fifth of their previous size, and the
  offline cache shrank from roughly 17 MB to 3.5 MB. Existing image libraries
  migrate automatically on the first start after the update.
- Updates are offered with a quiet hint instead of reloading the app while it is
  in use. Idle wall panels still update on their own.
- Settings: "Appearance" and "Layout & controls" merged into "Interface &
  controls"; Hotel Mode and guest access moved to a new "Experimental" group.

### Note

Room image storage gains a new on-disk format in this version. The migration
runs automatically and is forward-only — downgrading to 0.6.0 after the update
leaves the image library unreadable.

## 0.6.0 - 2026-08-31

### Changed

- The App connects to Home Assistant itself. Setup no longer asks for a Home
  Assistant address or a Long-Lived Access Token: the App declares
  `homeassistant_api` and the Hauser server reaches Home Assistant Core over the
  internal Supervisor endpoints, while the browser gets live state through a
  same-origin WebSocket on the Hauser server. The Supervisor token stays inside
  the server process and is never written to `/data`, handed to the browser or
  logged.
- An installation that previously stored a Long-Lived Access Token has it
  removed from `/data/config.json` on the first start of this version.
- Setup ends by showing the exact address phones and tablets use, with a copy
  action and a QR code. The same address stays available under
  **System → Services**.

### Security

- The App's direct LAN port is documented as a trusted-network boundary: it
  carries no separate user login and no device pairing, and must not be
  published to the internet.

## 0.5.3 - 2026-08-31

### Added

- One shared climate control in the status bar and phone quick actions can set
  all configured thermostats together.

### Changed

- Phone thermostat controls distinguish current and target temperature more
  clearly, use their space more efficiently, and consistently show plus and
  minus buttons.
- Phone quick actions and optional room-editor state load only when needed.

### Fixed

- ChatGPT-subscription room-image generation uses the native Codex image-edit
  endpoint and reads its JSON image response.
- Manual room-image upload accepts an exact direct-LAN same-origin request such
  as `http://homeassistant.local:4173` while foreign origins remain rejected.
- Manual room-image upload errors follow the selected interface language.

## 0.5.2 - 2026-08-28

### Added

- Camera feeds can leave the control surface as movable, resizable pop-outs,
  follow their room or remain visible, hide their title bar, and return to the
  control surface.
- The room grid supports one to four rooms per row.

### Changed

- Home layout editing is an unblurred, right-hand mirrored drawer with a live
  continuous size control instead of three presets.
- Camera, climate and layout controls are localized in all six interface
  languages.
- The duplicate temperature heading and Safari install hint are removed.

### Fixed

- Saving reconfigured rooms refreshes the household cache before returning to
  the dashboard.

## 0.5.1 - 2026-08-28

### Added

- Scenes are configurable per device: which lights belong to a scene and what
  state each takes, previewed live while editing.
- Rooms can add, rename and delete their own scenes; the changes stay in that
  room, and the built-in scenes remain available everywhere.
- The scene the room currently stands at is highlighted — also when the lamps
  were set there by hand.
- Advanced room settings decide whether the room tile shows temperature and
  humidity, with the sensor taken from the Home Assistant area.
- The room-image assistant opens straight from the room overlay.

### Changed

- Configuration overlays share one look: a drag handle for order, a two-step
  delete, and a dashed tile for adding.
- The room editor opens on a quick-setup grid above the device list.

## 0.5.0 - 2026-08-27

### Added

- **Rooms & devices** shows every room with its image and device count, drags
  into order with a handle, and keeps configure, rename and delete in the row.
- Tapping a room's image opens the room-image editor directly.
- The room-image assistant and the image library sit in their own cards.

### Changed

- Versions drop the `-beta.N` suffix: every release below `1.0.0` is a beta.
- Settings open on **Rooms & devices**; returning within 30 seconds restores the
  section that was open.
- Resetting device names, scenes and the Home Assistant re-read is one card.

### Fixed

- The room-image card on the home screen can be switched off for good.
- Saving room changes in Settings is no longer blocked by an unverified
  Jellyfin sign-in.

## 0.4.0-beta.10 - 2026-08-26

### Added

- Rooms without a background show an onboarding card on the home screen:
  before/after, the three steps, and the choice between generating an image,
  picking one yourself, or dismissing the card.
- Rooms without devices show an **Add device** placeholder tile.
- The people on the pinboard can be renamed, added, and given a note colour.

### Changed

- The room-image assistant leads with the photograph. OpenAI access is only the
  first step when it is missing, cropping and zoom moved to the style-variant
  step, and the focus picker is gone — the generated sets already match the
  panel format.
- The standby button sits in the title bar by default.

### Fixed

- Every write of the room-image assistant was answered with `ORIGIN_FORBIDDEN`
  in the Home Assistant app, because the add-on can only configure the loopback
  origins while the browser reaches Hauser under the host's address. A request
  whose `Origin` matches its own effective origin exactly is now accepted as
  well; foreign origins, differing ports or protocols, and missing or duplicate
  `Origin` headers stay rejected.
- Room-image error messages appeared in German regardless of the interface
  language.
- A published image set could be marked expired without detaching its asset,
  which made the service refuse to start.

## 0.4.0-beta.9 - 2026-08-26

### Fixed

- The published container reported neither its revision nor the URL of its
  source at `/api/build-info` — the surface through which Hauser meets AGPL
  section 13. The release workflow never passed those values into the image
  build. Affected every image published since the license change, including
  `0.4.0-beta.7` and `0.4.0-beta.8`.

`0.4.0-beta.8` was tagged but never released; everything it contained is in
this version.

## 0.4.0-beta.8 - 2026-08-26

### Added

- Onboarding now puts Calendar and Notes into the navigation. Existing installs
  whose navigation is still the untouched onboarding result are migrated on
  load; a customized navigation is left alone. Reported in #8.
- Generated room-background sets have a library under Settings → Rooms &
  Devices: preview, size, creation date, assignment to a room, and deletion.
- Tapping a room under Rooms & Devices opens the same configuration overlay as
  a long press on the home screen. A long press on a device row moves it to
  another room.

### Fixed

- The room-image assistant did nothing when **Create variants** was pressed on
  a panel reached over plain `http://` — no request, no error. It works over
  `http://` now, and failures are shown above the action buttons.
- The dashboard and ambient clocks froze until a manual reload. They now
  resynchronize when the page is restored or the tab becomes visible.
  Reported in #8.
- Status & Updates listed hard-coded prototype services and updates instead of
  the connected instance. A productive install shows only its verified Home
  Assistant connection and genuine pending updates. Reported in #8.
- The floating power button no longer covers controls while System settings
  are open. Reported in #8.
- The connection indicator, the Safari install hint, and the room-image
  assistant are translated in all six languages; the ambient text keeps the
  selected language. Reported in #8.

### Changed

- The AI line on the lock screen is off by default on every install.

## 0.4.0-beta.7 - 2026-08-24

### Changed

- Hauser is now licensed under the GNU Affero General Public License (was MIT).
  Releases up to and including v0.4.0-beta.6 stay MIT. Nothing changes for
  people running Hauser at home. See the main
  [CHANGELOG](https://github.com/ralleur/hauser/blob/main/CHANGELOG.md)
  for the full reasoning.

### Fixed

- The setup wizard's reconfigure flow (Settings → Rooms & Devices) never sent
  the ETag preconditions the activation endpoint requires when reconfiguring,
  so **Save changes** silently failed every time and newly discovered rooms
  or devices reverted on leaving the screen. Reported in #7, reproduced on
  v0.4.0-beta.6 in #9.

## 0.4.0-beta.6 - 2026-08-21

### Fixed

- Setup activation no longer fails with `403 SETUP_REQUEST_FORBIDDEN` when the
  App is reached through a local hostname that isn't in the static allowed-
  origins list, such as `homeassistant.local:4173`. A direct browser request
  is now also accepted when its Origin exactly matches the effective request
  host. Reported in #8.

## 0.4.0-beta.5 - 2026-08-16

### Fixed

- The setup wizard now discovers switches and media players. Switches were
  previously dropped entirely, and media players never became media targets.
  Several switches in one room no longer collapse into a single entry.
  Reported in #7.

### Added

- Vacuums appear as a start / return-to-base control. Built against Home
  Assistant's documented `vacuum` services, not yet verified on real hardware.

## 0.4.0-beta.4 - 2026-08-16

### Fixed

- The App no longer fails to start with `RUNTIME_DIRECTORY_NOT_WRITABLE` on
  `/data/assets`. The entrypoint now creates every directory listed in
  `HMI_REQUIRED_WRITABLE_DIRS` before dropping privileges. Reported in #6.
- Startup diagnostics in the Supervisor log are in English.

## 0.4.0-beta.3 - 2026-08-11

### Fixed

- Home Assistant OS now prepares the App-owned `/data` directory before Hauser
  drops to its unprivileged runtime user.

## 0.4.0-beta.2 - 2026-08-11

### Added

- Experimental Home Assistant App metadata for installing Hauser from this repository on Home Assistant OS.
- Direct-port App documentation, persistent `/data` mapping and cold-backup declaration.

### Changed

- Direct browser requests whose valid Origin exactly matches the effective Hauser HTTP host and port can use setup and configuration writes without a preconfigured static LAN hostname.
- Release automation publishes `0.4.0-beta.2` and `v0.4.0-beta.2` as aliases of the same multi-architecture manifest.

`v0.4.0-beta.1` remains unchanged.
