#!/usr/bin/env python3
"""Reject obsolete public URLs in tracked text files (no network or dependencies)."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
# Split the host so this check does not match its own source.
OLD_HOST = 'ralleur' + '.github.io'
OBSOLETE = re.compile(
    rf'(?:https?:)?//{re.escape(OLD_HOST)}/hauser(?=[/\s?#)\]"\'<>]|$)'
    r'|(?:https?:)?//hauserhome\.app/hauser(?=[/\s?#)\]"\'<>]|$)',
    re.IGNORECASE,
)


def main():
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    failures = []
    for name in filter(None, paths):
        path = ROOT / name
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(content.splitlines(), 1):
            if OBSOLETE.search(line):
                failures.append(f'{name}:{number}: {line.strip()}')
    if failures:
        print('Obsolete public URLs; use https://hauserhome.app/ (demo/ or docs/):', file=sys.stderr)
        print('\n'.join(failures), file=sys.stderr)
        return 1
    print('public_url_contract=PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
