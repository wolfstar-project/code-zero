import { readFile } from 'node:fs/promises';

import type { RunMode } from '@code-zero/shared';
import { parse } from 'yaml';

/**
 * One thing wrong with a deployment configuration file, and where.
 *
 * The path is JSON-pointer-ish (`$.control_plane.origins`) so an operator can find the line
 * without reading the loader, and every issue is collected rather than thrown on the first: a file
 * with three mistakes should report three, not make its author discover them one restart at a time.
 */
export interface DeploymentConfigIssue {
  path: string;
  message: string;
}

/**
 * How this deployment behaves, as distinct from what it is allowed to reach.
 *
 * This file is deployment-owned and trusted, unlike `.code-zero.yml`, which comes out of whatever
 * checkout is being worked on and is untrusted input. The two are deliberately different files
 * with different names: one states policy for the process, the other states policy for a
 * repository the process was pointed at.
 *
 * Only values that are neither secrets nor data live here. A credential stays in the environment,
 * beside the database password, because that is where a deployment already keeps secrets. A
 * repository — which checkout may be targeted, which one is watched — is a row in the store,
 * because it changes while the process runs and an operator should not restart to add one.
 */
export interface DeploymentConfig {
  controlPlane: {
    /**
     * Origins allowed to read `/api/v1/**` cross-origin.
     *
     * Empty by default: `tasks.list`, `tasks.get`, and `health` are unauthenticated by design, so
     * letting a browser on another site read them is a grant that has to be written down.
     */
    origins: readonly string[];
    /**
     * Execution modes each operator token may request, by principal name.
     *
     * The token itself is a secret and stays in the environment; what it may do is policy and
     * belongs here. A principal with no entry may request only the two non-writable modes.
     */
    modes: ReadonlyMap<string, readonly RunMode[]>;
  };
  poll: {
    /** Seconds between passes over the watched repositories. */
    intervalSeconds: number;
  };
}

/** What a deployment gets when it ships no configuration file: the most closed setting of each. */
export const defaultDeploymentConfig: DeploymentConfig = {
  controlPlane: { origins: [], modes: new Map() },
  poll: { intervalSeconds: 60 },
};

/** Below the floor a pass spends more of the provider's rate limit than the work it finds is worth. */
const MINIMUM_POLL_SECONDS = 15;
/** Above the ceiling it is not polling any more, and a webhook is the honest answer instead. */
const MAXIMUM_POLL_SECONDS = 3_600;

const RUN_MODES = new Set<string>(['observe', 'suggest', 'fix', 'autonomous']);

/**
 * The default path, relative to the process's working directory.
 *
 * Named for the deployment rather than the product so it cannot be mistaken for `.code-zero.yml`
 * at a glance: the leading dot and the different word are both load-bearing, because confusing the
 * two would mean reading a target repository's file as this deployment's own policy.
 */
export const DEPLOYMENT_CONFIG_FILE = 'code-zero.deployment.yml';

export interface DeploymentConfigResult {
  config: DeploymentConfig;
  /** Empty when the file parsed cleanly, or when there was no file to parse. */
  issues: readonly DeploymentConfigIssue[];
}

/**
 * Read and validate the deployment configuration.
 *
 * An absent file is not an error: every field has a default, and the defaults are what a
 * deployment that has never needed to change anything should get. A file that exists but is wrong
 * is an error, reported field by field — the caller decides whether to refuse to start, which is
 * a decision only a composition root can make.
 */
export async function loadDeploymentConfig(path: string): Promise<DeploymentConfigResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT')
      return { config: structuredClone(defaultDeploymentConfig), issues: [] };
    return {
      config: structuredClone(defaultDeploymentConfig),
      issues: [{ path: '$', message: `Could not read ${path}: ${String(error)}` }],
    };
  }
  return parseDeploymentConfig(raw);
}

/** Validate the file's text. Separated from reading it so the tests never touch a filesystem. */
export function parseDeploymentConfig(text: string): DeploymentConfigResult {
  const issues: DeploymentConfigIssue[] = [];
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return {
      config: structuredClone(defaultDeploymentConfig),
      issues: [
        { path: '$', message: error instanceof Error ? error.message : 'YAML parsing failed.' },
      ],
    };
  }
  // An empty file is a deployment that wrote the file and configured nothing yet, which is the
  // same thing as having no file at all.
  if (parsed === null || parsed === undefined)
    return { config: structuredClone(defaultDeploymentConfig), issues: [] };
  if (!isRecord(parsed))
    return {
      config: structuredClone(defaultDeploymentConfig),
      issues: [{ path: '$', message: 'Expected an object.' }],
    };

  const controlPlane = optionalRecord(parsed, 'control_plane', '$', issues);
  const poll = optionalRecord(parsed, 'poll', '$', issues);

  return {
    config: {
      controlPlane: {
        origins: stringList(controlPlane, 'origins', '$.control_plane', issues) ?? [],
        modes: modeGrants(controlPlane, issues),
      },
      poll: {
        intervalSeconds:
          boundedInteger(
            poll,
            'interval_seconds',
            '$.poll',
            MINIMUM_POLL_SECONDS,
            MAXIMUM_POLL_SECONDS,
            issues,
          ) ?? defaultDeploymentConfig.poll.intervalSeconds,
      },
    },
    issues,
  };
}

/** Renders issues as one message, for a composition root that refuses to start on a bad file. */
export function describeDeploymentConfigIssues(
  issues: readonly DeploymentConfigIssue[],
): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
}

function optionalRecord(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: DeploymentConfigIssue[],
): Record<string, unknown> | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (isRecord(value)) return value;
  issues.push({ path: `${path}.${key}`, message: 'Expected an object.' });
  return undefined;
}

function stringList(
  source: Record<string, unknown> | undefined,
  key: string,
  path: string,
  issues: DeploymentConfigIssue[],
): string[] | undefined {
  const value = source?.[key];
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string' && entry.trim() !== '')
  ) {
    issues.push({ path: `${path}.${key}`, message: 'Expected a list of non-empty strings.' });
    return undefined;
  }
  return value.map((entry) => (entry as string).trim());
}

function boundedInteger(
  source: Record<string, unknown> | undefined,
  key: string,
  path: string,
  minimum: number,
  maximum: number,
  issues: DeploymentConfigIssue[],
): number | undefined {
  const value = source?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    issues.push({
      path: `${path}.${key}`,
      message: `Expected an integer from ${String(minimum)} to ${String(maximum)}.`,
    });
    return undefined;
  }
  return value;
}

/**
 * `control_plane.modes` maps a principal name to the modes it may request.
 *
 * An unknown mode is refused rather than dropped: silently narrowing a grant would leave an
 * operator wondering why a token they widened still cannot run, and silently widening one is
 * worse.
 */
function modeGrants(
  controlPlane: Record<string, unknown> | undefined,
  issues: DeploymentConfigIssue[],
): ReadonlyMap<string, readonly RunMode[]> {
  const grants = new Map<string, readonly RunMode[]>();
  const modes = optionalRecord(controlPlane ?? {}, 'modes', '$.control_plane', issues);
  if (!modes) return grants;
  for (const [name, value] of Object.entries(modes)) {
    const path = `$.control_plane.modes.${name}`;
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every((entry) => typeof entry === 'string')
    ) {
      issues.push({ path, message: 'Expected a non-empty list of execution modes.' });
      continue;
    }
    const parsed: RunMode[] = [];
    let valid = true;
    for (const entry of value as string[]) {
      const mode = entry.trim();
      if (!RUN_MODES.has(mode)) {
        issues.push({ path, message: `Unknown execution mode: ${mode}` });
        valid = false;
        continue;
      }
      parsed.push(mode as RunMode);
    }
    if (valid) grants.set(name, parsed);
  }
  return grants;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
