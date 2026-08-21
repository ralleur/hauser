# Changelog

All notable user-visible changes to Hauser are documented here. The project uses
Semantic Versioning for its public release line.

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
