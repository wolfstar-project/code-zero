import process from 'node:process';

import { defaultLocale, i18nLocalesFor, localeCookieName } from '@agent-zero/i18n';
import { defineNuxtConfig } from 'nuxt/config';

import { featureCards, logoCloud } from './config/content.js';

// Only the scopes this app renders: every listed file is deep-merged into the bundle whether or
// not a key from it is read, so the dashboard's auth/organizations copy has no business being
// here — the reverse of the reason `apps/dashboard/nuxt.config.ts` doesn't load `marketing.json`.
const marketingLocales = i18nLocalesFor(['common.json', 'errors.json', 'marketing.json']);

// `crawlLinks` only discovers a route by following a crawlable `<a href>` it finds while
// prerendering an already-seeded page. LocaleSwitcher.vue navigates locales with `setLocale()`
// (a JS call, not a real link), so nothing ever points the crawler at `/it` — every non-default
// locale root has to be seeded explicitly, or its whole route tree is silently missing from the
// static build.
const nonDefaultLocaleRoots = marketingLocales
  .filter((locale) => locale.code !== defaultLocale)
  .map((locale) => `/${locale.code}`);

export default defineNuxtConfig({
  compatibilityDate: '2026-08-09',
  devtools: { enabled: false },
  // The opposite trade-off from the dashboard: this site exists to be crawled, quoted, and read
  // over a cold connection, so every route is rendered ahead of time and shipped as HTML.
  ssr: true,
  future: {
    compatibilityVersion: 5,
  },
  devServer: {
    // 3000 is the dashboard (the single deployable app, UI + API + auth).
    port: 3001,
  },
  // `modules/` is scanned by Nuxt itself, so the local feature modules (shared, home, contact,
  // blog, i18n-strip-empty) register themselves without being listed here.
  modules: [
    // Publishes what this build is (version, commit, branch, deploy channel) under
    // `runtimeConfig.public.buildInfo`. On Vercel the values are resolved while the build runs;
    // every other target resolves what it can and the server completes the rest at boot, so a
    // self-hosted bundle still reports the commit it was built from. See packages/build-env.
    '@agent-zero/build-env/nuxt',
    '@unocss/nuxt',
    '@nuxt/icon',
    '@nuxt/content',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    '@nuxt/test-utils',
    '@nuxtjs/color-mode',
    '@vite-pwa/nuxt',
  ],
  css: ['~/assets/css/main.css'],

  $test: {
    debug: {
      hydration: true,
    },
  },

  colorMode: {
    preference: 'system',
    fallback: 'dark',
    dataValue: 'theme',
    classSuffix: '',
    // Deliberately distinct from the dashboard's key: the two apps are separate origins in
    // production, and sharing a key would only couple them if they were ever proxied under one.
    storageKey: 'agent-zero-color-mode',
  },

  icon: {
    provider: 'iconify',
    clientBundle: {
      // Catches every icon named as a literal in a template or SFC script block.
      scan: true,
      // The scanner cannot see icons that reach `<Icon>` through a `:name` binding, so the ones
      // that live in `config/content.ts` are listed from that same source. Deriving the list
      // instead of retyping it means adding a card cannot silently ship a missing icon.
      icons: [...featureCards.map((card) => card.icon), ...logoCloud.map((entry) => entry.icon)],
    },
  },

  content: {
    experimental: {
      // Node's built-in `node:sqlite` (Node 22.5+; this repo requires 24.2+) rather than the
      // `better-sqlite3` connector, which needs a native build step this repo's dependency
      // policy does not allow-list and CI does not run interactively to approve.
      nativeSqlite: true,
      sqliteConnector: 'native',
    },
  },

  i18n: {
    locales: marketingLocales,
    defaultLocale,
    // Locale-prefixed URLs are the point on a public site: they give each translation its own
    // indexable URL, which is also what lets the sitemap and hreflang tags describe them.
    strategy: 'prefix_except_default',
    // Paths are resolved relative to `restructureDir` (default "i18n/"), so this points at
    // i18n/locales/ — a symlink to `packages/i18n/locales`, keeping one copy of the dictionaries
    // for every app. The vue-i18n runtime config is auto-loaded from i18n/i18n.config.ts.
    langDir: 'locales',
    // `baseUrl` is deliberately not set here: `site.url` below is the single origin, and
    // `@nuxtjs/seo` feeds it to the i18n module, the sitemap, and the canonical tags alike.
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: localeCookieName,
      // Redirecting a crawler off the URL it requested is the fastest way to lose the canonical.
      redirectOn: 'root',
      alwaysRedirect: false,
      fallbackLocale: defaultLocale,
    },
  },

  site: {
    // Mirrors `app.config.ts`'s `site.name`: that file is runtime-only (`useAppConfig()`), while
    // `@nuxtjs/seo` needs a literal value here at build time, so the two cannot share one source.
    name: 'Agent Zero',
    description:
      'The open-source autonomous engineer that finds, fixes, and verifies problems in pull requests.',
    // This is a prerendered site with no incoming request to auto-detect an origin from, so
    // unlike the dashboard's NUXT_PUBLIC_SITE_URL (optional there), this has to be set for a
    // production build — see .env.example.
    url: process.env.MARKETING_SITE_URL,
  },

  $development: {
    site: {
      url: 'http://localhost:3001',
    },
  },

  router: {
    options: {
      scrollBehaviorType: 'smooth',
    },
  },

  experimental: {
    entryImportMap: false,
    typescriptPlugin: true,
    viteEnvironmentApi: true,
    typedPages: true,
  },

  robots: {
    allow: '*',
  },

  sitemap: {
    // Every route — including blog posts — is prerendered ahead of time (`nitro.prerender.crawlLinks`
    // below follows every link it finds, starting from `/`), so the sitemap needs no dynamic source:
    // it is built from the same static file list the build already produced.
    sources: [],
  },

  // `nuxt-og-image` renders per-page social cards, but it resolves its fonts over the network at
  // build time, which a build that must succeed offline and byte-for-byte cannot depend on. The
  // site ships one static card instead (`public/og-image.svg`, referenced from `app/app.vue`);
  // see this app's README for swapping in a rasterised PNG or turning generation back on.
  ogImage: { enabled: false },

  pwa: {
    // `disable: true` turns off the whole plugin — manifest injection included, not just the
    // service worker (verified against npmx.dev's own production site, which sets this same
    // option and ships no manifest link either). What's left is favicon/apple-touch-icon assets
    // and their head links, generated ahead of time rather than at build or dev-server time.
    disable: true,
    pwaAssets: {
      // `disabled: true` (not just `config: false`) so nothing tries to regenerate icons at
      // dev-server or build time — they're pre-generated by
      // `aube --filter @agent-zero/marketing run generate-pwa-icons` (see pwa-assets.config.ts)
      // and committed as static files.
      disabled: true,
      config: false,
    },
    manifest: {
      name: 'Agent Zero',
      short_name: 'Agent Zero',
      description:
        'The open-source autonomous engineer that finds, fixes, and verifies problems in pull requests.',
      theme_color: '#0f1512',
      background_color: '#0f1512',
      icons: [
        { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: 'maskable-icon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
  },

  runtimeConfig: {
    public: {
      // Falls back to the dashboard's dev port; a deployment sets MARKETING_DASHBOARD_URL
      // (see .env.example) rather than rebuilding with a different default.
      dashboardUrl: process.env.MARKETING_DASHBOARD_URL || 'http://localhost:3000',
    },
  },

  app: {
    head: {
      meta: [{ name: 'color-scheme', content: 'dark light' }],
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    },
  },

  nitro: {
    prerender: {
      crawlLinks: true,
      // `/robots.txt` is a Nitro route rather than a page, so the crawler never reaches it; listing
      // it explicitly means a purely static deployment still serves one.
      routes: ['/', '/robots.txt', ...nonDefaultLocaleRoots],
    },
  },

  vite: {
    css: {
      transformer: 'lightningcss',
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
    // Extends the generated `.nuxt/tsconfig.*.json` projects rather than a hand-maintained
    // `test/tsconfig.json` + `.vue` shim: `vue-tsc -b` already resolves `.vue` imports, so specs
    // that import components only need to be in its scope, matching the pattern this pattern
    // follows from npmx.dev and wolfstar.rocks.
    tsConfig: {
      compilerOptions: {
        noUnusedLocals: true,
        allowImportingTsExtensions: true,
      },
      // `test/nuxt/**` runs in a Nuxt/DOM context and imports `.vue` components directly.
      // `pwa-assets.d.ts` types the `virtual:pwa-assets/*` modules the generated
      // `.nuxt/pwa-icons-plugin.ts` imports (a `types` array entry can't resolve that package's
      // subpath export the way a triple-slash reference does).
      include: ['../test/nuxt/**/*.ts', '../pwa-assets.d.ts'],
    },
    nodeTsConfig: {
      compilerOptions: {
        allowImportingTsExtensions: true,
      },
      // Root config, unit, and Playwright files run in Node rather than the app's Vue context.
      include: ['../*.ts', '../test/unit/**/*.ts', '../test/e2e/**/*.ts'],
    },
  },

  hooks: {
    ready(nuxt) {
      // `nuxt-site-config` (via `@nuxtjs/seo`) stores its own internal resolution stack under this
      // runtimeConfig key. `@nuxt/test-utils`'s vitest environment `structuredClone`s the whole
      // `runtimeConfig` while resolving the `nuxt` project, and that stack isn't plain-cloneable —
      // nothing in this app calls `useSiteConfig()` itself, and site-config's own runtime
      // composables read its module-level singleton directly, not this mirror, so dropping it here
      // only affects what the test harness snapshots.
      if (process.env.VITEST) {
        // oxlint-disable-next-line no-unsafe-type-assertion -- test-only sanitization, see above
        (nuxt.options.runtimeConfig as Record<string, unknown>)['nuxt-site-config'] = undefined;
      }
    },
  },
});
