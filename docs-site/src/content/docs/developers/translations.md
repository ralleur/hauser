---
title: Translations
description: Adding or fixing a language.
sidebar:
  order: 5
---

Translations live in `app/messages/<lang>.json`. They are compiled into plain functions at build time with Paraglide, so six languages cost about 50 bytes in the initial bundle.

## Fixing a string

1. Find the key in `app/messages/en.json`.
2. Change the value in the language file.
3. Run `npm test` in `app/`. A test checks that every language has every key.

## Adding a language

1. Copy `en.json` to the new language code.
2. Add the locale in `app/project.inlang/settings.json`.
3. Translate. Keep placeholders such as `{count}` and `{name}`.
4. Run `npm run paraglide:compile` and `npm test`.

## Known limits

Polish has three plural forms, which the message format does not express yet. Affected strings avoid the plural. Room, device and scene names are never translated.

Native-speaker reviews are welcome for French, Italian, Portuguese and Polish. See the [translation issues](https://github.com/ralleur/hauser/issues?q=is%3Aissue+is%3Aopen+label%3Atranslation).
