# Changelog

All notable user-visible changes to Hauser are documented here. The project uses
Semantic Versioning for its public release line.

## [Unreleased]

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
