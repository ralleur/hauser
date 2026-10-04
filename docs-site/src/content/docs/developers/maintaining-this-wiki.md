---
title: Maintaining this wiki
description: How to add or change a page, for humans and AI agents.
sidebar:
  order: 8
---

The guide lives in `docs-site/` and is built with [Astro Starlight](https://starlight.astro.build/). Pages are Markdown under `docs-site/src/content/docs/`.

## Build it

```bash
cd docs-site
npm ci
npm run build
```

The build fails on a broken internal link. `npm run dev` serves it locally.

## Rules

- Document only what the code does. Planned ideas belong in the roadmap, not here.
- Search existing pages before adding one. Prefer editing.
- Internal links start with `/hauser/docs/` and end with a slash. Screenshots come from `/hauser/media/`.
- Short paragraphs, plain words, one idea per sentence. Tables for references, asides for warnings.
- Frontmatter needs `title` and `description`. Order pages with `sidebar.order`.

The full rule set for agents is in [`docs-site/AGENTS.md`](https://github.com/ralleur/hauser/blob/main/docs-site/AGENTS.md).

## Presentation and product scope

The homepage starts with Apple Home and Home Assistant as separate choices.
Keep those paths visible. Mark instructions that apply only to the Hauser
server, the web interface or the native iOS app; do not imply feature parity.

`astro.config.mjs` keeps the existing page URLs and places the native app in
Getting started. `src/styles/custom.css` adapts Starlight using the shared
`design-tokens/tokens.css` in its reset layer. Shared tokens are read, never
changed for documentation styling. Alegreya Sans carries instructions and
navigation; Alegreya is reserved for the guide’s introductory line. Fonts are
bundled locally. The header imports the original light and dark wordmarks from
`app/public/brand/`; do not recreate them with text.

Use real screenshots from `/hauser/media/`, with meaningful alternative text,
intrinsic dimensions and a link to a larger version when detail matters.
Provider costs, external processing and beta limits belong beside the relevant
instructions. Avoid fixed quotas or blanket “free” and “no cloud” claims.

After a presentation change, build the guide and inspect both its homepage and
an article at phone, tablet and desktop widths. Check navigation, search,
light/dark themes and image loading under `/hauser/docs/`.
