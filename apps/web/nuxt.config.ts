import { symlink, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Read from `@code-zero/auth/config` rather than restated here, so the build-time flag below and
// the server plugins in `server/auth.config.ts` cannot drift. That subpath carries policy only,
// with none of the database dependencies `authBetterAuthOptions` needs.
import { infraFromEnvironment } from '@code-zero/auth/config';
import { defaultLocale, i18nLocalesFor, localeCookieName } from '@code-zero/i18n';
import { defineNuxtConfig } from 'nuxt/config';

import {
  viteHubPresetFromEnvironment,
  viteHubVercelEntryAlias,
  type ViteHubPreset,
} from './config/env.js';

// The sign-in policy is deliberately not read here. Pages ask `/api/capabilities` at runtime, which
// derives it from the same environment `server/auth.config.ts` builds Better Auth from, so changing
// AUTH_ENABLE_SIGNUP or a provider's credentials needs a restart, not a rebuild.
//
// The hosted-infrastructure settings are the one exception, because they decide which client code
// ships: `app/auth.config.ts` loads `sentinelClient()` only where they are configured.
const infra = infraFromEnvironment();

// Only the KV origin is read out of the hosted-infrastructure settings, and only so the browser
// can be told where to identify. The API key sitting next to it in `infraFromEnvironment()` is
// never touched here: appConfig is published to the client, so anything read into it leaves the
// server.
const infraKvUrl = infra?.kvUrl ?? '';

// ViteHub's deployment preset is a build-time decision that also pins Nitro's own preset, so the
// deployment target has to be resolved here rather than detected later: `node` emits the
// self-hosted `.output/` bundle, `vercel` emits `.vercel/output`. See `config/env.ts`.
const viteHubPreset = viteHubPresetFromEnvironment();

// The ViteHub integration, except where the build emits a Worker: see the comment on the module
// list below for why Cloudflare goes without it.
const viteHubModules: [string, { preset: ViteHubPreset; kv: true }][] =
  viteHubPreset === 'cloudflare' ? [] : [['vite-hub/nuxt', { preset: viteHubPreset, kv: true }]];

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
    //
    // Not registered for Cloudflare: its KV runtime cannot be resolved by the Nitro build that
    // emits a Worker, so that target aliases `vite-hub/kv` to a Workers KV adapter (see `nitro`
    // below) and has no use for the rest of the integration.
    ...viteHubModules,
    // Publishes what this build is (version, commit, branch, deploy channel) under
    // `runtimeConfig.public.buildInfo`. On Vercel the values are resolved while the build runs;
    // every other target resolves what it can and the server completes the rest at boot, so a
    // self-hosted bundle still reports the commit it was built from. See packages/build-env.
    '@code-zero/build-env/nuxt',
    '@unocss/nuxt',
    '@nuxt/icon',
    '@nuxtjs/i18n',
    '@onmax/nuxt-better-auth',
    '@nuxt/test-utils',
    '@nuxtjs/color-mode',
  ],
  css: ['@code-zero/ui/tokens.css', '~/assets/css/main.css'],

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
    storageKey: 'code-zero-color-mode',
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
  // onto public runtime keys, which would let a deployment load the sentinel client while its
  // server registers no `sentinel()` plugin. appConfig has no env override channel, so the
  // `BETTER_AUTH_*` credentials stay the single source for both halves. Sign-in capabilities are
  // not here: pages read them from `/api/capabilities` at runtime.
  appConfig: {
    auth: {
      // Read by `app/auth.config.ts` to decide whether to load `sentinelClient()`. Not a label:
      // the sentinel client identifies every visitor against Better Auth's KV service from their
      // browser, so publishing it wrongly would send a self-hosted deployment's visitors to a
      // third party.
      enableInfra: infra !== undefined,
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
      title: 'Code Zero · Dashboard',
    },
  },

  nitro: {
    ...(viteHubPreset === 'cloudflare'
      ? {
          // A Worker, not Pages: the dashboard has server routes and a custom domain of its own.
          preset: 'cloudflare_module',
          // Wraps the preset's own worker to settle inbound mail itself. The preset's `email` runs
          // its hook under `waitUntil` and returns at once, which ends the event before a message
          // has been forwarded or refused.
          entry: fileURLToPath(new URL('./server/cloudflare/entry.ts', import.meta.url)),
          // The scoped database (`server/utils/database.ts`) finds the Hyperdrive binding of the
          // request being served through `useEvent()`, which needs the request kept in async
          // context. Only this target pays for it.
          experimental: { asyncContext: true },
          // `deployConfig` merges `wrangler.jsonc` into `.output/server/wrangler.json`, the file
          // `wrangler deploy` reads; `nodeCompat` makes the build target `nodejs_compat`, which the
          // database driver and Better Auth rely on.
          cloudflare: { deployConfig: true, nodeCompat: true },
          // The passkey verifier (`@peculiar/x509` → `tsyringe`) needs `reflect-metadata` to run
          // before it, and imports it only for that effect. Left to tree-shaking, the bundle keeps
          // the code but never runs it, and the Worker refuses to start.
          moduleSideEffects: ['reflect-metadata'],
          // `store.ts` keeps importing `kv` from `vite-hub/kv`; on Cloudflare that name resolves to
          // an adapter over the Worker's own KV binding.
          // Packages that cannot run in a Worker, replaced by modules that say why. `resend` loads
          // a React renderer Code Zero does not use, the two subscription providers drive a local
          // CLI, and `safer-buffer` throws while the bundle starts. A bundle cannot leave an import
          // unresolved, so each one points at a stand-in.
          alias: {
            'safer-buffer': fileURLToPath(
              new URL('./server/cloudflare/safer-buffer.ts', import.meta.url),
            ),
            'ai-sdk-provider-claude-code': fileURLToPath(
              new URL('./server/cloudflare/subscription-provider.ts', import.meta.url),
            ),
            'ai-sdk-provider-codex-cli': fileURLToPath(
              new URL('./server/cloudflare/subscription-provider.ts', import.meta.url),
            ),
            'vite-hub/kv': fileURLToPath(new URL('./server/cloudflare/kv.ts', import.meta.url)),
            '@react-email/render': fileURLToPath(
              new URL('./server/cloudflare/react-email-render.ts', import.meta.url),
            ),
          },
        }
      : {}),
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
    // (the router's `audit.list`), so a non-admin sees the refusal rather than a redirect.
    '/audit': { appLayout: 'default', auth: { only: 'user' } },
    // Same reasoning: who may read or change the settings is the router's `settings.*` decision
    // (admin self-hosted, membership and role on the managed cloud), shown on the page itself.
    '/settings': { appLayout: 'default', auth: { only: 'user' } },
    '/login': { auth: { only: 'guest' } },
    '/signin': { auth: { only: 'guest' } },
    // The second-factor challenge belongs to a sign-in that has not produced a session yet, so it
    // is a guest page like `/login`; the server's short-lived challenge cookie, not the URL, is
    // what makes the verification endpoints accept a code.
    '/two-factor': { auth: { only: 'guest' } },
    '/organizations': { appLayout: 'default', auth: { only: 'user' } },
    // Approving a device request mints a session for a client that never sees this browser, so the
    // approval has to be attributable: a signed-out visitor is sent to sign in and back rather
    // than being shown the form. The auth layout, not the shell, because the visitor arriving here
    // typed a code off a terminal and has no business in the navigation.
    '/device': { auth: { only: 'user' } },
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
