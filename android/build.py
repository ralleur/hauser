#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build the public Android APK using pinned SDK tools; never creates a signing key."""
import argparse, hashlib, json, os, re, shutil, subprocess, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent
parser=argparse.ArgumentParser()
parser.add_argument('--unsigned',action='store_true',help='Build only; not distributable')
args=parser.parse_args()
SDK=Path(os.environ.get('ANDROID_HOME','/opt/homebrew/share/android-commandlinetools'))
JAVA=Path(os.environ.get('JAVA_HOME','/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home'))
TOOLS=SDK/'build-tools/35.0.0'
ANDROID=SDK/'platforms/android-35/android.jar'
BUILD=ROOT/'build'
DEP=ROOT/'.deps/zxing-core-3.5.3.jar'
EXPECTED='8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82'
if not DEP.is_file() or hashlib.sha256(DEP.read_bytes()).hexdigest()!=EXPECTED:
    raise SystemExit('Download ZXing Core 3.5.3 as documented in android/README.md; checksum mismatch or missing dependency.')
version=json.loads((ROOT/'version.json').read_text())
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?',version['name'])
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
    'app/public/fonts/LICENSE-Alegreya-OFL.txt':'LICENSE-Alegreya-OFL.txt',
    'app/public/legal/agpl-3.0.txt':'LICENSE.txt',
}.items():shutil.copy2(REPO/source,BUILD/'assets'/target)
shutil.copy2(REPO/'app/public/icons/icon-512.png',BUILD/'res/drawable/icon.png')
shutil.copy2(ROOT/'res/xml/network_security_config.xml',BUILD/'res/xml/network_security_config.xml')
background=re.search(r'--color-surface-0:\s*(#[a-fA-F0-9]+)',(REPO/'design-tokens/tokens.css').read_text()).group(1)
(BUILD/'res/values/styles.xml').write_text('<resources><style name="HauserTheme" parent="android:style/Theme.Material.NoActionBar"><item name="android:windowBackground">'+background+'</item><item name="android:navigationBarColor">'+background+'</item><item name="android:statusBarColor">'+background+'</item><item name="android:windowLightStatusBar">false</item><item name="android:windowLightNavigationBar">false</item></style></resources>')
manifest=(ROOT/'AndroidManifest.xml').read_text().replace('package="de.ralleur.hauser"',f'package="{version["package"]}" android:versionCode="{version["code"]}" android:versionName="{version["name"]}"')
(BUILD/'AndroidManifest.xml').write_text(manifest)
run(TOOLS/'aapt2','compile','--dir',BUILD/'res','-o',BUILD/'resources.zip')
run(TOOLS/'aapt2','link','-I',ANDROID,'--manifest',BUILD/'AndroidManifest.xml','-A',BUILD/'assets','-o',BUILD/'resources.apk',BUILD/'resources.zip')
run(JAVA/'bin/javac','--release','8','-classpath',str(ANDROID)+os.pathsep+str(DEP),'-d',BUILD/'classes',*ROOT.glob('src/**/*.java'))
run(TOOLS/'d8','--lib',ANDROID,'--min-api','30','--output',BUILD/'dex',DEP,*BUILD.glob('classes/**/*.class'))
with zipfile.ZipFile(BUILD/'resources.apk') as src,zipfile.ZipFile(BUILD/'unsigned.apk','w') as dst:
    for item in src.infolist():dst.writestr(item,src.read(item.filename))
    for f in (BUILD/'dex').glob('*.dex'):dst.write(f,f.name)
run(TOOLS/'zipalign','-f','-p','4',BUILD/'unsigned.apk',BUILD/'aligned.apk')
if args.unsigned:
    print('unsigned_build=PASS (not for distribution)');raise SystemExit(0)
key=Path(os.environ.get('HAUSER_ANDROID_KEYSTORE',str(Path.home()/'.config/hauser-android-release/release.p12')))
if not key.is_file():raise SystemExit('Release key missing. Follow android/README.md; no debug fallback.')
# Password stays in process memory, never a command argument, file or build log.
password=subprocess.run(['/usr/bin/security','find-generic-password','-s','hauser-android-release','-a','release','-w'],capture_output=True,text=True,check=True).stdout.strip()
env['HAUSER_ANDROID_SIGN_PASSWORD']=password
apk=BUILD/f'hauser-android-{version["name"]}.apk'
run(TOOLS/'apksigner','sign','--ks',key,'--ks-key-alias','hauser-release','--ks-pass','env:HAUSER_ANDROID_SIGN_PASSWORD','--key-pass','env:HAUSER_ANDROID_SIGN_PASSWORD','--out',apk,BUILD/'aligned.apk')
verification=run(TOOLS/'apksigner','verify','--verbose','--print-certs',apk,capture_output=True,text=True).stdout
print(verification)
fingerprint=re.search(r'certificate SHA-256 digest: ([a-f0-9]+)',verification).group(1)
expected=(ROOT/'signer-sha256.txt').read_text().strip()
if fingerprint!=expected:raise SystemExit('Unexpected release signer; do not publish.')
badging=run(TOOLS/'aapt2','dump','badging',apk,capture_output=True,text=True).stdout
if ("name='de.ralleur.hauser'" not in badging or f"versionCode='{version['code']}'" not in badging
    or f"versionName='{version['name']}'" not in badging or "minSdkVersion:'30'" not in badging
    or "targetSdkVersion:'35'" not in badging or 'application-debuggable' in badging):
    raise SystemExit('APK manifest does not match the release contract.')
meta={**version,'file':apk.name,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'signerSha256':fingerprint,'minSdk':30,'targetSdk':35,'bytes':apk.stat().st_size,'debuggable':False}
(BUILD/'release.json').write_text(json.dumps(meta,indent=2)+'\n')
(BUILD/(apk.name+'.sha256')).write_text(meta['sha256']+'  '+apk.name+'\n')
print(json.dumps(meta,indent=2))
