import {
  type DeploymentMetadata,
  deploymentMetadataFromEnvironment,
  envTypeFromMetadata,
  envTypeOverrideFromEnvironment,
  previewUrlFromMetadata,
  productionUrlFromMetadata,
} from './environment.js';
import type { BuildInfo, EnvironmentRecord, EnvType } from './types.js';

/** Seven characters is what `git rev-parse --short` and every provider's UI abbreviate to. */
const shortCommitLength = 7;

/** Abbreviates a commit SHA, passing `null` through unchanged. */
export function shortenCommit(commit: string | null): string | null {
  return commit === null ? null : commit.slice(0, shortCommitLength);
}

/**
 * Turns a blank string back into `null`.
 *
 * Nuxt serialises a `null` default in `runtimeConfig.public` as `''`, so every key stays
 * overridable through its own `NUXT_PUBLIC_*` variable — but that means an unresolved field
 * arrives here as an empty string, not the `null` the build published. Without this, `??` would
 * treat that empty string as already resolved and never complete it.
 */
export function normalizeBuildInfo(buildInfo: BuildInfo): BuildInfo {
  return {
    ...buildInfo,
    commit: buildInfo.commit || null,
    branch: buildInfo.branch || null,
    prNumber: buildInfo.prNumber || null,
    previewUrl: buildInfo.previewUrl || null,
    productionUrl: buildInfo.productionUrl || null,
  };
}

/**
 * Completes build metadata from the environment the bundle is *running* in.
 *
 * This is the fallback for every deployment that is not Vercel. On Vercel the build itself runs
 * with `VERCEL_GIT_COMMIT_SHA` and the rest in scope, so the values are already resolved and this
 * pass is a no-op that resolves to the same answers. A container image built in CI and started
 * somewhere else has none of them at build time: the fields arrive at boot instead, from whatever
 * the host exposes, or from the `AGENT_ZERO_BUILD_*` variables an operator sets on the process.
 *
 * A field the build resolved is never overwritten. The commit a bundle was compiled from is a
 * property of the bundle, not of the machine it happens to be running on, and letting a run-time
 * variable rewrite it would make the metadata describe a different build than the one serving the
 * request.
 */
export function runtimeBuildInfo(
  buildInfo: BuildInfo,
  environment: EnvironmentRecord,
  options: { readonly defaultBranch?: string } = {},
): BuildInfo {
  const normalized = normalizeBuildInfo(buildInfo);
  const metadata = deploymentMetadataFromEnvironment(environment, options.defaultBranch);

  const commit = normalized.commit ?? metadata.commit;
  const branch = normalized.branch ?? metadata.branch;
  // A host that explicitly reports production for the process running right now overrides
  // whatever pull-request number was baked in at build time: an image built for review app #42
  // and later promoted to production is not still preview #42.
  const prNumber =
    metadata.context === 'production' ? null : (normalized.prNumber ?? metadata.prNumber);

  const env = runtimeEnvType(
    normalized,
    environment,
    { ...metadata, branch, prNumber },
    options.defaultBranch,
  );
  const previewUrl = normalized.previewUrl ?? previewUrlFromMetadata(metadata, env);
  const productionUrl = normalized.productionUrl ?? productionUrlFromMetadata(metadata, env);

  return {
    ...normalized,
    commit,
    branch,
    env,
    prNumber,
    // Gated by the *final* env rather than merely filled in when missing: a build classified
    // `preview` and later reclassified `release` at runtime must stop serving its stale preview
    // URL, and a build classified `release` and later demoted to `preview` must stop serving its
    // stale production one — either survives an ordinary "fill if absent" merge.
    previewUrl: env === 'release' ? null : previewUrl,
    productionUrl: env === 'release' ? productionUrl : null,
  };
}

/**
 * Which deployment the running bundle is, given what the build decided and what the host says.
 *
 * `dev` is never revised: a bundle built by `nuxt dev` is a developer's own machine whatever
 * variables happen to be in its shell. Otherwise a host that reports a production-versus-preview
 * context is authoritative, because it is the only party that knows which domain is answering —
 * and on Vercel it reports at run time exactly what it reported at build time, so the pass is
 * idempotent rather than a second, divergent opinion.
 */
function runtimeEnvType(
  buildInfo: BuildInfo,
  environment: EnvironmentRecord,
  metadata: DeploymentMetadata,
  defaultBranch: string | undefined,
): EnvType {
  const override = envTypeOverrideFromEnvironment(environment);
  if (override) return override;
  if (buildInfo.env === 'dev') return 'dev';
  if (metadata.context === null) return buildInfo.env;
  return envTypeFromMetadata(metadata, {
    isDevelopment: false,
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
  });
}
