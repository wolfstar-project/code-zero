---
title: 'A public home for Code Zero'
description: 'The marketing site launches: pricing, a blog, and a contact page — separate from the dashboard, with no persistence and no credentials.'
version: 'v0.4.0'
date: '2026-08-15'
---

Code Zero now has a public site that is not the dashboard. It exists to explain the runtime,
publish pricing, and take questions from people who have not signed in yet — so it carries no
session, no database connection, and no runtime-package imports of its own.

## What shipped

- A pricing page with monthly and yearly billing, matching the Community, Team, and Enterprise
  tiers.
- A contact page with a mailto-based form and direct links for issues, email, and security
  reports.
- A blog, sourced from Markdown and rendered ahead of time like every other route on the site.

Everything is prerendered at build time and served as static HTML, because a site whose job is to
be read and quoted has no business waiting on a server round trip.
