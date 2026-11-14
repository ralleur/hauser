#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Focused checks against this task's dedicated emulator only; never a physical device."""
import argparse,json,re,shlex,subprocess,time,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'build/device-tests';OUT.mkdir(parents=True,exist_ok=True)
DEVICE='emulator-5560'
parser=argparse.ArgumentParser();parser.add_argument('step',choices=['matrix','pair','capture','back','reload','install','legal']);parser.add_argument('--live',action='store_true');parser.add_argument('--code');parser.add_argument('--address',default='http://10.0.2.2:4187');args=parser.parse_args()
def adb(*a):return subprocess.run(['adb','-s',DEVICE,*map(str,a)],capture_output=True,check=True,timeout=45).stdout
def ui():
    adb('shell','uiautomator','dump','/sdcard/hauser-release-test.xml')
    raw=adb('shell','cat','/sdcard/hauser-release-test.xml');(OUT/'latest.xml').write_bytes(raw)
    return ET.fromstring(raw)
def tap(text,contains=False):
    for attempt in range(6):
        tree=ui()
        for node in tree.iter('node'):
            value=node.get('text','') or node.get('content-desc','')
            if (text in value if contains else text==value):
                n=list(map(int,re.findall(r'\d+',node.get('bounds'))))
                if n[2]>n[0] and n[3]>n[1]:
                    adb('shell','input','tap',(n[0]+n[2])//2,(n[1]+n[3])//2);time.sleep(.8);return
        adb('shell','input','swipe','500','1700','500','600','400');time.sleep(.4)
    raise RuntimeError('UI element missing or off screen: '+text)
def capture(name):
    time.sleep(.8);(OUT/(name+'.png')).write_bytes(adb('exec-out','screencap','-p'));(OUT/(name+'.xml')).write_bytes(ET.tostring(ui()))
def start():adb('shell','am','start','-n','de.ralleur.hauser/.MainActivity');time.sleep(1)
if args.step=='install':
    apk=ROOT/'build'/('hauser-android-'+json.loads((ROOT/'version.json').read_text())['name']+'.apk')
    print(adb('install','--no-incremental','-r',apk).decode());start();capture('installed')
if args.step=='matrix':
    for name,size,density in [('phone','1080x2400',420),('compact','720x1280',320),('phone-landscape','1280x720',320),('tablet-landscape','2560x1600',240),('tablet-portrait','1600x2560',240)]:
        adb('shell','wm','size',size);adb('shell','wm','density',density);start();capture(name)
    adb('shell','wm','size','1080x2400');adb('shell','wm','density','420');start()
    tap('Lights on',True);capture('who');tap('Smart home is fun for me.',True);time.sleep(5);capture('ha')
if args.step=='pair':
    if not args.code:raise SystemExit('--code required (test fixture only)')
    import urllib.parse
    link='hauser://pair?v=1&'+urllib.parse.urlencode({'lan':args.address,'code':args.code})
    adb('shell','am','start','-a','android.intent.action.VIEW','-d',shlex.quote(link),'de.ralleur.hauser');time.sleep(2)
    tree=ui();edits=[n for n in tree.iter('node') if n.get('class')=='android.widget.EditText']
    assert edits[0].get('text')==args.address
    assert edits[1].get('text')==args.code
    # Bring up and dismiss the keyboard, verifying the form remains usable.
    bounds=list(map(int,re.findall(r'\d+',edits[0].get('bounds'))))
    if bounds[2]>bounds[0]:
        adb('shell','input','tap',(bounds[0]+bounds[2])//2,(bounds[1]+bounds[3])//2);time.sleep(.5);capture('keyboard');adb('shell','input','keyevent','KEYCODE_BACK')
    capture('manual-filled')
    tap('Allow unencrypted HTTP',True);tap('Connect');time.sleep(3);capture('paired')
    tap('Skip');time.sleep(3);capture('authenticated-socket')
    if not args.live:
        tap('Switch test light');time.sleep(1);capture('command-acknowledged')
        assert any('Light on' in n.get('text','') for n in ui().iter('node'))
if args.step=='legal':
    link='hauser://pair?v=1&lan=http%3A%2F%2F10.0.2.2%3A4187&code=ABCD2345'
    adb('shell','am','start','-a','android.intent.action.VIEW','-d',shlex.quote(link),'de.ralleur.hauser');time.sleep(2)
    tap('Hauser · Open Source');tap('AGPL-3.0');capture('licence')
    adb('shell','input','keyevent','KEYCODE_BACK');time.sleep(1)
    assert any('Lights on' in n.get('text','') or 'Connect'==n.get('text','') for n in ui().iter('node'))
    capture('licence-back')
if args.step=='capture':capture('current')
if args.step=='back':adb('shell','input','keyevent','KEYCODE_BACK');capture('back')
if args.step=='reload':adb('shell','am','force-stop','de.ralleur.hauser');start();capture('reloaded')
print('device_step='+args.step+' PASS')
