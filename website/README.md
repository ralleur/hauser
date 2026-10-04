# Hauser project website

Static English HTML and CSS, published at `/hauser/`. The existing Pages build
copies this directory alongside the demo at `demo/` and the documentation at
`docs/`. There is no website framework, client JavaScript, analytics or remote
font request. The three-state preview uses native radio inputs and CSS;
navigation, the preview and the documentation disclosures work without JS.

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
| Room pictures | `app/server/room-images.mjs`, `app/server/room-image-cloudflare-provider.mjs`, [room-image guide](https://ralleur.github.io/hauser/docs/using/room-images/) | Uploads, OpenAI and Cloudflare exist. The old website's OpenAI-only description was stale. Provider access, external photo processing and costs/limits are stated next to the example. Local generation is not presented as a shipped general feature. |
| State comparison | Existing public capture assets, [rooms guide](https://ralleur.github.io/hauser/docs/using/rooms/), room-picture state handling in the app | Three prepared images, labelled as a preview. No claim that this page or the image switch operates a lamp. |
| Native app | [app guide](https://ralleur.github.io/hauser/docs/integrations/companion-app/); native project's `HomeKitSource.swift`, README and iOS deployment target | Apple Home works directly; Home Assistant uses Hauser server pairing. iOS 17+, TestFlight beta. Do not imply feature parity between backends or label the app as a mandatory Home Assistant accessory. |
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

`media/hero-rooms-detail.webp` is a literal crop of `media/ios-home.webp`:
left 32, top 550, width 740, height 808 pixels, WebP quality 88. It is labelled
as an iOS detail and links to the complete source screenshot. The mobile hero
uses this readable room-card detail instead of shrinking the whole panel.
Existing full-size screenshot links remain available for closer inspection.

All images have intrinsic dimensions. The hero is preloaded per breakpoint;
images below it are lazy-loaded. Focus is visible, the preview supports native
arrow-key operation, and reduced motion removes its short crossfade. There are
no timers, scrolling effects or content-reveal dependencies.

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

For website changes, serve this directory under `/hauser/`, render at 360,
390, 768 and 1440 pixels, and check the preview by pointer and keyboard, without
JavaScript and with reduced motion. Check console/network errors, local assets,
anchors and all linked destinations. The public export's existing
`scripts/build-pages.sh` verifies demo/wiki base paths;
`scripts/verify-license-boundary.sh` verifies the asset classes. No deployment
is part of these checks.
