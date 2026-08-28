# Changelog

All notable user-visible changes to Hauser are documented here. The project uses
Semantic Versioning for its public release line.

## [Unreleased]

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
