---
title: Release process
description: How a version becomes an image and an App update.
sidebar:
  order: 6
---

Releases are small and frequent. Every release below `1.0.0` is a beta; there is no `-beta.N` suffix.

## What a release needs

- `app/package.json` and `package-lock.json` carry the version.
- `hauser/config.yaml` carries the same version. The release gate refuses drift.
- `CHANGELOG.md` has a dated entry.
- A Git tag `v<version>` on the public repository.

## What the workflow does

`quality-and-release.yml` runs on every push and pull request: dependency audit, licence boundary, production and demo builds, tests, type check, the container contract and an upgrade smoke test from the previous release.

On a version tag it also publishes the multi-architecture image to `ghcr.io/ralleur/hauser` as `v<version>` and `<version>`. The Home Assistant Supervisor resolves the plain version from the App manifest, so the App update appears once the image exists.

## Landing page and wiki

`pages.yml` builds the website, the demo and this wiki into one GitHub Pages artifact. It is dispatched by the maintainer after a release.

## Versioning

Patch for fixes, minor for visible changes. Trunk based: fixes ship with the next release from `main`.
