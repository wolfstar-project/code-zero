# @code-zero/marketing

The public marketing site: the landing page, pricing, contact routes, and the legal documents.

Frontend only. It owns no persistence, holds no credentials, and imports no runtime package.
Unlike `apps/dashboard` — the single deployable app that also serves the API and authentication —
this site has nothing behind it: it links to the dashboard by origin and renders on the server only
because it exists to be crawled, prerendering every route rather than serving a live request.

## Boundaries

| Rule                             | Why                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| No runtime-package imports       | Nothing here may reach `packages/agent`, `packages/runner`, or any other runtime package.         |
| No persistence, no auth handlers | Sign-in links out to the dashboard origin; this app never sees a session.                         |
| No secrets                       | Everything in `config/` is public by construction and ships in the client bundle.                 |
| Nitro is for rendering only      | The only server routes are the ones `@nuxtjs/seo` generates (`/robots.txt`, sitemaps).            |
| Contact form has no backend      | `ContactForm` builds a `mailto:` link client-side; nothing is submitted to or stored by this app. |

`@nuxt/content` keeps a local SQLite index of `content/` at build/dev time to serve queries — that
is a build-time content cache, not application persistence: it holds no user data and no
credentials, and the production build is fully prerendered static HTML.

## Layout

Follows wolfstar.rocks' structure (a project this repo already ports several patterns from — see
the `// Ported from wolfstar.rocks` comments elsewhere): `modules/` is a project-root sibling of
`app/`, reserved for real local Nuxt modules, not a place to stash feature components.

```
app/
  app.vue                     title template, hreflang, site-wide OG defaults
  app.config.ts                non-secret site identity and links (useAppConfig())
  error.vue                   fatal-error shell
  layouts/default.vue         skip link, header, main landmark, footer
  pages/                      /, /pricing, /contact, /blog, /blog/[slug],
                               /legal/privacy, /legal/terms
modules/
  home/                       landing-page sections (Hero, Faq, PricingTable, ...) and composables
    index.ts                  its own local Nuxt module, registering components/ and composables/
  contact/                    the contact form (mailto-based — see Boundaries) and channel list
    index.ts                  local Nuxt module, registering components/
  blog/                       the post card rendered by the listing page
    index.ts                  local Nuxt module, registering components/
  shared/                     header, footer, locale switcher, color-mode toggle, error page
    index.ts                  local Nuxt module, registering components/
  changelog/, analytics/      reserved, not built yet — see each module's README.md
content/
  en/legal/                   Markdown legal documents, queried through the `legal` collection
  en/blog/                    Markdown blog posts, queried through the `blog` collection
i18n/
  i18n.config.ts               vue-i18n composer options (locales themselves stay in nuxt.config.ts)
config/
  content.ts                   landing-page structure: cards, plans, prices, FAQ order
content.config.ts              @nuxt/content collection definitions
```

Copy for the app's _interface_ (nav labels, buttons, section headings) lives in `@code-zero/i18n`
under `locales/<locale>/marketing.json`, so translators work from one place and Lunaria can report
staleness. `config/content.ts` holds only what is not language — ordering, icons, prices, and link
targets — and `test/unit/content.test.ts` asserts that the two agree for every shipped locale.

Copy for _long-form content_ (privacy policy, terms of service, blog posts — prose too long to live
as a JSON string value) lives in `content/en/**` instead, with frontmatter (`title`, `description`,
and document-specific fields) declared in `content.config.ts`. It ships in English only: the
`legal` and `blog` collections both source from `en/` regardless of the visitor's UI locale, which
stays fully translated through `packages/i18n`. `test/unit/legal-content.test.ts` asserts the legal
documents carry valid frontmatter.

There is no `config/app.ts`: site identity (`app.config.ts`, `useAppConfig()`) and the two
environment-derived URLs (read directly in `nuxt.config.ts`, each used exactly once) don't share
enough to justify a wrapper module, and `apps/dashboard` already sets the precedent of using
`appConfig` directly rather than inventing one.

## Environment

| Variable                  | Default                 | Purpose                                                      |
| ------------------------- | ----------------------- | ------------------------------------------------------------ |
| `MARKETING_SITE_URL`      | `http://localhost:3001` | Public origin for canonical URLs, hreflang, and the sitemap. |
| `MARKETING_DASHBOARD_URL` | `http://localhost:3000` | Where "Sign in" and the primary CTAs point.                  |

`MARKETING_SITE_URL` deliberately does **not** reuse `NUXT_PUBLIC_SITE_URL`: the dashboard already
claims that name for its own custom-domain override, and a shared `.env` would otherwise point this
site's canonical URLs at the dashboard's origin. Both are read at build time, so rebuild after
changing them.

## Commands

```bash
aube --filter @code-zero/marketing run dev        # http://localhost:3001
aube --filter @code-zero/marketing run build      # prerenders every route into .output/public
aube --filter @code-zero/marketing run test
aube --filter @code-zero/marketing run typecheck
aube --filter @code-zero/marketing run lint
```

## SEO

`@nuxtjs/seo` supplies the sitemap, `robots.txt`, canonical URLs, and the OG/Twitter defaults;
`@nuxtjs/i18n` runs on `prefix_except_default`, so `/pricing` and `/it/pricing` are separate
indexable documents cross-linked by `hreflang`. Pages declare their own metadata with
`useSeoMeta`, and `app.vue` supplies the title template and the site-wide fallbacks. The legal
pages take their `title`/`description` straight from their Markdown frontmatter instead.

Two deliberate exclusions:

- **Legal pages are `noindex, follow`.** They ship placeholder text that is explicitly not legal
  advice (see the notice at the top of each document in `content/`), and it has no business in
  search results. A deployment that replaces the content should drop the `robots` line from
  `app/pages/legal/*.vue` at the same time; the sitemap picks the routes up automatically either way,
  since they are ordinary prerendered pages.
- **`nuxt-og-image` is disabled.** It resolves fonts over the network at build time, which a build
  that must succeed offline cannot depend on, so the site ships one static card at
  `public/og-image.svg`. Most social platforms only rasterise PNG, so a deployment that cares about
  link previews should export that SVG to `public/og-image.png`, point `ogImage` in `app/app.vue`
  at it, or re-enable the module in `nuxt.config.ts` if its build has network access.

## Adding a landing-page section

1. Add its id (and icon, price, or order) to `config/content.ts`.
2. Add the strings to `locales/en/marketing.json` **and** `locales/it/marketing.json` in
   `packages/i18n`, then run `aube run i18n:schema`.
3. Add the component under `modules/home/components/` and render it from a page.
4. Run `aube --filter @code-zero/marketing run test`; the content contract test fails loudly if a
   locale is missing a key.

Icons reached through a `:name` binding cannot be found by the icon scanner. When a new icon comes
from `config/content.ts`, add its list to `icon.clientBundle.icons` in `nuxt.config.ts` the way
`featureCards` and `logoCloud` already are, or it will silently render as an empty box.

## Adding or editing a legal document

1. Edit (or add) `content/en/legal/<name>.md`, with `title`, `description`, and `lastUpdated` (ISO
   8601 date) frontmatter matching the `legalSchema` in `content.config.ts`.
2. Bump `lastUpdated` whenever the body changes — it is the only thing that tells a returning
   visitor the document is different, and `SiteLegalPage.vue` renders it verbatim.
3. Link a new document from a page: query the `legal` collection (see `app/pages/legal/privacy.vue`
   for the pattern) and wrap the result in `<SiteLegalPage>` + `<ContentRenderer>`.
4. `aube --filter @code-zero/marketing run test` checks the frontmatter is valid and every
   document carries the not-legal-advice notice.

## Adding a blog post

1. Add `content/en/blog/<slug>.md`, with `title`, `description`, `date` (ISO 8601), `author`,
   `authorInitials`, and `tag` frontmatter matching the `blogSchema` in `content.config.ts`. The
   slug becomes the URL (`/blog/<slug>`).
2. That's it — `app/pages/blog/index.vue` lists every post ordered by `date`, and
   `app/pages/blog/[slug].vue` renders it. No page or route registration needed per post.
3. A new `tag` value appears automatically in the listing page's filter chips.
