import { resolve } from 'node:path';

import {
  defaultDeploymentConfig,
  DEPLOYMENT_CONFIG_FILE,
  describeDeploymentConfigIssues,
  loadDeploymentConfig,
  type DeploymentConfig,
} from '@code-zero/config';

/**
 * How this deployment behaves, read once from `code-zero.deployment.yml`.
 *
 * One file replaces the handful of comma-separated environment variables this policy used to be
 * spelled in — a list of origins, a `name:mode|mode` grant string, a poll interval — each of which
 * had its own ad-hoc format to get wrong. What stays in the environment is what a deployment
 * already keeps there: secrets, and the two bootstrap values needed to find everything else
 * (`DATABASE_URL`, and the path to this file).
 *
 * `CODE_ZERO_CONFIG` names the file; without it the process reads `code-zero.deployment.yml` from
 * its working directory, and a deployment that has never needed to change anything ships no file
 * at all and gets the defaults.
 *
 * Resolved once and awaited by every reader, rather than re-read per request: this is deployment
 * policy, which changes when the process restarts. Repository configuration is the opposite — it
 * changes while the process runs — which is exactly why it lives in the store instead.
 */
let pending: Promise<DeploymentConfig> | undefined;

export function deploymentConfig(): Promise<DeploymentConfig> {
  pending ??= read();
  return pending;
}

async function read(): Promise<DeploymentConfig> {
  const path = resolve(process.env.CODE_ZERO_CONFIG?.trim() || DEPLOYMENT_CONFIG_FILE);
  const { config, issues } = await loadDeploymentConfig(path);
  if (issues.length > 0) {
    // Reported rather than thrown: a malformed field falls back to its own default, and the
    // process starting with a loud complaint beats a dashboard that will not load at all because
    // one line of YAML is wrong. Every issue names its path, so the fix is one edit.
    console.error(
      `[config] ${path} has problems; the defaults stand where a value was refused:\n${describeDeploymentConfigIssues(issues)}`,
    );
  }
  return config;
}

/** The defaults, for a caller that must answer before the file has been read. */
export const deploymentDefaults: DeploymentConfig = defaultDeploymentConfig;
