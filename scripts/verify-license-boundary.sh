#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
from pathlib import Path

required = [
    Path('LICENSE'),
    Path('ASSETS-LICENSE.md'),
    Path('TRADEMARKS.md'),
    Path('NOTICE'),
]
missing = [str(path) for path in required if not path.is_file() or path.stat().st_size == 0]
if missing:
    raise SystemExit(f'Missing required license files: {missing}')

license_text = Path('LICENSE').read_text(encoding='utf-8')
if not license_text.startswith('MIT License\n') or 'Copyright (c) 2026 ralleur' not in license_text:
    raise SystemExit('LICENSE is not the expected MIT license for this project.')

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
)
third_party_roots = (
    Path('app/public/mdi-icons'),
)
brand_files = {Path('website/favicon.png')}
third_party_files = {
    Path('app/public/fonts/InterVariable-subset.woff2'),
    Path('app/public/fonts/InstrumentSerif-subset.woff2'),
    Path('website/fonts/InterVariable-subset.woff2'),
    Path('website/fonts/InstrumentSerif-subset.woff2'),
}

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
PY
