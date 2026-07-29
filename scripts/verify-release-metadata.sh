#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

version="$(node -p 'require("./app/package.json").version')"
lock_version="$(node -p 'require("./app/package-lock.json").version')"
lock_root_version="$(node -p 'require("./app/package-lock.json").packages[""].version')"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  printf 'Invalid semantic version in app/package.json: %s\n' "$version" >&2
  exit 1
fi

for candidate in "$lock_version" "$lock_root_version"; do
  if [[ "$candidate" != "$version" ]]; then
    printf 'Package metadata mismatch: package=%s lock=%s\n' "$version" "$candidate" >&2
    exit 1
  fi
done

if ! grep -Fqx "ARG HAUSER_VERSION=${version}" Dockerfile; then
  printf 'Dockerfile HAUSER_VERSION does not match package version %s.\n' "$version" >&2
  exit 1
fi

if ! grep -Eq "^## \[${version//./\\.}\] - (Unreleased|[0-9]{4}-[0-9]{2}-[0-9]{2})$" CHANGELOG.md; then
  printf 'CHANGELOG.md has no valid entry for %s.\n' "$version" >&2
  exit 1
fi

test -s docs/release-notes-template.md

expected_tag="${1:-}"
if [[ -n "$expected_tag" ]]; then
  if [[ "$expected_tag" != "v${version}" ]]; then
    printf 'Release tag mismatch: expected v%s, got %s.\n' "$version" "$expected_tag" >&2
    exit 1
  fi
  if ! grep -Eq "^## \[${version//./\\.}\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md; then
    printf 'Tagged release %s requires a dated changelog entry.\n' "$expected_tag" >&2
    exit 1
  fi
fi

printf 'release_version=%s\npackage_lock=match\ndocker_metadata=match\nchangelog=match\n' "$version"
if [[ -n "$expected_tag" ]]; then
  printf 'release_tag=%s\n' "$expected_tag"
fi
