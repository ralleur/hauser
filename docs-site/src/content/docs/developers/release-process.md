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

## Signed Android APK

Android has an independent version in `android/version.json`; use `android/bump-version.py` to increase the name and monotonically increasing code. `android/build.py` builds with pinned Android SDK tools and ZXing Core, then checks the production signing certificate, manifest and APK hash. It never generates a replacement key. Keep the encrypted keystore and a recoverable password backup outside source control.

`android/prepare-release.py` stages only the checked signed APK, its checksum and metadata in `website/downloads/`, and generates English and German installation pages. Keep those versioned downloads in source so later website promotions retain them. Source tags use `android-v<version>`. Publish the matching APK and checksum as GitHub prerelease assets as well. Never replace a published APK under the same version name/code.

Run the focused device matrix, pairing/socket/command/restart/revocation checks and public license/privacy gates before publication. Deploy the website with the existing `pages.yml` workflow. Download the actual website artifact afterwards, compare its hash and signing certificate, inspect its version, then install it as an update on a dedicated test device.

When a companion release needs a server change, use the existing server release order: build and verify the tagged multi-architecture image before moving `main`, pass `main` quality, then dispatch Pages for that same commit. Updating a personal Home Assistant host is a separate operation.
