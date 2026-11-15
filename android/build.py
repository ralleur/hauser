#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build the public Android APK using pinned SDK tools; never creates a signing key."""
import argparse, hashlib, ipaddress, json, os, re, shutil, subprocess, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent
parser=argparse.ArgumentParser()
parser.add_argument('--unsigned',action='store_true',help='Build only; not distributable')
parser.add_argument('--prototype-server',help='Private Xiaomi prototype; same local tablet package/key, never distributable')
args=parser.parse_args()
prototype=bool(args.prototype_server)
if prototype:
    from urllib.parse import urlsplit
    u=urlsplit(args.prototype_server)
    try:
        address=ipaddress.ip_address(u.hostname or '')
        private_host=address.is_private and not address.is_loopback and not address.is_link_local and not address.is_unspecified
    except ValueError:
        private_host=bool(u.hostname and u.hostname.endswith('.local'))
    if u.scheme!='http' or not private_host or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
        raise SystemExit('Prototype server must be an explicit private LAN origin.')
SDK=Path(os.environ.get('ANDROID_HOME','/opt/homebrew/share/android-commandlinetools'))
JAVA=Path(os.environ.get('JAVA_HOME','/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home'))
TOOLS=SDK/'build-tools/35.0.0'
ANDROID=SDK/'platforms/android-35/android.jar'
BUILD=ROOT/'build'/'tablet-prototype' if prototype else ROOT/'build'
DEP=ROOT/'.deps/zxing-core-3.5.3.jar'
EXPECTED='8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82'
if not DEP.is_file() or hashlib.sha256(DEP.read_bytes()).hexdigest()!=EXPECTED:
    raise SystemExit('Download ZXing Core 3.5.3 as documented in android/README.md; checksum mismatch or missing dependency.')
version=json.loads((ROOT/'version.json').read_text())
if prototype:version={**version,'package':'de.ralleur.hauser.tablet','code':100+version['code'],'name':version['name']+'-tablet'}
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?(?:-tablet)?',version['name'])
assert isinstance(version['code'],int) and version['code']>0
for folder in ['classes','dex','assets','res/drawable','res/xml','res/values']:(BUILD/folder).mkdir(parents=True,exist_ok=True)
env=dict(os.environ,JAVA_HOME=str(JAVA));env['PATH']=str(JAVA/'bin')+':'+env['PATH']
def run(*cmd,**kw):return subprocess.run([str(x) for x in cmd],check=True,env=env,timeout=180,**kw)
for f in (ROOT/'assets').iterdir():
    if f.is_file():shutil.copy2(f,BUILD/'assets'/f.name)
for source,target in {
    'design-tokens/tokens.css':'tokens.css','app/public/brand/hauser-logo-dark.svg':'brand.svg',
    'app/public/hero/wohnzimmer-dark.avif':'dark.avif','app/public/hero/wohnzimmer-dark-off.avif':'dark-off.avif',
    'app/public/hero/wohnzimmer-dark-phone.avif':'dark-phone.avif','app/public/hero/wohnzimmer-dark-off-phone.avif':'dark-off-phone.avif',
    'app/public/fonts/AlegreyaSans-Regular-subset.woff2':'sans.woff2','app/public/fonts/Alegreya-subset.woff2':'display.woff2',
    'app/public/fonts/AlegreyaSans-Medium-subset.woff2':'sans-medium.woff2',
    'app/public/fonts/AlegreyaSans-Bold-subset.woff2':'sans-bold.woff2',
    'app/public/fonts/LICENSE-Alegreya-OFL.txt':'LICENSE-Alegreya-OFL.txt',
    'app/public/legal/agpl-3.0.txt':'LICENSE.txt',
}.items():shutil.copy2(REPO/source,BUILD/'assets'/target)
# Copy the lamp overlay's actual keyframes; the tablet must not invent another motion.
web_css=(REPO/'app/src/styles/app.css').read_text()
keyframes=[]
for name in ['modal-enter','modal-exit','overlay-scrim-in','overlay-scrim-out']:
    match=re.search(r'@keyframes '+name+r'\s*\{[^\n]+',web_css)
    if not match:raise SystemExit('Missing shared overlay animation: '+name)
    keyframes.append(match.group(0))
(BUILD/'assets/overlay-motion.css').write_text('/* SPDX-License-Identifier: AGPL-3.0-only; from app/src/styles/app.css */\n'+'\n'.join(keyframes)+'\n')
# The offline dock uses the same MDI pictograms as the existing web navigation.
for name in ['home','lightning-bolt','calendar','calendar-blank','note-text-outline','note-edit-outline','text-box-outline','notebook-outline','book-open-page-variant','book-open-variant','library','archive','archive-outline','archive-arrow-down-outline','cog','cog-outline','bell','washing-machine','tumble-dryer','update','door-open','motion-sensor','shield-home','thermometer','heart-pulse','tune-variant','check-circle','image','file-document-outline']:
    asset=REPO/'app/node_modules/@mdi/svg/svg'/f'{name}.svg'
    if asset.is_file():shutil.copy2(asset,BUILD/'assets'/asset.name)

shutil.copy2(REPO/'app/public/icons/icon-512.png',BUILD/'res/drawable/icon.png')
for f in (ROOT/'res/xml').glob('*.xml'):shutil.copy2(f,BUILD/'res/xml'/f.name)
css=(REPO/'design-tokens/tokens.css').read_text()
metrics=''.join('<dimen name="'+name.replace('-','_')+'">'+re.search(r'--'+name+r':\s*([0-9]+)px',css).group(1)+'dp</dimen>' for name in ['tablet-keyboard-landscape-height','tablet-keyboard-portrait-height'])
(BUILD/'res/values/tablet.xml').write_text('<resources><string name="keyboard_name">Hauser QWERTZ</string>'+metrics+'</resources>')
night_rgba=re.search(r'--tablet-night-shade:\s*rgba\(([^)]+)\)',(REPO/'design-tokens/tokens.css').read_text()).group(1).split(',')
night_color=(round(float(night_rgba[3])*255)<<24)|(int(night_rgba[0])<<16)|(int(night_rgba[1])<<8)|int(night_rgba[2])
(BUILD/'BuildConfig.java').write_text('package de.ralleur.hauser; final class BuildConfig { static final int NIGHT_SHADE=0x'+format(night_color,'08x')+'; static final boolean PROTOTYPE='+str(prototype).lower()+'; static final String PROTOTYPE_SERVER='+json.dumps(args.prototype_server.rstrip('/') if prototype else '')+'; }')
background=re.search(r'--color-surface-0:\s*(#[a-fA-F0-9]+)',(REPO/'design-tokens/tokens.css').read_text()).group(1)
(BUILD/'res/values/styles.xml').write_text('<resources><style name="HauserTheme" parent="android:style/Theme.Material.NoActionBar"><item name="android:windowBackground">'+background+'</item><item name="android:navigationBarColor">'+background+'</item><item name="android:statusBarColor">'+background+'</item><item name="android:windowLightStatusBar">false</item><item name="android:windowLightNavigationBar">false</item></style></resources>')
manifest=(ROOT/'AndroidManifest.xml').read_text().replace('android:authorities="de.ralleur.hauser.capture"',f'android:authorities="{version["package"]}.capture"').replace('package="de.ralleur.hauser"',f'package="{version["package"]}" android:versionCode="{version["code"]}" android:versionName="{version["name"]}"')
if prototype:manifest=manifest.replace('android:debuggable="false"','android:debuggable="true"')
(BUILD/'AndroidManifest.xml').write_text(manifest)
run(TOOLS/'aapt2','compile','--dir',BUILD/'res','-o',BUILD/'resources.zip')
run(TOOLS/'aapt2','link','-I',ANDROID,'--manifest',BUILD/'AndroidManifest.xml','-A',BUILD/'assets','-o',BUILD/'resources.apk',BUILD/'resources.zip')
run(JAVA/'bin/javac','--release','8','-classpath',str(ANDROID)+os.pathsep+str(DEP),'-d',BUILD/'classes',*ROOT.glob('src/**/*.java'),BUILD/'BuildConfig.java')
run(TOOLS/'d8','--lib',ANDROID,'--min-api','30','--output',BUILD/'dex',DEP,*BUILD.glob('classes/**/*.class'))
with zipfile.ZipFile(BUILD/'resources.apk') as src,zipfile.ZipFile(BUILD/'unsigned.apk','w') as dst:
    for item in src.infolist():dst.writestr(item,src.read(item.filename))
    for f in (BUILD/'dex').glob('*.dex'):dst.write(f,f.name)
run(TOOLS/'zipalign','-f','-p','4',BUILD/'unsigned.apk',BUILD/'aligned.apk')
if args.unsigned:
    print('unsigned_build=PASS (not for distribution)');raise SystemExit(0)
key=Path(os.environ.get('HAUSER_ANDROID_KEYSTORE',str(Path.home()/'.config/hauser-android-release/release.p12')))
if prototype:key=Path.home()/'.config/androidctl/hauser-signing.keystore'
if not key.is_file():raise SystemExit('Release key missing. Follow android/README.md; no debug fallback.')
# Password stays in process memory, never a command argument, file or build log.
password=json.loads((Path.home()/'.config/androidctl/hauser-signing.json').read_text())['password'] if prototype else subprocess.run(['/usr/bin/security','find-generic-password','-s','hauser-android-release','-a','release','-w'],capture_output=True,text=True,check=True).stdout.strip()
env['HAUSER_ANDROID_SIGN_PASSWORD']=password
apk=BUILD/f'hauser-android-{version["name"]}.apk'
run(TOOLS/'apksigner','sign','--ks',key,'--ks-key-alias','hauser-tablet' if prototype else 'hauser-release','--ks-pass','env:HAUSER_ANDROID_SIGN_PASSWORD','--key-pass','env:HAUSER_ANDROID_SIGN_PASSWORD','--out',apk,BUILD/'aligned.apk')
verification=run(TOOLS/'apksigner','verify','--verbose','--print-certs',apk,capture_output=True,text=True).stdout
print(verification)
fingerprint=re.search(r'certificate SHA-256 digest: ([a-f0-9]+)',verification).group(1)
expected=(ROOT/'signer-sha256.txt').read_text().strip()
if not prototype and fingerprint!=expected:raise SystemExit('Unexpected release signer; do not publish.')
badging=run(TOOLS/'aapt2','dump','badging',apk,capture_output=True,text=True).stdout
if (f"name='{version['package']}'" not in badging or f"versionCode='{version['code']}'" not in badging
    or f"versionName='{version['name']}'" not in badging or "minSdkVersion:'30'" not in badging
    or "targetSdkVersion:'35'" not in badging or ('application-debuggable' in badging)!=prototype):
    raise SystemExit('APK manifest does not match the release contract.')
meta={**version,'file':apk.name,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'signerSha256':fingerprint,'minSdk':30,'targetSdk':35,'bytes':apk.stat().st_size,'debuggable':prototype,'prototype':prototype}
(BUILD/'release.json').write_text(json.dumps(meta,indent=2)+'\n')
(BUILD/(apk.name+'.sha256')).write_text(meta['sha256']+'  '+apk.name+'\n')
apk.chmod(0o600 if prototype else 0o644)
print(json.dumps(meta,indent=2))
