# Changelog

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
