import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  deploymentMetadataFromEnvironment,
  envTypeFromMetadata,
  envTypeOverrideFromEnvironment,
  previewUrlFromMetadata,
  productionUrlFromMetadata,
} from './environment.js';
import { type GitMetadata, gitMetadata } from './git.js';
import type { BuildInfo, EnvironmentRecord } from './types.js';

export interface ResolveBuildInfoOptions {
  /** Where the build is running: the checkout git is read from, and the `package.json` version. */
  readonly rootDirectory: string;
  /** Whether this is `nuxt dev` rather than a build; the one input no variable can be trusted for. */
  readonly isDevelopment: boolean;
  /** Defaults to `process.env`; passed explicitly by tests so none of them mutate it. */
  readonly environment?: EnvironmentRecord;
  /** The branch a non-pull-request deploy has to be on to be the canary. Defaults to `main`. */
  readonly defaultBranch?: string;
  /** Build timestamp; passed explicitly by tests, which may not read the wall clock. */
  readonly now?: number;
  /**
   * How the checkout is read. Defaults to running git in {@link ResolveBuildInfoOptions.rootDirectory}.
   *
   * Injected by tests so no suite spawns a subprocess or depends on the checkout it runs in.
   */
  readonly readGitMetadata?: (directory: string) => Promise<GitMetadata>;
}

/**
 * Resolves everything about a build that can be known while it runs.
 *
 * The environment is asked first and the checkout second, never the other way round: a hosting
 * provider knows the branch a detached CI checkout cannot name, and knows whether the deploy is
 * production. git is only consulted for what is still missing, which on Vercel is nothing.
 *
 * Whatever is still unresolved stays `null` rather than being guessed at, so the run-time pass
 * (`runtimeBuildInfo`) can tell a field the build genuinely resolved from one it did not.
 */
export async function resolveBuildInfo(options: ResolveBuildInfoOptions): Promise<BuildInfo> {
  const environment = options.environment ?? process.env;
  const metadata = deploymentMetadataFromEnvironment(environment, options.defaultBranch);

  const readGit = options.readGitMetadata ?? gitMetadata;
  const needsGit = metadata.branch === null || metadata.commit === null;
  const [git, version] = await Promise.all([
    needsGit ? readGit(options.rootDirectory) : Promise.resolve({ branch: null, commit: null }),
    packageVersion(options.rootDirectory),
  ]);

  const branch = metadata.branch ?? git.branch;
  const commit = metadata.commit ?? git.commit;
  const env =
    envTypeOverrideFromEnvironment(environment) ??
    envTypeFromMetadata(metadata, {
      isDevelopment: options.isDevelopment,
      ...(options.defaultBranch === undefined ? {} : { defaultBranch: options.defaultBranch }),
    });

  return {
    version,
    commit,
    branch,
    env,
    time: options.now ?? Date.now(),
    prNumber: metadata.prNumber,
    previewUrl: previewUrlFromMetadata(metadata, env),
    productionUrl: productionUrlFromMetadata(metadata, env),
  };
}

/**
 * The version of the package being built, read from its own manifest.
 *
 * Read rather than imported so the value comes from the app's `package.json` at the path the build
 * is running in, not from this package's own manifest bundled at compile time. Read directly rather
 * than through `pkg-types`, whose `readPackageJSON` ascends to the nearest manifest: in a workspace
 * that resolves a missing app manifest to the repository root's, reporting its version as the app's
 * — the exact drift between two version sources this package exists to remove.
 */
export async function packageVersion(rootDirectory: string): Promise<string> {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(join(rootDirectory, 'package.json'), 'utf8'),
    );
    const version =
      typeof manifest === 'object' && manifest !== null && 'version' in manifest
        ? manifest.version
        : undefined;
    return typeof version === 'string' && version ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
