#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
from pathlib import Path
import hashlib

required = [
    Path('LICENSE'),
    Path('COPYRIGHT'),
    Path('CLA.md'),
    Path('ASSETS-LICENSE.md'),
    Path('TRADEMARKS.md'),
    Path('NOTICE'),
]
missing = [str(path) for path in required if not path.is_file() or path.stat().st_size == 0]
if missing:
    raise SystemExit(f'Missing required license files: {missing}')

license_bytes = Path('LICENSE').read_bytes()
license_sha256 = hashlib.sha256(license_bytes).hexdigest()
expected_agpl_sha256 = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0'
if license_sha256 != expected_agpl_sha256:
    raise SystemExit('LICENSE is not the unchanged GNU AGPL-3.0 license text.')

# AGPL section 13 only works if the running instance can show its own license.
# The copy below app/public/ is what the built frontend serves same-origin, so
# it must be byte-identical to the project LICENSE.
served_license = Path('app/public/legal/agpl-3.0.txt')
if not served_license.is_file():
    raise SystemExit(f'Missing in-app license text served with the build: {served_license}')
if hashlib.sha256(served_license.read_bytes()).hexdigest() != expected_agpl_sha256:
    raise SystemExit(f'{served_license} is not the unchanged GNU AGPL-3.0 license text.')

copyright_text = Path('COPYRIGHT').read_text(encoding='utf-8')
# The project notice must declare the current license, keep the project
# copyright separate from the FSF's copyright on the license document, and
# never re-assert a superseded license identifier.
for phrase in (
    'SPDX-License-Identifier: AGPL-3.0-only',
    'Free Software Foundation',
    'CLA.md',
):
    if phrase not in copyright_text:
        raise SystemExit(f'COPYRIGHT is missing the required statement: {phrase}')
for phrase in ('MIT', 'AGPL-3.0-or-later'):
    if phrase in copyright_text:
        raise SystemExit(f'COPYRIGHT states a superseded license: {phrase}')

asset_text = Path('ASSETS-LICENSE.md').read_text(encoding='utf-8')
trademark_text = Path('TRADEMARKS.md').read_text(encoding='utf-8')
notice_text = Path('NOTICE').read_text(encoding='utf-8')

cc_roots = (
    Path('app/public/hero'),
    Path('app/public/rooms'),
    Path('app/public/energy'),
    Path('app/public/notes'),
    Path('website/media'),
)
brand_roots = (
    Path('app/public/brand'),
    Path('app/public/icons'),
    Path('website/brand'),
)
third_party_roots = (
    Path('app/public/mdi-icons'),
)
brand_files = {Path('website/favicon.png'), Path('website/apple-touch-icon.png')}
third_party_files = {
    Path('app/public/fonts/InterVariable-subset.woff2'),
    Path('app/public/fonts/InstrumentSerif-subset.woff2'),
    Path('website/fonts/InterVariable-subset.woff2'),
}

blueprint_root = Path('app/public/blueprints')
blueprint_yaml = sorted(
    path
    for path in blueprint_root.rglob('*')
    if path.is_file() and path.suffix.lower() in {'.yaml', '.yml'}
)
if not blueprint_yaml:
    raise SystemExit(f'No technical Blueprint YAML found below {blueprint_root}.')
for path in blueprint_yaml:
    if path.stat().st_size == 0:
        raise SystemExit(f'Empty technical Blueprint YAML: {path}')
    try:
        first_line = path.read_text(encoding='utf-8').splitlines()[0]
    except (UnicodeDecodeError, IndexError) as error:
        raise SystemExit(f'Invalid technical Blueprint YAML: {path}: {error}') from error
    if first_line != '# SPDX-License-Identifier: AGPL-3.0-only':
        raise SystemExit(
            f'Technical Blueprint YAML lacks the exact first-line AGPL SPDX header: {path}'
        )

for path in cc_roots:
    if f'`{path}/`' not in asset_text:
        raise SystemExit(f'ASSETS-LICENSE.md does not declare CC BY path: {path}/')
for path in brand_roots:
    if f'`{path}/`' not in trademark_text:
        raise SystemExit(f'TRADEMARKS.md does not declare reserved brand path: {path}/')
for path in brand_files:
    if f'`{path}`' not in trademark_text:
        raise SystemExit(f'TRADEMARKS.md does not declare reserved brand file: {path}')

required_notices = ('SIL Open Font License 1.1', 'Material Design Icons', 'Apache License 2.0')
for phrase in required_notices:
    if phrase not in notice_text:
        raise SystemExit(f'NOTICE is missing third-party license text: {phrase}')

asset_suffixes = {
    '.avif', '.eot', '.gif', '.ico', '.jpeg', '.jpg', '.m4a', '.mov', '.mp3',
    '.mp4', '.ogg', '.otf', '.png', '.svg', '.ttf', '.wav', '.webm', '.webp',
    '.woff', '.woff2',
}
scan_roots = (Path('app/public'), Path('website'))
unknown = []


def below(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


for scan_root in scan_roots:
    if not scan_root.exists():
        continue
    for path in sorted(scan_root.rglob('*')):
        if not path.is_file() or path.suffix.lower() not in asset_suffixes:
            continue
        if path in brand_files or path in third_party_files:
            continue
        if any(below(path, root) for root in cc_roots + brand_roots + third_party_roots):
            continue
        unknown.append(str(path))

if unknown:
    formatted = '\n'.join(f'  - {path}' for path in unknown)
    raise SystemExit(
        'Unclassified media assets found. Add each path to ASSETS-LICENSE.md, '
        'TRADEMARKS.md or NOTICE and update this verifier:\n' + formatted
    )

print('license_files=PASS')
print('media_asset_boundary=PASS')
print(f'blueprint_yaml_agpl_technical={len(blueprint_yaml)} files PASS')
print('blueprint_yaml_cc_by_media_classification=NOT_APPLICABLE')
PY
