# Hauser project website

Static English and German HTML and CSS, published at `/` and `/de/`. The existing Pages build
copies this directory alongside the demo at `demo/` and the documentation at
`docs/`. There is no website framework, analytics or remote font request. A small local
`language.js` chooses the first homepage language from browser preferences and
remembers an explicit choice in local storage. The three-state preview uses native radio inputs and CSS;
navigation, both translations, the preview and the documentation disclosures work without JS.

## Editorial direction (2026-10-04)

Six moments: invitation, recognition, room states, everyday use, the personal
project, and getting started. Keep the actual room photo, its illustration,
one large panel capture, standby and one native room screen. Merge the repeated
room/state explanations and the separate phone/app presentations. Link detailed
interaction mechanics, design rationale, additional features and operational
guidance to the existing documentation instead of repeating them here.

The page is deliberately light, using the product's current warm day surfaces,
with one dark room-picture section. Alegreya Sans carries orientation;
Alegreya is reserved for the invitation and personal story. Yellow marks the
demo action. The original outlined logo is copied byte for byte from
`app/public/brand/hauser-logo-light.svg`; never rebuild the wordmark with text.

## Product evidence and resolved discrepancies

| Topic | Evidence used | Website decision |
| --- | --- | --- |
| Fonts and palette | `design-tokens/tokens.css`, `design-tokens/tokens.json`, `app/src/styles/app.css`, shipped font files | Current Alegreya Sans/Alegreya and warm day colours; old Inter/Instrument Serif references and the previous cool website palette are historical. |
| Current product status | `app/package.json`, public release notes and `ROADMAP.md` | Public beta. No fixed version or language count in marketing copy. Historical roadmap snapshots are not current release evidence. |
| Room pictures | `app/server/room-images.mjs`, `app/server/room-image-cloudflare-provider.mjs`, [room-image guide](https://hauserhome.app/docs/using/room-images/) | Uploads, OpenAI and Cloudflare exist. The old website's OpenAI-only description was stale. Provider access, external photo processing and costs/limits are stated next to the example. Local generation is not presented as a shipped general feature. |
| State comparison | Existing public capture assets, [rooms guide](https://hauserhome.app/docs/using/rooms/), room-picture state handling in the app | Three prepared images, labelled as a preview. No claim that this page or the image switch operates a lamp. |
| Image control | Public 0.46.0 release notes, `HeroDeviceTargets.svelte`, [home-screen guide](https://hauserhome.app/docs/using/home-screen/#three-views); native iPad panel follows (R68/R69) | Shown as its own moment after the state preview, which keeps its “does not control lamps” note. Claimed for the wall panel and the iPad app, not the iPhone. |
| Native app | [app guide](https://hauserhome.app/docs/integrations/companion-app/); native project's `HomeKitSource.swift`, README and iOS deployment target | Apple Home works directly; Home Assistant uses Hauser server pairing. iOS 17+, TestFlight beta. Do not imply feature parity between backends or label the app as a mandatory Home Assistant accessory. |
| Personal story | Public README, `ROADMAP.md`, photograph provenance in `ASSETS-LICENSE.md` | Built for the author's own household. No invented quote, user count or testimonial. |
| Accounts, cloud and cost | Server architecture, optional-provider paths, native connection modes | Free Hauser software, no Hauser subscription/account for everyday control. Removed the blanket “no cloud” promise. Optional services and TestFlight have their own terms and data flows. |

The native-app guide previously mixed configured Home Assistant notifications
with the app’s own local hints. The documentation refresh on 2026-10-04 checks
`Hauser/Services/HouseholdStore.swift` in the native project: open windows,
laundry and due reminders are local hints; Home Assistant persistent
notifications are not forwarded into the native app yet. The guide now states
that distinction. No notification or whole-feature-parity claim is made on the
website. Experimental Apple Intelligence image generation and planned local
models remain in the guide and roadmap, not in the landing page’s promise.

## Image provenance and accessibility

All product images are the existing public demo captures/illustrations, not
generated mockups. The panel and native screenshots were captured on 2026-09-26;
the capture workflow is documented in the project's media tooling. The photo
and illustration are the existing, documented before/after pair. No image was
retouched to change a control or state.

The hero cycles through full screen (6 seconds), all rooms (6 seconds),
image control without device overlays (3 seconds), and with overlays (9 seconds).
The 24-second CSS loop crossfades over 1.2 seconds, including its return to the
first frame. It uses the same full panel captures at every breakpoint, with
700/1100/full-width responsive sources. A keyboard-accessible checkbox pauses
and resumes the loop without JavaScript; reduced motion holds the first frame.

`media/hero-image-clean.webp` and `media/hero-image-devices.webp` are untouched
1696 × 960 captures of the public English web demo on 2026-10-28, fixed to the
evening appearance. A double tap on the empty floor reveals the device overlay.
Their 700/1100 variants are resized WebP copies. Existing
`media/hero-rooms-detail.webp` remains the literal iOS crop used by the guide.

All images have intrinsic dimensions. The first hero frame is preloaded;
images below the hero are lazy-loaded. Focus is visible, the room-state preview
supports native arrow-key operation, and reduced motion removes its short
crossfade. The hero and the lamp loop in moment 02 are the only animations.

`media/picture-control.webp` (2026-10-24) is the web demo in the image-control
view after a double tap. Since 2026-10-24 the demo ships its own device spots
on the drawn lamps and blinds; nothing in the picture is retouched.
`media/picture-lamps-0…2.webp` are the same evening view, cropped around the
window, sofa and floor lamp at double density: the floor lamp and the globe
lamp start off and pale, then come on one after the other. The page stacks
them in a CSS-only loop (opacity and transform, with a tap ring on each lamp);
reduced motion holds the middle frame still. `media/phone-energy.webp` is the
phone web demo's energy screen at a late-afternoon time, as captured.

`media/social-preview.jpg` is a 1280 × 640 browser capture of the new hero,
composed for sharing with its navigation/actions hidden and more compact type
and spacing. It uses the same original logo and untouched product screenshot.

New assets remain within existing licence classes: `website/media/` is CC BY
4.0, `website/brand/` is reserved branding, fonts retain their bundled OFL.
Source and this documentation are AGPL-3.0-only.

## Links and validation

All previous section IDs remain usable: `main`, `what`, `moments`, `glance`,
`room`, `touch`, `setup`, `voices`, `app`, `dignity`, `beta`, `install`.
Paths stay relative to the Pages project root. TestFlight uses the existing
public invitation; no App Store listing is implied.

For website changes, serve this directory under `/`, render at 360,
390, 768 and 1440 pixels, and check the preview by pointer and keyboard, without
JavaScript and with reduced motion. Check console/network errors, local assets,
anchors and all linked destinations. The public export's existing
`scripts/build-pages.sh` verifies demo/wiki base paths;
`scripts/verify-license-boundary.sh` verifies the asset classes. No deployment
is part of these checks.

## Search and languages

The English homepage is the editable source. German copy, including image
alternatives and accessible labels, lives in `translations/de.json`. Run
`python3 scripts/build-website.py` from the public repository root (or pass
`--website website` to the export overlay script in the development checkout).
The Pages build runs it automatically. It fails on untranslated new copy.
Generated German and topic HTML is checked in so local previews need no build.

The browser selects German only at the unqualified homepage. Explicit `/de/`
and topic URLs stay in their requested language. The top-bar DE/EN link stores
the manual preference; `?lang=en` also works without browser storage. Section
anchors survive the switch. Other browser languages fall back to English.

Each language has its own canonical, reciprocal `hreflang` links, translated
metadata and structured data. Home Assistant and Apple Home each have an
English and German topic page. The guide remains English and German links
identify it as `(EN)`. Existing captures remain unchanged and show English UI.

`robots.txt` points to `sitemap.xml`, which indexes `sitemap-pages.xml` and
the wiki sitemap. No training permission or external analytics is added.
Search Console and Bing Webmaster Tools verification/submission require the
owner’s existing accounts; no verification token is invented.
