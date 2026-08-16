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

# The Home Assistant Supervisor pulls "<image>:<version>" from the App
# manifest. A manifest version without a matching published image leaves the
# add-on uninstallable, so it is pinned to the release version here rather than
# maintained by hand.
# The manifest carries a .yaml name with JSON content, so it is parsed rather
# than require()d — require resolves by extension and would reject it.
addon_manifest_field() {
  node -p "JSON.parse(require('fs').readFileSync('./hauser/config.yaml','utf8')).$1"
}
addon_version="$(addon_manifest_field version)"
if [[ "$addon_version" != "$version" ]]; then
  printf 'App manifest version mismatch: package=%s hauser/config.yaml=%s\n' \
    "$version" "$addon_version" >&2
  exit 1
fi

addon_image="$(addon_manifest_field image)"
if [[ "$addon_image" != "ghcr.io/ralleur/hauser" ]]; then
  printf 'App manifest points at an unexpected image: %s\n' "$addon_image" >&2
  exit 1
fi

# Every directory the readiness check requires must also be one the entrypoint
# creates. /data/assets was required by the manifest but never created, which
# made the App fail to start with RUNTIME_DIRECTORY_NOT_WRITABLE.
python3 - <<'PY'
import json
from pathlib import Path

manifest = json.loads(Path('hauser/config.yaml').read_text())
required = [d.strip() for d in manifest['environment']['HMI_REQUIRED_WRITABLE_DIRS'].split(',') if d.strip()]
entrypoint = Path('container/start.mjs').read_text()
if 'HMI_REQUIRED_WRITABLE_DIRS' not in entrypoint:
    raise SystemExit('container/start.mjs must derive its directories from HMI_REQUIRED_WRITABLE_DIRS.')
if not required:
    raise SystemExit('App manifest declares no writable directories.')
print(f'addon_writable_dirs={",".join(required)}')
PY

if grep -Eq "^## \[${version//./\\.}\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md; then
  python3 - <<'PY'
from pathlib import Path

files = [
    Path('CHANGELOG.md'),
    Path('README.md'),
    Path('ROADMAP.md'),
    Path('docs/07-configuration.md'),
    Path('docs/08-installation.md'),
    Path('docs/09-dev-pilot.md'),
    Path('website/index.html'),
]
stale = [
    'has not been tagged',
    'no registry image has been published',
    'No registry image, public repository, Git tag or GitHub release exists',
    'No published registry image until',
    'first public beta does not exist',
    'preparing its first public technical beta',
    'installable technical-beta candidate',
    'first public release will be',
    'unpublished candidate',
    'public pre-beta path',
    'technically oriented pre-beta',
    'before the public beta',
    'before public beta',
]
findings = []
for path in files:
    text = path.read_text()
    for phrase in stale:
        if phrase.lower() in text.lower():
            findings.append(f'{path}: {phrase}')
if findings:
    raise SystemExit('Stale pre-release claims remain:\n' + '\n'.join(findings))
print('release_day_claims=match')
PY
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

printf 'release_version=%s\npackage_lock=match\ndocker_metadata=match\nchangelog=match\naddon_manifest=match\n' "$version"
if [[ -n "$expected_tag" ]]; then
  printf 'release_tag=%s\n' "$expected_tag"
fi
