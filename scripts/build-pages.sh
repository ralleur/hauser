#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run build:pages-demo --prefix app

rm -rf .pages
mkdir -p .pages/demo
cp -R website/. .pages/
cp -R app/dist-pages-demo/. .pages/demo/
touch .pages/.nojekyll

python3 - <<'PY'
from pathlib import Path
import json
import re

root = Path('.pages/demo')
html = (root / 'index.html').read_text()
refs = re.findall(r'(?:src|href)="([^"]+)"', html)
outside_base = [ref for ref in refs if ref.startswith('/') and not ref.startswith('/hauser/demo/')]
if outside_base:
    raise SystemExit(f'Demo HTML contains root-relative references outside /hauser/demo/: {outside_base}')

manifest = json.loads((root / 'manifest.webmanifest').read_text())
for field in ('id', 'start_url', 'scope'):
    if manifest.get(field) != './':
        raise SystemExit(f'Demo manifest field {field!r} must be relative, got {manifest.get(field)!r}')
icon_sources = [icon.get('src') for icon in manifest.get('icons', [])]
if not icon_sources or any(not isinstance(src, str) or src.startswith('/') for src in icon_sources):
    raise SystemExit(f'Demo manifest icon paths must be relative: {icon_sources}')

print('pages_base_path_contract=PASS')
PY

printf 'pages_root=%s\nlanding=index.html\ndemo=demo/index.html\n' "$ROOT/.pages"
