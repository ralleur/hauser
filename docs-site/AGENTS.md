# Maintaining the Hauser wiki

This folder is the Hauser wiki: an [Astro Starlight](https://starlight.astro.build/)
site published at <https://ralleur.github.io/hauser/docs/>. It is the user and
developer documentation of the project and is often maintained by AI coding
agents. Follow these rules.

## Build and check

```bash
cd docs-site
npm ci
npm run build      # fails on a broken internal link
npm run dev        # local preview
```

Run the build before every commit that touches `docs-site/`.

## Rules

1. **Document the code, not the plan.** Verify every statement against the
   source under `app/` before writing it. Planned or removed functionality is
   named as such or left out. Never document a planned feature as available.
2. **Search before you add.** Look for an existing page (`grep -ril <topic>
   src/content/docs`) and update it. Do not create duplicates.
3. **Keep the sidebar tidy.** Pages live in one of six folders: `overview`,
   `getting-started`, `using`, `integrations`, `reference`, `developers`.
   Order inside a folder comes from `sidebar.order` in the frontmatter.
4. **Links.** Internal links start with `/hauser/docs/` and end with a slash,
   for example `/hauser/docs/using/rooms/`. Astro does not add the base path to
   Markdown links, and the build validates every link. Screenshots are
   referenced from the website as `/hauser/media/<file>.webp`; do not copy
   large images into this folder.
5. **Style.** Plain words, short paragraphs, one idea per sentence. No
   marketing. Tables for references, `:::note` / `:::tip` / `:::caution`
   asides for warnings. Say what the feature is for (the idea), then how to use
   it. Every page needs `title` and `description` in the frontmatter.
6. **No secrets, no private data.** Use placeholders such as `YOUR_API_KEY`.
   No real hostnames, entity IDs or personal names.
7. **Screenshots** change only when the interface changed visibly. If a
   screenshot would help and none exists, write `TODO: screenshot of ...`
   as a Markdown comment, do not invent one.
8. **Configuration reference.** When an environment variable, file, port or
   App option changes, update `reference/configuration.md` in the same change.
9. **Feature list.** A new user-visible feature gets a line in
   `overview/features.md` and a section on the matching page.

## Where things belong

| Change in the source | Update |
|---|---|
| `app/src/lib/screens/HomeScreen.svelte`, `HomeRoomGrid`, `RoomControls`, layout menu | `using/home-screen.md` |
| Rooms, room editor, `RoomsDevicesSection`, `RoomListEditor` | `using/rooms.md` |
| `DeviceTile`, `DeviceDetail`, adapter command mapping | `using/devices.md` |
| `SceneEdit`, scene state | `using/scenes.md` |
| `ClimateCard`, `ClimatePill`, `CentralClimate*` | `using/climate.md` |
| `AmbientLayer`, `ambient*.ts`, `AmbientSection` | `using/standby.md` |
| `AppearanceSection`, `appearance-mode.ts`, card style | `using/appearance.md` |
| `edit-mode*.ts`, `EditModeSection`, `ModeToggle` | `using/edit-and-use-mode.md` |
| `components/phone/*` | `using/phone.md` |
| `SecuritySensorsSection` | `using/windows-and-motion.md` |
| `NotificationsSection`, `LaundrySection`, `server/notification-rules.mjs`, `server/laundry.mjs` | `using/notifications.md` |
| persons, `moments`, presence | `using/presence-and-moments.md` |
| `EnergyScreen`, `EnergyModuleConfig`, `server/energy-week.mjs` | `using/energy.md` |
| `CalendarScreen`, `CalendarSection` | `using/calendar.md` |
| `ShoppingSection`, `server/shopping-notion.mjs`, phone shopping | `using/shopping-list.md`, `integrations/notion.md` |
| reminders, `server/family-data.mjs` | `using/reminders-and-notes.md` |
| `CameraFeed`, `CameraPopout` | `using/cameras.md` |
| `MediaScreen`, `LibraryScreen`, `MediaSection` | `using/media.md`, `integrations/jellyfin.md` |
| `AblageScreen`, `server/ablage.mjs`, `PaperlessConfig` | `using/documents.md`, `integrations/paperless.md` |
| `RoomImageWizard`, `RoomImageLibrary`, `server/room-image*.mjs` | `using/room-images.md`, `integrations/openai.md` |
| `settings-registry.ts` | `using/settings.md` |
| `Hotel*`, `server/hotel-mode.mjs` | `using/hotel-mode.md` |
| `app/messages/` | `using/languages.md`, `developers/translations.md` |
| `server/ha-gateway.mjs`, `ha-supervisor.mjs`, adapter | `integrations/home-assistant.md` |
| `server/ambient-map*.mjs` | `integrations/openstreetmap.md` |
| `server/weather.mjs` | `integrations/open-meteo.md` |
| `server/pairing.mjs`, `PairingCard` | `integrations/companion-app.md` |
| `server/remote.mjs`, `tools/tunnel/`, `RemoteCard` | `integrations/remote-access.md` |
| `server/runtime-env.mjs`, `compose.yaml`, `hauser/config.yaml`, `.env.example` | `reference/configuration.md` |
| `app/src/lib/config/household-config*.ts` | `reference/household-config.md` |
| `server/api-contract.mjs`, health, build info | `reference/api.md` |
| `Dockerfile`, `container/`, `scripts/`, `hauser/DOCS.md` | `getting-started/*.md`, `getting-started/updates-and-backups.md` |
| `.github/workflows/` | `developers/release-process.md` |
| `package.json` scripts, tests | `developers/tests-and-checks.md`, `developers/setup.md` |

A prompt such as "Document the new thermostat scheduling feature" therefore
lands in `using/climate.md`, plus a line in `overview/features.md` and, if a
setting was added, a row in `using/settings.md`.

## Site structure

- `astro.config.mjs` – site, base path, sidebar groups, plugins.
- `src/content/docs/` – the pages.
- `src/styles/custom.css` – the light Hauser accent.
- `src/assets/hauser-icon.svg`, `public/favicon.png` – brand.
- The build output goes to `dist/` and is copied to `.pages/docs/` by
  `scripts/build-pages.sh`, next to the website and the demo.
