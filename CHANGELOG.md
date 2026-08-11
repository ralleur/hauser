# Changelog

All notable user-visible changes to Hauser are documented here. The project uses
Semantic Versioning for its public release line.

## [0.4.0-beta.1] - 2026-08-10

This is Hauser's first public technical beta. It remains a self-hosted hobby
project without a support or compatibility promise beyond the documented paths.

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
- Public Pages demo with representative simulated devices and no dependency on
  the maintainer's Home Assistant or household services.
- English first-visit README with current candidate screenshots, a prominent
  demo link and the release installation/setup path.
- Tag-gated quality and container-image workflow. A matching version tag can
  publish immutable `linux/amd64` and `linux/arm64` images to GHCR only after the
  full quality job passes.

### Changed

- The Home Assistant adapter now recovers entity state correctly after a lost
  and restored connection.
- Setup activation distinguishes a rejected Home Assistant token from Home
  Assistant being unreachable from the Hauser server/container and from an
  unsuccessful Home Assistant or proxy HTTP response.
- Configured Home Assistant entities that are missing or reported unavailable
  retain their last known value only as context, are marked unavailable and
  cannot be controlled.
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
