# Hauser for Android

Public beta for Android 11 or newer (API 30), phones and tablets. Package
`de.ralleur.hauser`. The app loads the existing interface from **your own Hauser
server**. No personal server address, account, Home Assistant token or tailnet
is bundled. Apple Home is not available on Android.

The first-run flow follows the native iPhone app: the living-room illustration,
“Lights on”, the Home Assistant path, local discovery, pairing and optional
resident selection. The QR button opens the system camera; take a clear photo
of the complete QR code. The image is decoded locally and removed afterwards.
The manual path uses the same server address and eight-character code from
System → Pair a phone. Add-on installation links follow the iPhone flow.
“Just look around first” opens the existing public web demo, without pairing.

## Install and update

Download only from <https://hauserhome.app/android/>. Android asks you to allow
installation from the browser or file manager that opens the APK. Allow that
source for this installation, then turn the permission back off. Do not turn
off Play Protect or change global Android security settings.

Updates are manual: download the newer APK and install over the existing app.
Keep the same package and signing certificate and increase `versionCode`.
Pairing is preserved. Do not uninstall to update. This public app has a different
package/signature from private tablet development builds; those are not an
upgrade path. This is not a Play Store release.

Release signer SHA-256: see `signer-sha256.txt`. Each download has its own SHA-256
and `release.json`; the website displays both the version and certificate.
If an update reports a conflicting signature, stop and check the download.
A lost release signing key prevents ordinary in-place updates. Key rotation
requires a separately designed Android signing lineage; do not replace the key.

## Connections and failures

Use a reachable Hauser server, not the Home Assistant port 8123. First pairing
happens on the trusted home network. Discovery tries `homeassistant.local:4173`
and `homeassistant:4173`; manual entry remains available. HTTP requires explicit
confirmation and is restricted to private IP ranges/local names. HTTPS uses
system certificate authorities, never a certificate bypass. Public HTTP,
credentials in URLs, path prefixes and insecure redirects are rejected.

The server's Android web-session endpoint exchanges an existing device token
for a host-only HttpOnly SameSite=Strict cookie. HTTP and WebSocket requests
validate the same token; cookie requests cannot waive the exact-Origin check.
Revocation applies to new requests and WebSocket connections. Existing sockets
follow the server's existing lifetime policy. Older LAN servers without the
endpoint retain their existing trusted-LAN browser behavior; remote HTTPS
requires Hauser server 0.50.3 or newer.

A QR link can carry the server's HTTPS remote address. The app tries LAN first,
then that remote address. An upstream identity proxy must allow the configured
Hauser device-token/session flow and WebSocket upgrades. The app does not
bypass Cloudflare Access or automatically sign in to it. Redirects to an access
login produce an explanation; they are not counted as successful pairing.
No public route is included in the APK. A loaded room overview or healthy HTTP
response alone is not proof of live device control.

Network, HTTP, revoked-session and certificate errors offer retry or a new
connection. The web interface retains its own live/offline indicators. Android
Back navigates within the page; at the root it opens the app menu (reload,
connection, fullscreen, Xiaomi handle spacing, close). On phones system navigation stays
available. Tablets use an immersive Hauser home surface with device controls,
Store, app drawer and an optional system-wide Hauser keyboard. See
[tablet prototype](../docs/android-tablet-prototype.md) for setup, permissions
and the dedicated-device boundary. Insets for navigation, cutouts and keyboard are handled once natively
and cleared before forwarding to WebView. Fullscreen hides only the app's status
bar. The optional Xiaomi handle spacing is **off by default**.

External HTTPS links open in the browser. Other main-frame origins/schemes are
blocked. File uploads use Android's document picker and accept only the returned
content URIs. No storage, camera, microphone or location permission is requested
by the app; QR photography is delegated to the camera app. Camera/live-media
permissions requested by web pages are denied. Download/export links requiring
browser blob downloads are not implemented by the wrapper. Pairing is encrypted
with an Android Keystore AES-GCM key; app backup and debugging are disabled.

The setup UI currently supports German and English; the loaded server UI keeps
its existing languages. The app contains no analytics or update service.

## Build

Use Python 3, OpenJDK, Android SDK platform 35 and build-tools 35.0.0. No Gradle
or AndroidX is needed. `ANDROID_HOME` and `JAVA_HOME` can select other installations.
Generate the phone image variants first with `npm ci --prefix app` and
`npm run hero:phone --prefix app` (or reuse an existing prepared checkout).
The one app dependency is ZXing Core 3.5.3 (Apache-2.0):

```sh
mkdir -p android/.deps
curl -fSL https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar -o android/.deps/zxing-core-3.5.3.jar
python3 android/build.py --unsigned
```

The build enforces SHA-256
`8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82`.
Unsigned output is not distributable. The release build requires an existing
PKCS12 key, alias `hauser-release`, and a password in macOS Keychain (service
`hauser-android-release`, account `release`). Set `HAUSER_ANDROID_KEYSTORE` to
select the keystore. The build never creates or substitutes a signing key.

```sh
python3 android/build.py
python3 android/prepare-release.py
```

Version identity lives only in `android/version.json`. Use
`python3 android/bump-version.py VERSION CODE`; the manifest and website metadata
are generated. Android versions are independent of the server version.

For a dedicated emulator named `hauser-android-release` on port 5560,
`python3 android/test-device.py install` and `matrix` capture the focused layout
checks. Never point this script at a physical or shared device. Use the separate
`ServerAddressTest.java` for URL-policy tests and the existing server pairing
tests for session/CSRF behavior. See the release evidence for actual tested
systems and remaining limits; minimum SDK declaration alone is not device QA.

## Licensing

Code and documentation: AGPL-3.0-only. Built-in room illustrations are unchanged
Hauser artwork, CC BY 4.0. Brand/icon rights remain reserved. Fonts retain SIL
OFL; ZXing retains Apache-2.0. The build copies those existing asset sources and
ships their license texts and notices. It never copies private tablet data.

## House-tablet prototype

On Android tablets (smallest width at least 600dp), the APK supplies the Hauser
device panel, installed-app drawer and Store with official Google Play search as an offline native-owned
surface. Only this surface has device access; the server page never receives
a privileged JavaScript bridge. Hauser can be selected as the Android Home app.
Its QWERTZ input method is enabled separately and works across apps. Admin-only
setup grants optional display, quiet-mode and Bluetooth access. Existing phones
keep the companion flow. See [the prototype specification](../docs/android-tablet-prototype.md).

For the existing, private Xiaomi test package and local signing identity:

```sh
python3 android/build.py --prototype-server http://YOUR-PRIVATE-LAN-HOST:4173
```

This variant is debuggable, uses `de.ralleur.hauser.tablet` and writes only to
`android/build/tablet-prototype/`. It must not be prepared or published as a
public APK. Regular builds remain non-debuggable and contain no prototype
server. The separate keyboard process uses its own WebView data directory and
does not store typed text or contact a suggestion service. Complete system
lockdown requires dedicated-device provisioning; choosing a Home app alone
does not grant Device Owner privileges.

Die Tablet-Mitteilungszentrale und ihre Einzelbanner liegen in
`assets/tablet-notifications.{js,css}`. Die Zentrale läuft in der Offline-WebView;
`HauserNotificationListener` ergänzt dort nach Android-Freigabe echte aktive
Appmitteilungen. Ihre Inhalte werden weder an die Server-WebView weitergereicht
noch gespeichert. Hauser-Meldungen verwenden die bisherigen Meldungsaktionen;
Lesen bleibt von Quittieren getrennt. Night Mode ist standardmäßig an und in den
Geräteeinstellungen abschaltbar. Navigation und Glas verwenden dieselben
Piktogramme und Tokens wie die bestehende Hauser-Oberfläche.

Der fokussierte Abnahmepfad für die Integrationskorrekturen ist
`tests/tablet-integration-fixes.mjs`; er entfernt seine Prüfmeldungen und stellt
beide Meldungsspeicher wieder her. Vor der Ausführung muss das Tablet wach und
entsperrt sein. Das Skript benötigt die lokale WebView-Weiterleitung auf 9487.
Bei einem normalen APK-Update kein `am force-stop` für das Paket ausführen:
Das kann die aktive Eingabemethode auf Gboard zurücksetzen. Die Hauser-IME nach
einem gezielten Stop bei Bedarf erneut auswählen und prüfen.
