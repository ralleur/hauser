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

printf 'pages_root=%s\nlanding=index.html\ndemo=demo/index.html\n' "$ROOT/.pages"
