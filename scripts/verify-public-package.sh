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

blueprint = Path('app/public/blueprints/automation/laundry-power-cycle-v1.yaml')
if not blueprint.is_file() or blueprint.stat().st_size == 0:
    raise SystemExit(f'Missing required non-empty laundry blueprint: {blueprint}')

try:
    blueprint_text = blueprint.read_text(encoding='utf-8')
except UnicodeDecodeError as error:
    raise SystemExit(f'Laundry blueprint is not UTF-8 text: {blueprint}: {error}') from error

blueprint_lines = blueprint_text.splitlines()
if not blueprint_lines or blueprint_lines[0] != '# SPDX-License-Identifier: MIT':
    raise SystemExit('Laundry blueprint must start with the exact MIT SPDX header.')
if '# Version: 1' not in blueprint_lines:
    raise SystemExit('Laundry blueprint does not declare the required # Version: 1 contract.')

# Ignore comments and empty lines for the structural contract, but preserve YAML
# indentation. This intentionally validates the narrow canonical Blueprint shape
# without adding a YAML package (and therefore without accepting arbitrary YAML).
blueprint_contract = '\n'.join(
    line.rstrip()
    for line in blueprint_lines
    if line.strip() and not line.lstrip().startswith('#')
)
if not re.search(r'(?m)^blueprint:\n(?:  .+\n)*?  domain: automation$', blueprint_contract):
    raise SystemExit('Laundry blueprint does not declare blueprint.domain: automation.')

states = {
    state
    for state in ('idle', 'running', 'done')
    if re.search(rf'\b{state}\b', blueprint_contract)
}
if states != {'idle', 'running', 'done'}:
    raise SystemExit(
        'Laundry blueprint state vocabulary is incomplete; expected idle/running/done, '
        f'found {sorted(states)}.'
    )

running_to_done_guard = '''      - conditions:
          - condition: trigger
            id:
              - done
          - condition: state
            entity_id: !input state_helper
            state: running
        sequence:
          - action: input_select.select_option
            target:
              entity_id: !input state_helper
            data:
              option: done'''
if running_to_done_guard not in blueprint_contract:
    raise SystemExit(
        'Laundry blueprint lacks the canonical done-trigger + state_helper=running '
        'guard before selecting done.'
    )

running_transition = '''      - conditions:
          - condition: trigger
            id:
              - running
        sequence:
          - action: input_select.select_option
            target:
              entity_id: !input state_helper
            data:
              option: running'''
if running_transition not in blueprint_contract:
    raise SystemExit('Laundry blueprint lacks the canonical running transition.')

private_blueprint_patterns = {
    'private/local IPv4 address': re.compile(
        r'(?<!\d)(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|'
        r'169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|'
        r'192\.168(?:\.\d{1,3}){2})(?!\d)'
    ),
    'URL': re.compile(r'https?://', re.IGNORECASE),
    'email address': re.compile(r'\b[^\s@]+@[^\s@]+\.[^\s@]+\b'),
    'absolute user-home path': re.compile(r'/(?:Users|home)/'),
    'secret/token material': re.compile(
        r'(?:!secret\b|\b(?:access[_-]?token|api[_-]?key|password|client[_-]?secret)\b)',
        re.IGNORECASE,
    ),
}
for label, pattern in private_blueprint_patterns.items():
    if match := pattern.search(blueprint_text):
        line_number = blueprint_text.count('\n', 0, match.start()) + 1
        raise SystemExit(f'Laundry blueprint contains {label} at line {line_number}.')

allowed_entity_inputs = {'!input power_sensor', '!input state_helper'}
for line_number, line in enumerate(blueprint_lines, 1):
    match = re.match(r'^\s*(?:-\s*)?entity_id:\s*(.+?)\s*$', line)
    if match and match.group(1) not in allowed_entity_inputs:
        raise SystemExit(
            f'Laundry blueprint contains a concrete or unknown entity_id at line {line_number}.'
        )

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
if 'ROOM_IMAGE_WIZARD_ENABLED = true' not in capability:
    raise SystemExit('Public product capability does not enable room-image generation.')

for path in (Path('Dockerfile'), Path('compose.yaml'), Path('compose.dev.yaml')):
    if 'HMI_AI_CUSTOMIZING_ENABLED' not in path.read_text():
        raise SystemExit(f'{path} does not pin the public AI-customizing boundary.')

for path in (Path('compose.yaml'), Path('compose.dev.yaml')):
    if 'HMI_ROOM_IMAGE_AUTH_MODE: direct' not in path.read_text():
        raise SystemExit(f'{path} does not pin the same-origin room-image boundary.')

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
print('laundry_blueprint_required_artifact=PASS')
print('laundry_blueprint_contract=MIT/version-1/automation/idle-running-done/running-to-done-guard PASS')
print('laundry_blueprint_private_data=ABSENT')
print(f'local_markdown_links={len(markdown)} files PASS')
print(f'community_yaml_inventory={len(forms)} files PASS')
PY

npm ci --prefix app
npm audit --prefix app --omit=dev --audit-level=high
npm run build --prefix app
npm test --prefix app
npm run check --prefix app
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
