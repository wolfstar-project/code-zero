/**
 * Build metadata resolution, in the two halves a deployment needs it.
 *
 * This entry point is the run-time half, and stays importable from inside a serverless bundle: it
 * reads an environment record and nothing else — no filesystem, no subprocess, no `@nuxt/kit`. The
 * build-time half, which reads the checkout and the app manifest, lives behind `./nuxt`.
 */
export { normalizeBuildInfo, runtimeBuildInfo, shortenCommit } from './build-info.js';
export {
  type DeploymentMetadata,
  deploymentMetadataFromEnvironment,
  envTypeFromMetadata,
  envTypeOverrideFromEnvironment,
  previewUrlFromMetadata,
  productionUrlFromMetadata,
} from './environment.js';
export type { BuildInfo, EnvironmentRecord, EnvType } from './types.js';
