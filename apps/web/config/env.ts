import { dirname, join } from 'node:path';

/**
 * Deployment-target resolution for the ViteHub integration registered in `nuxt.config.ts`.
 *
 * ViteHub's deployment preset is a build-time decision: it fixes the Nitro preset the build emits
 * (`node-server` for the self-hosted bundle, `vercel` for Vercel's Build Output API, and so on)
 * and the KV driver the KV Runtime Helper resolves. Nothing about it can be discovered at
 * runtime, so it is read from the environment the build runs in and defaults to the self-hosted
 * target every contributor build uses.
 */

/** The deployment targets ViteHub ships a plan for, spelled as `vite-hub`'s `DeploymentPreset`. */
export const viteHubPresets = ['cloudflare', 'deno', 'netlify', 'node', 'vercel'] as const;

export type ViteHubPreset = (typeof viteHubPresets)[number];

/** Self-hosted single-node bundle: what `aube run build` and `node .output/server/index.mjs` use. */
export const defaultViteHubPreset: ViteHubPreset = 'node';

/**
 * `VITEHUB_HOSTING` carries ViteHub's own vocabulary: one name per deployment plan.
 *
 * A `Map` rather than an object literal, here and below, so a lookup can only ever find a name
 * that was put in it: plain property access would resolve `constructor` or `__proto__` through
 * `Object.prototype` and hand the build something that is not a preset at all.
 */
const viteHubHostingTargets: ReadonlyMap<string, ViteHubPreset> = new Map(
  viteHubPresets.map((preset) => [preset, preset]),
);

/**
 * `NITRO_PRESET` carries Nitro's, and only the exact preset each plan pins is accepted.
 *
 * ViteHub fails the build whenever `NITRO_PRESET` normalises to anything other than its plan's own
 * Nitro preset, so a near-miss like `vercel-edge` or a bare `node` cannot be honoured however it
 * is mapped: it is rejected here, with a message naming what to set, rather than deeper in the
 * build with ViteHub's own conflict error.
 */
const nitroPresetTargets: ReadonlyMap<string, ViteHubPreset> = new Map([
  ['cloudflare-module', 'cloudflare'],
  ['deno-deploy', 'deno'],
  ['netlify', 'netlify'],
  ['node-server', 'node'],
  ['vercel', 'vercel'],
]);

function normalizeDeploymentTarget(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replaceAll('_', '-');
}

/**
 * Resolves the ViteHub deployment preset from `VITEHUB_HOSTING` or `NITRO_PRESET`.
 *
 * Those two names are the ones ViteHub itself reads: its deployment plugin fails the build when
 * either disagrees with the configured preset, so deriving the preset from them keeps one variable
 * authoritative instead of leaving a deployment to set two that can drift. Each is matched against
 * its own vocabulary — the plan names for `VITEHUB_HOSTING`, the Nitro presets those plans pin for
 * `NITRO_PRESET` — so no value is accepted here that ViteHub would then reject.
 *
 * An unrecognised value throws rather than falling back: a silent fallback would emit the
 * self-hosted `.output/` bundle under a deployment that cannot serve it, which is exactly the
 * failure this resolution exists to prevent.
 */
export function viteHubPresetFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ViteHubPreset {
  // Normalised before the choice, so a variable that is set but blank (an unfilled `.env` entry, an
  // empty Vercel project variable) falls through to the next one instead of taking precedence and
  // resolving to the self-hosted default.
  const configured = [
    {
      targets: viteHubHostingTargets,
      variable: 'VITEHUB_HOSTING',
      value: normalizeDeploymentTarget(environment.VITEHUB_HOSTING),
    },
    {
      targets: nitroPresetTargets,
      variable: 'NITRO_PRESET',
      value: normalizeDeploymentTarget(environment.NITRO_PRESET),
    },
  ].find((candidate) => candidate.value !== '');
  if (!configured) return defaultViteHubPreset;

  const preset = configured.targets.get(configured.value);
  if (!preset) {
    throw new Error(
      `Unsupported ${configured.variable} value ${JSON.stringify(configured.value)}. ` +
        `Expected one of: ${[...configured.targets.keys()].join(', ')}.`,
    );
  }

  return preset;
}

/**
 * Function directory `vite-hub@0.0.3`'s `vercel` deployment plan asserts on after the build
 * (`functions/__server.func/index.mjs`).
 *
 * The installed `nitropack@2.13.4` emits that function as `functions/__fallback.func` instead, and
 * its generated `config.json` routes to it under that name — nothing is wrong with the bundle,
 * only with the name ViteHub looks for. `nuxt.config.ts` bridges the two with a symlink that
 * exists just long enough for that assertion and is removed afterwards, so the deployment carries
 * one function rather than two. Drop the bridge once ViteHub's plan matches the preset's layout.
 */
export const viteHubVercelEntryName = '__server.func';

/** Resolves that alias beside whichever function directory the Nitro preset actually emitted. */
export function viteHubVercelEntryAlias(serverDirectory: string): string {
  return join(dirname(serverDirectory), viteHubVercelEntryName);
}
