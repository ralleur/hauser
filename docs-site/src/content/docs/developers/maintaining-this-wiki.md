---
title: Maintaining this wiki
description: How to add or change a page, for humans and AI agents.
sidebar:
  order: 8
---

The wiki lives in `docs-site/` and is built with [Astro Starlight](https://starlight.astro.build/). Pages are Markdown under `docs-site/src/content/docs/`.

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
