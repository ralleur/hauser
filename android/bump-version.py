#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
import json,re,sys
from pathlib import Path
p=Path(__file__).parent/'version.json';v=json.loads(p.read_text())
if len(sys.argv)!=3 or not re.fullmatch(r'\d+\.\d+\.\d+(?:-beta\.\d+)?',sys.argv[1]):raise SystemExit('Usage: bump-version.py VERSION CODE')
code=int(sys.argv[2])
if code<=v['code']:raise SystemExit('VersionCode must increase; never reuse a published code.')
v.update(name=sys.argv[1],code=code);p.write_text(json.dumps(v,indent=2)+'\n')
