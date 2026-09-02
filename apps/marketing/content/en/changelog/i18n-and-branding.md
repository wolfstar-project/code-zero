---
title: 'Shared i18n, a real logo, and offline PWA icons'
description: 'Locale configuration moved into one package every app scopes to its own copy; the marketing site got its actual brand mark and installable icons.'
version: 'v0.4.0'
date: '2026-08-16'
---

Translation dictionaries used to be duplicated per app. They now live in one place, and every app
declares exactly the feature files it renders — the marketing site never ships the dashboard's
authentication or organization copy, and the reverse holds too.

## What shipped

- `@code-zero/i18n` centralizes locale metadata, date and number formats, and the scoping
  function every app calls with its own narrow list of feature files.
- The marketing site's header and footer now render the real Code Zero mark instead of a text
  placeholder, as an inline component so its light and dark theming survives the build untouched.
- Installable app icons are generated ahead of time and committed as static files, so nothing
  regenerates them at dev-server or build time.
