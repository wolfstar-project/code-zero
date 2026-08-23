import { addImports, addTemplate, defineNuxtModule } from '@nuxt/kit';

import { resolveBuildInfo } from './resolve.js';
import type { BuildInfo } from './types.js';

export interface BuildEnvModuleOptions {
  /** The branch a non-pull-request deploy has to be on to be the canary. Defaults to `main`. */
  defaultBranch?: string;
  /**
   * Whether `useBuildInfo()` completes unresolved fields from the server's own environment.
   *
   * On by default, and the reason this module exists rather than a few lines in `nuxt.config.ts`:
   * a Vercel build resolves everything while it runs, and every other deployment — a container
   * image built in CI, a self-hosted `node .output/server/index.mjs` — has nothing to resolve
   * from until it is started. Turn it off only for a bundle that must publish exactly what it was
   * built with.
   */
  runtimeFallback?: boolean;
}

/**
 * Deterministic metadata for test and prerender-snapshot runs.
 *
 * Tests must not depend on the checkout they run in: reading the real branch and commit would make
 * every assertion that renders build metadata fail on someone else's machine, and every snapshot
 * churn on each commit.
 */
const testBuildInfo: BuildInfo = {
  version: '0.0.0',
  commit: '0000000000000000000000000000000000000000',
  branch: 'test',
  env: 'dev',
  time: 0,
  prNumber: null,
  previewUrl: null,
  productionUrl: null,
};

/**
 * Publishes what this build is, under `runtimeConfig.public.buildInfo`.
 *
 * `runtimeConfig.public` rather than `appConfig`: the npmx.dev and wolfstar.rocks modules this
 * package's shape is modelled on both use `appConfig` for the same data, but only because every
 * build of theirs runs on a host (Vercel, Netlify) that already has full git metadata *at build
 * time* — appConfig is a pure build-time constant, identical in the client and server bundles,
 * with no channel to change after the fact. Agent Zero also ships a self-hosted bundle and can run
 * behind hosts that only expose that metadata once the *server* starts, so this needs a value that
 * can still be completed after the build without the client and server ending up with two
 * different answers — which is what `runtimeConfig.public` plus the `useState`-backed composable
 * below gives: the server-completed answer is serialised into the SSR payload the client hydrates
 * from, rather than the client silently reverting to the build's uncompleted one.
 */
export default defineNuxtModule<BuildEnvModuleOptions>({
  meta: {
    name: 'agent-zero:build-env',
    configKey: 'buildEnv',
  },
  defaults: {
    runtimeFallback: true,
  },
  async setup(options, nuxt) {
    const buildInfo =
      nuxt.options.test || process.env.NODE_ENV === 'test'
        ? testBuildInfo
        : await resolveBuildInfo({
            rootDirectory: nuxt.options.rootDir,
            isDevelopment: nuxt.options.dev,
            ...(options.defaultBranch === undefined
              ? {}
              : { defaultBranch: options.defaultBranch }),
          });

    // Every key is declared, including the ones that resolved to `null`: Nuxt only applies a
    // `NUXT_PUBLIC_*` override to a key the build declared, so an omitted field could not be
    // supplied by the deployment that needs to supply it.
    nuxt.options.runtimeConfig.public.buildInfo = buildInfo;

    const composable = addTemplate({
      filename: 'agent-zero-build-env.mjs',
      write: true,
      getContents: () => buildInfoComposable(options),
    });
    addImports({ name: 'useBuildInfo', as: 'useBuildInfo', from: composable.dst });
  },
});

/**
 * `useBuildInfo()`: what this build is, completed from the running server's environment.
 *
 * Generated rather than shipped as a file in this package so the app's own build compiles it, and
 * so `import.meta.server` is the constant the bundler eliminates the run-time branch by — the
 * client bundle never carries the fallback, or the `process.env` read behind it.
 */
function buildInfoComposable(options: BuildEnvModuleOptions): string {
  const resolveOptions = JSON.stringify(
    options.defaultBranch === undefined ? {} : { defaultBranch: options.defaultBranch },
  );

  return `import process from 'node:process';

import { normalizeBuildInfo, runtimeBuildInfo } from '@agent-zero/build-env';
import { useRuntimeConfig, useState } from '#imports';

const runtimeFallback = ${JSON.stringify(Boolean(options.runtimeFallback))};
const resolveOptions = ${resolveOptions};

// Memoised across requests within one server process, rather than recomputed per request or per
// prerendered route: the answer is a pure function of \`process.env\`, which does not change while
// the process runs.
let serverResolved;

export function useBuildInfo() {
  // Keyed state rather than a plain call: the server-completed value is serialised into the SSR
  // payload, so the client hydrates the same answer instead of falling back to the build's own.
  return useState('agent-zero:build-info', () => {
    const buildInfo = useRuntimeConfig().public.buildInfo;
    if (!import.meta.server || !runtimeFallback) {
      // Nuxt still serialises this build's own \`null\` fields as \`''\` even when nothing here
      // completes them further, so every consumer sees the same two states \`BuildInfo\` declares
      // (resolved or \`null\`) rather than a third, empty-string one.
      return normalizeBuildInfo(buildInfo);
    }
    serverResolved ??= runtimeBuildInfo(buildInfo, process.env, resolveOptions);
    return serverResolved;
  }).value;
}
`;
}

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    buildInfo: BuildInfo;
  }
}

export type { BuildInfo, EnvType } from './types.js';
