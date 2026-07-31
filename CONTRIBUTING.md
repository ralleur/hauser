# Contributing to Hauser

Thanks for considering a contribution. Hauser is an installable technical beta
built and maintained as a personal open-source project. The goal of the beta is
not to collect every possible feature; it is to make installation, onboarding,
operation and the advertised core experience work reliably in more homes.

There is no SLA and response times can vary. That said, focused contributions
are explicitly welcome and will be reviewed as maintainer capacity allows.

## Good ways to contribute during the beta

The most useful contributions currently are:

- **Installation reports** from real Linux, Docker Engine, `linux/amd64` and
  `linux/arm64` environments.
- **Home Assistant topology findings** involving Areas, entity names,
  capabilities, reconnects or optional integrations.
- **Small bug fixes** for setup, migration, persistence, recovery and advertised
  controls.
- **Documentation improvements** that remove ambiguity from installation,
  onboarding, backup, restore or rollback.
- **Translation reviews** for French, Italian, Portuguese and Polish by native
  speakers.
- **Accessibility fixes** for keyboard navigation, focus, contrast and reduced
  motion.
- **Tests and release tooling** that make failures reproducible.

Use the issue chooser to open a bug report, installation report,
documentation/translation report or contribution proposal. Issues may be written
in English or German.

## Before writing code

A small, self-contained fix can go straight to a pull request. Open a
contribution proposal first when the change involves any of these:

- a new integration or framework;
- an architecture or configuration-contract change;
- a broad UX redesign;
- new persistent data or a migration;
- a dependency with runtime impact;
- work spanning several product areas.

This avoids investing in a direction that does not fit the current beta scope.
Look for issues labelled [`good first issue`](https://github.com/ralleur/hauser/labels/good%20first%20issue)
or [`help wanted`](https://github.com/ralleur/hauser/labels/help%20wanted) if you
want a pre-scoped starting point.

## Local setup

Requirements:

- Node.js 24
- npm
- Docker Engine with Compose only when changing installation/container paths

```bash
git clone https://github.com/ralleur/hauser.git
cd hauser/app
npm ci
npm test
npm run check
npm run build
```

Run `npm run build:demo` as well when changing user-visible UI, fixtures, routing
or public presentation. The pull-request workflow repeats tests, typecheck,
production/demo builds, dependency audit and the container contract. Maintainers
can run the complete local package gate, including both bundles, public-boundary
checks and the disposable container lifecycle, with:

```bash
./scripts/verify-public-package.sh
```

For a full installation rather than frontend development, follow
[`docs/08-installation.md`](docs/08-installation.md). The isolated synthetic Home
Assistant environment is documented in [`docs/09-dev-pilot.md`](docs/09-dev-pilot.md).

## Pull-request expectations

Keep pull requests small enough to understand and verify. A good PR includes:

1. the user-visible problem or reason for the change;
2. a focused implementation without unrelated refactoring;
3. the exact commands that were run and their result;
4. tests for changed behaviour where a stable automated seam exists;
5. screenshots or a short recording for visible UI changes;
6. migration, rollback or security notes when those contracts are affected.

Match the surrounding style and use the existing design tokens. Do not add raw
colour, spacing, radius or motion values when a token exists. Commit messages
follow [Conventional Commits](https://www.conventionalcommits.org/).

## Project boundaries

Changes are unlikely to be accepted when they:

- replace the current framework or architecture without a proven release blocker;
- add an integration that cannot be tested or safely degraded;
- weaken fail-closed configuration, credential or privacy boundaries;
- regress the interaction or performance budgets;
- add abstraction only for hypothetical future work;
- turn the beta stabilisation phase into an unbounded feature stream.

The active boundaries are documented in
[`docs/00-architecture.md`](docs/00-architecture.md),
[`docs/02-interaction-contract.md`](docs/02-interaction-contract.md) and
[`docs/03-performance-budget.md`](docs/03-performance-budget.md).

## Language and translations

The interface ships in German, English, French, Italian, Portuguese and Polish.
Message catalogues live in `app/messages/`. Public documentation and
contributor-facing prose are in English; existing inline code comments may still
be German.

For a translation correction, preserve message placeholders and run the normal
checks. A native-language review is more valuable than mechanically rewriting an
entire catalogue.

## Security and privacy

Do not put real access tokens, private hostnames, household data or unredacted
logs in an issue or pull request. Report vulnerabilities privately as described
in [`SECURITY.md`](SECURITY.md).

## Licensing and conduct

There is no CLA. By opening a pull request, you agree that contributions to
source code, tests, scripts, configuration examples, design tokens and technical
documentation are licensed under the [MIT license](LICENSE). Original visual
assets added to the paths listed in [ASSETS-LICENSE.md](ASSETS-LICENSE.md) are
contributed under CC BY 4.0.

The Hauser name and official branding are governed by
[TRADEMARKS.md](TRADEMARKS.md). Do not add or replace logos, app icons, brand
marks or the favicon without prior maintainer agreement. New third-party assets
must permit redistribution and include their exact license and attribution in
`NOTICE` or alongside the asset.

CI runs `./scripts/verify-license-boundary.sh`. New visual asset paths fail this
check until they are deliberately classified as CC BY artwork, reserved project
branding or third-party material. This prevents newly added files from silently
falling into the wrong license class.

Be decent to people. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
