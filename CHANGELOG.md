# Changelog

All notable user-visible changes to Hauser are documented here. The project uses
Semantic Versioning for its public release line.

## [0.4.0-beta.3] - 2026-08-11

### Fixed

- Home Assistant OS now starts Hauser through a minimal runtime wrapper that
  assigns the App-owned `/data` tree to UID/GID 1000 and immediately drops root
  privileges before importing the unchanged server.
- Docker/Compose continues to run explicitly as the unprivileged `node` user.

### Known limitations

- The focused real Home Assistant OS smoke resumes from the previously failed
  start step after publication of this immutable follow-up beta.

## [0.4.0-beta.2] - 2026-08-11

### Added

- Experimental Home Assistant App packaging in the public repository, including
  direct-port metadata, persistent `/data` mapping, cold-backup behavior,
  App Store branding and one-click/fallback installation guidance.
- A dependency-free local App contract verifier and a commit-pinned Home
  Assistant App linter in the quality workflow.

### Changed

- Browser requests with a syntactically valid Origin are accepted when that
  Origin exactly matches the effective direct HTTP request host and port. Exact
  `HMI_ALLOWED_ORIGINS` entries remain supported for TLS reverse proxies.
- Release automation publishes both `0.4.0-beta.2` and `v0.4.0-beta.2` from the
  same multi-architecture build manifest.
- Docker/Compose remains supported and now defaults to `v0.4.0-beta.2`.

### Known limitations

- The real HAOS installation succeeded, but App start failed because the
  Supervisor-mounted `/data` directory was not writable by UID 1000. This release
  remains immutable; `0.4.0-beta.3` carries the narrow ownership fix.
- Direct App access intentionally does not use Ingress or a Supervisor token.

`v0.4.0-beta.1` and its published artifacts remain unchanged.

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
