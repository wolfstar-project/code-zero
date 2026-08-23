import { symlink, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import process from 'node:process';

// Read from `@agent-zero/auth/config` rather than restated here, so the build-time label below and
// the runtime enforcement in `server/auth.config.ts` cannot drift. That subpath carries policy
// only, with none of the database dependencies `authBetterAuthOptions` needs.
import { authConfigFromEnvironment, infraFromEnvironment } from '@agent-zero/auth/config';
import { defaultLocale, i18nLocalesFor, localeCookieName } from '@agent-zero/i18n';
import { defineNuxtConfig } from 'nuxt/config';

import { viteHubPresetFromEnvironment, viteHubVercelEntryAlias } from './config/env.js';

// Resolved once at config evaluation so the dashboard's auth pages publish the same sign-in
// policy `server/auth.config.ts` enforces at runtime (AUTH_ENABLE_SIGNUP, GitHub OAuth
// credentials). Build-time capture is deliberate: the deployment contract (documented in README
// and .env.example) is that the app is rebuilt whenever those policy variables change. The server
// config enforces its own policy regardless, so a stale build can only mislabel a page, never open
// a sign-in method the server rejects.
const authPolicy = authConfigFromEnvironment();

// Only the KV origin is read out of the hosted-infrastructure settings, and only so the browser
// can be told where to identify. The API key sitting next to it in `infraFromEnvironment()` is
// never touched here: appConfig is published to the client, so anything read into it leaves the
// server.
const infraKvUrl = infraFromEnvironment()?.kvUrl ?? '';

// ViteHub's deployment preset is a build-time decision that also pins Nitro's own preset, so the
// deployment target has to be resolved here rather than detected later: `node` emits the
// self-hosted `.output/` bundle, `vercel` emits `.vercel/output`. See `config/env.ts`.
const viteHubPreset = viteHubPresetFromEnvironment();

// Set by the `compiled` listener below and consumed by `close`, which removes the bridge again.
let viteHubVercelEntry: string | undefined;

// Only the scopes this app renders: every listed file is deep-merged into the bundle whether or
// not a key from it is read, so the marketing site's copy has no business being here — the reverse
// of the reason `apps/marketing/nuxt.config.ts` doesn't load `dashboard.json`.
const dashboardLocales = i18nLocalesFor([
  'common.json',
  'errors.json',
  'auth.json',
  'dashboard.json',
  'organizations.json',
]);

export default defineNuxtConfig({
  compatibilityDate: '2026-08-09',
  devtools: { enabled: false },
  // Better Auth is mounted in-process (`server/auth.config.ts`), so the session cookie belongs to
  // this app's own origin and a server render can observe it directly: SSR resolves the session
  // from the request cookie before the first paint, instead of flashing a signed-out page that the
  // client then corrects.
  ssr: true,
  future: {
    compatibilityVersion: 5,
  },
  devServer: {
    // 3001 is the marketing site (frontend only, no API and no session).
    port: 3000,
  },
  // `modules/` is scanned by Nuxt itself, so the local feature modules (shared, auth, dashboard,
  // organizations, i18n-strip-empty) register themselves — and register their own component and
  // composable directories — without being listed here. Installed modules are listed below.
  modules: [
    // `server/utils/store.ts` imports `kv` from `vite-hub/kv`; that Runtime Helper only resolves a
    // live driver when this integration ran during the build that produced the app. `kv` stays at
    // its resolved default (`fs-lite` under `.data/kv` when self-hosted, the host's own driver —
    // Upstash on Vercel — otherwise): ViteHub picks the driver from the deployment preset, and a
    // serverless function has no writable filesystem to keep task history on.
    ['vite-hub/nuxt', { preset: viteHubPreset, kv: true }],
    // Publishes what this build is (version, commit, branch, deploy channel) under
    // `runtimeConfig.public.buildInfo`. On Vercel the values are resolved while the build runs;
    // every other target resolves what it can and the server completes the rest at boot, so a
    // self-hosted bundle still reports the commit it was built from. See packages/build-env.
    '@agent-zero/build-env/nuxt',
    '@unocss/nuxt',
    '@nuxt/icon',
    '@nuxtjs/i18n',
    '@onmax/nuxt-better-auth',
    '@nuxt/test-utils',
    '@nuxtjs/color-mode',
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
    storageKey: 'agent-zero-color-mode',
  },

  icon: {
    // Icons stay fully client-bundled rather than served or fetched at runtime, regardless of the
    // app's own server routes. Every icon is scanned from the templates at build time and compiled
    // into the client bundle from the locally installed lucide collection.
    provider: 'none',
    serverBundle: false,
    fallbackToApi: false,
    clientBundle: { scan: true },
  },

  i18n: {
    locales: dashboardLocales,
    defaultLocale,
    // The dashboard is a single internal surface, so localised URL prefixes would only churn
    // route paths without buying any of the SEO they exist for.
    strategy: 'no_prefix',
    // Paths are resolved relative to `restructureDir` (default "i18n/"), so this points at
    // i18n/locales/ — a symlink to `packages/i18n/locales`, keeping one copy of the dictionaries
    // for every app. The vue-i18n runtime config is auto-loaded from i18n/i18n.config.ts.
    langDir: 'locales',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: localeCookieName,
      alwaysRedirect: false,
      fallbackLocale: defaultLocale,
    },
  },

  auth: {
    // Full mode: the module reads `server/auth.config.ts`, mounts Better Auth at `/api/auth/**`
    // itself, and resolves sessions server-side from the request cookie for SSR.
    redirects: {
      login: '/login',
      guest: '/',
      authenticated: '/',
      logout: '/login',
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
    typedPages: true,
  },

  runtimeConfig: {
    public: {
      // The module auto-detects the base URL from the incoming request in most deployments.
      // Declared here (empty by default) so NUXT_PUBLIC_SITE_URL can still override it for a
      // custom domain or deterministic OAuth callbacks.
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? '',
    },
  },

  // Published through appConfig rather than runtimeConfig.public: Nuxt maps NUXT_PUBLIC_* env vars
  // onto public runtime keys, which would let a deployment advertise a sign-in capability that
  // diverges from the policy `server/auth.config.ts` enforces from the same environment. appConfig
  // has no env override channel, so AUTH_ENABLE_SIGNUP and the GitHub OAuth credentials stay the
  // single authoritative source for both the build-time label and the runtime enforcement.
  appConfig: {
    auth: {
      enableSignup: authPolicy.enableSignup,
      enableGithubOauth: authPolicy.enableGithubOauth,
      enableOrganizations: authPolicy.enableOrganizations,
      // Read by `app/auth.config.ts` to decide whether to load `sentinelClient()`. Unlike the
      // three above, this one is not a label: the sentinel client identifies every visitor
      // against Better Auth's KV service from their browser, so publishing it wrongly would send
      // a self-hosted deployment's visitors to a third party. appConfig having no env override
      // channel is what makes `BETTER_AUTH_*` the single source for both halves.
      enableInfra: authPolicy.enableInfra,
      // The project's own ingestion endpoint. Without it `sentinelClient()` falls back to Better
      // Auth's shared global one, which its own startup warning calls out as not recommended.
      // Not a secret — the visitor's browser posts to it directly — unlike the API key it is
      // provisioned alongside, which stays server-side.
      infraKvUrl,
    },
  },

  app: {
    head: {
      meta: [{ name: 'color-scheme', content: 'dark light' }],
      // Repeated in `app/app.vue`'s `useSeoMeta()`: the document needs a title before the app
      // boots, and the social tags need the same string once it has. Pages override both.
      title: 'Agent Zero · Dashboard',
    },
  },

  nitro: {
    // Registered as a Nitro module rather than through `nitro.hooks`: a handler under that key
    // replaces the preset's own handler for the same hook, and the `vercel` preset writes
    // `config.json` and each function's `.vc-config.json` from its `compiled` hook — losing it
    // leaves an output directory Vercel cannot read. A module appends its listeners instead, and
    // runs after the preset's and before ViteHub's, which is the order this bridge needs.
    modules: [
      (nitro) => {
        if (viteHubPreset !== 'vercel') return;

        // `vite-hub@0.0.3`'s `vercel` plan asserts on a function directory the installed
        // `nitropack@2.13.4` no longer emits under that name (see `config/env.ts`). Linking
        // the name it expects to the one the preset produced lets its check pass on an otherwise
        // correct bundle; `close` removes the link, so the deployment ships one function, not two.
        nitro.hooks.hook('compiled', async () => {
          const serverDirectory = nitro.options.output.serverDir;
          viteHubVercelEntry = viteHubVercelEntryAlias(serverDirectory);
          await symlink(basename(serverDirectory), viteHubVercelEntry, 'dir').catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== 'EEXIST') throw error;
            },
          );
        });

        nitro.hooks.hook('close', async () => {
          if (!viteHubVercelEntry) return;
          const entry = viteHubVercelEntry;
          viteHubVercelEntry = undefined;
          await unlink(entry).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
        });
      },
    ],
  },

  routeRules: {
    '/': { appLayout: 'default', auth: { only: 'user' } },
    // A session is enough to reach the page; the admin role is enforced by the endpoint it reads
    // (`server/api/audit-logs.get.ts`), so a non-admin sees the refusal rather than a redirect.
    '/audit': { appLayout: 'default', auth: { only: 'user' } },
    '/login': { auth: { only: 'guest' } },
    '/signin': { auth: { only: 'guest' } },
    '/organizations': { appLayout: 'default', auth: { only: 'user' } },
    // Approving a device request mints a session for a client that never sees this browser, so the
    // approval has to be attributable: a signed-out visitor is sent to sign in and back rather
    // than being shown the form. The auth layout, not the shell, because the visitor arriving here
    // typed a code off a terminal and has no business in the navigation.
    '/device': { auth: { only: 'user' } },
    // Reached from an invitation email, so the visitor is frequently signed out at that moment:
    // requiring a session sends them through /login and back, rather than rejecting the link.
    '/organizations/accept-invitation/**': { appLayout: 'default', auth: { only: 'user' } },
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
    // `tsconfig.e2e.json` + `.vue` shim: `nuxt typecheck` (Golar, see golar.config.ts) already
    // resolves `.vue` imports, so specs that import components only need to be in its scope.
    tsConfig: {
      compilerOptions: {
        noUnusedLocals: true,
        allowImportingTsExtensions: true,
      },
      // `test/nuxt/**` runs in a Nuxt/DOM context and imports `.vue` components directly.
      include: ['../test/nuxt/**/*.ts'],
    },
    nodeTsConfig: {
      compilerOptions: {
        allowImportingTsExtensions: true,
      },
      // `test/unit/**` is plain Node: no DOM, no `.vue` imports, explicit imports only.
      // `test/e2e/**` and `playwright.config.ts` run in Playwright's own Node process.
      include: ['../test/unit/**/*.ts', '../test/e2e/**/*.ts', '../playwright.config.ts'],
    },
  },
});
