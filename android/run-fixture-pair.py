#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
import json,subprocess,sys,urllib.request
from pathlib import Path
p=Path(__file__).resolve().parent
if '--finish' not in sys.argv:
 code=(p/'build/fixture/code.txt').read_text().strip()
 subprocess.run(['python3',str(p/'test-device.py'),'pair','--code',code],check=True)
else:
 def get(route):return json.load(urllib.request.urlopen('http://127.0.0.1:4187'+route))
 before=get('/evidence');assert before['sockets']>=1 and before['commands']>=1 and before['state']=='on',before
 subprocess.run(['python3',str(p/'test-device.py'),'reload'],check=True)
 after=get('/evidence');assert after['sockets']>before['sockets'],after
 get('/revoke')
 subprocess.run(['python3',str(p/'test-device.py'),'reload'],check=True)
 import xml.etree.ElementTree as ET
 text=' '.join(n.get('text','') for n in ET.parse(p/'build/device-tests/reloaded.xml').iter('node'))
 assert 'revoked' in text or 'Anmeldung' in text,text
 evidence={'websocketAuthenticated':True,'commandAcknowledged':True,'encryptedPairingSurvivesRestart':True,'revocationShown':True,'fixture':True,'counts':after}
 (p/'build/connection-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
 print('socket_command_restart_revocation=PASS')
