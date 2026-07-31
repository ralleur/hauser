#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$#" -ne 0 ]]; then
  printf 'Usage: %s\n' "$0" >&2
  exit 64
fi

for command in git node npm docker python3; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Required command is missing: %s\n' "$command" >&2
    exit 69
  }
done

docker compose version >/dev/null

revision="$(git rev-parse --verify HEAD)"
version="$(node -p 'require("./app/package.json").version')"
dirty=no
[[ -n "$(git status --porcelain)" ]] && dirty=yes

printf 'candidate_revision=%s\ncandidate_version=%s\nworking_tree_dirty=%s\n' \
  "$revision" "$version" "$dirty"

./scripts/verify-release-metadata.sh
./scripts/verify-license-boundary.sh
git diff --check

python3 - <<'PY'
from pathlib import Path
import re
import sys

private_paths = [
    Path('app/src/lib/components/ai'),
    Path('app/src/lib/state/ai-customizing.ts'),
    Path('app/src/lib/state/ai-customizing.svelte.ts'),
    Path('app/src/lib/state/ai-customizing.test.ts'),
]
unexpected = [str(path) for path in private_paths if path.exists()]
if unexpected:
    raise SystemExit(f'Private AI-customizing sources are present: {unexpected}')

capability = Path('app/src/lib/config/product-capabilities.ts').read_text()
if 'AI_CUSTOMIZING_ENABLED = false' not in capability:
    raise SystemExit('Public product capability does not disable AI customization.')

for path in (Path('Dockerfile'), Path('compose.yaml'), Path('compose.dev.yaml')):
    if 'HMI_AI_CUSTOMIZING_ENABLED' not in path.read_text():
        raise SystemExit(f'{path} does not pin the public AI-customizing boundary.')

markdown = [
    Path('README.md'),
    Path('ROADMAP.md'),
    Path('CONTRIBUTING.md'),
    Path('SECURITY.md'),
    Path('ASSETS-LICENSE.md'),
    Path('TRADEMARKS.md'),
]
markdown.extend(sorted(Path('docs').glob('*.md')))
missing = []
for path in markdown:
    text = path.read_text()
    for match in re.finditer(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', text):
        target = match.group(1).split('#', 1)[0]
        if not target or '://' in target or target.startswith('mailto:'):
            continue
        if not (path.parent / target).resolve().exists():
            missing.append((str(path), target))
if missing:
    for source, target in missing:
        print(f'Missing local link: {source} -> {target}', file=sys.stderr)
    raise SystemExit(1)

forms = sorted(Path('.github/ISSUE_TEMPLATE').glob('*.yml'))
if len(forms) < 5:
    raise SystemExit('Expected public issue-form inventory is incomplete.')

print(f'private_capability_boundary=PASS')
print(f'local_markdown_links={len(markdown)} files PASS')
print(f'community_yaml_inventory={len(forms)} files PASS')
PY

npm ci --prefix app
npm audit --prefix app --omit=dev --audit-level=high
npm test --prefix app
npm run check --prefix app
npm run build --prefix app
npm run build:demo --prefix app
./scripts/build-pages.sh
npm run performance:budget --prefix app

python3 - <<'PY'
from pathlib import Path

forbidden = [
    'AI-Anpassung',
    'Neues Feature',
    'Rollback macht alle Commits',
    'Die Änderung ist live',
    'Feature-Verlauf',
    '/hermes/v1/runs',
]
for root in (Path('app/dist'), Path('app/dist-demo'), Path('app/dist-pages-demo')):
    text = '\n'.join(path.read_text(errors='ignore') for path in root.rglob('*.js'))
    found = {term: text.count(term) for term in forbidden if term in text}
    if found:
        raise SystemExit(f'Private AI-customizing strings in {root}: {found}')
print('public_bundle_private_customizing=ABSENT')
PY

repository="hauser-source"
tag="candidate-$$"
image="${repository}:${tag}"
cleanup() {
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

HAUSER_SOURCE_TAG="$tag" docker compose \
  -f compose.yaml \
  -f compose.build.yaml \
  build --pull=false hauser

HAUSER_IMAGE_REPOSITORY="$repository" ./scripts/verify-container.sh "$tag"

printf 'public_package_preflight=PASS\nworking_tree_dirty=%s\n' "$dirty"
if [[ "$dirty" == yes ]]; then
  printf '%s\n' 'NOTE: Package contents passed, but this is not a releasable commit until the tree is committed, pushed and remote CI is green.'
fi
