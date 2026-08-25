# Changelog

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
