# Hauser project website

## Interactive product presentation (2026-10-30)

The homepage is Hauser itself: a working demo with simulated devices, presented
through a guided tour or free exploration. `experience/index.html` is the entry
template; `experience/copy.js` supplies the English and German copy used both
by the static page generator and by the running tour. Generated `/` and `/de/`
keep canonical URLs, reciprocal language links, social metadata and structured
data. Browser language and a remembered explicit choice select the first visit.
The existing Home Assistant and Apple Home topic pages and `/docs/` remain.
Without JavaScript, a short product introduction links directly to installation
and the source code. Existing installation anchors open the installation sheet.

Desktop has five chapters: image control, rooms and customization, energy,
household lists, and standby with a map. Chapter 01 has four guided stops:
switching, actual lamp controls, scenes and central climate. Chapter 02 includes
the actual room-image editor and appearance settings. Back/next controls sit
inside the explanation card. Visitors can collapse explanations, jump chapters,
open product details, or switch to free exploration.

Mobile uses Hauser's phone shell at the actual screen width. It has four
chapters and no standby. The explanation card is absent; chapter shortcuts,
free exploration and back/next remain in a compact 80 px footer. The same
guided stops open the actual app surfaces. Crossing 768 px reloads the embedded
demo for the device class and moves navigation between footer and explanation.
Desktop keeps a logical viewport of at least 1440 px, scaled as a whole.

The explicit `presentation=1` flag enables the same-origin demo bridge. Normal
demo visits keep their own hints. The determinate loading bar follows document,
app, shell, opening room image and font milestones; other room images load as
used. A slow-load notice offers a retry. Demo residents are fictional (Mia and
Leo), including reminders and calendar content.

## Production build and publication

The authoritative source is this development checkout plus
`tools/public-export/files/scripts/`. In the sanitized public source tree,
`./scripts/build-pages.sh` generates both languages, builds the direct demo,
builds the embedded presentation and builds the wiki. It verifies shared asset
paths and the entry pages. The presentation's HTML is served at `/presentation/`,
outside the direct demo's service-worker scope. Both builds share `/demo/`
assets, images and fonts, avoiding a second full public asset copy. The embedded
build does not install a PWA or precache the application. The normal `/demo/`
retains its PWA behavior. Design tokens are copied to `/design-tokens/`.

Publication uses the existing `ralleur/hauser` GitHub Pages workflow, `pages.yml`.
A website publication does not create an application release tag or container
release. Only the website, its demo presentation changes and Pages tooling are
included; unrelated local work is retained. The owner's weekday 08:00–18:00
public-repository window applies unless explicitly suspended for the run.

## Local iteration

Build with `node tools/build-experience.mjs`, then run
`node tools/preview-experience.mjs`. The compiled demo is in
`app/dist-experience/`; shared assets are read directly from `app/public/`.
The preview server supplies Brotli/gzip and validators, and retains fingerprinted
chunks for open tabs. Website-only HTML/CSS/JS changes are read live.

The local entry is `http://localhost:4190/hauser/?lang=de`. The owner can
map this preview through an existing private tailnet service.

## Assets and licences

The presentation reuses existing public illustrations, room photographs, fonts,
brand assets and demo map data. No new media licence class is introduced.
Application code and documentation are AGPL-3.0-only; illustrations and public
screenshots in `website/media/` are CC BY 4.0; Hauser branding is reserved.
Bundled fonts retain SIL OFL and map data OpenStreetMap attribution. The public
export's `scripts/verify-license-boundary.sh` verifies these classes.
