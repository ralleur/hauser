# Changelog

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
