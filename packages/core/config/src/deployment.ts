import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { RunMode } from '@code-zero/shared';
import { parse } from 'yaml';

import {
  declaresDeploymentSettings,
  DEPLOYMENT_CONFIG_SECTIONS,
  parseDeploymentSettings,
  type DeploymentSettings,
  type Edition,
  type Parsed,
} from './settings.js';

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
 * The instance configuration file, read from the process's working directory by default.
 *
 * Deliberately not `.code-zero.yml`: that file comes out of whatever checkout a run works on and is
 * untrusted input, while this one is the deployment's own trusted policy. Confusing the two would
 * mean reading a target repository's file as this deployment's policy, so the names differ in both
 * the leading dot and the word.
 */
export const DEPLOYMENT_CONFIG_FILE = 'config.yml';

/**
 * The name this file had before `config.yml`, still read when it is the only one present so an
 * upgrade does not silently drop a deployment's policy. Reported, so the operator renames it.
 */
export const LEGACY_DEPLOYMENT_CONFIG_FILE = 'code-zero.deployment.yml';

/** Where the instance configuration lives, and whether it was found under its old name. */
export interface DeploymentConfigLocation {
  path: string;
  legacy: boolean;
}

/**
 * Decide which one file is the instance configuration.
 *
 * `CODE_ZERO_CONFIG` names it outright, and nothing else is looked at. Without it the working
 * directory's `config.yml` is the file, or `code-zero.deployment.yml` when only the old name exists.
 * Both present is refused rather than resolved: reading one would silently ignore the other, and
 * two active files is exactly the ambiguity a single source exists to rule out.
 */
export async function locateDeploymentConfig(
  environment: Readonly<Record<string, string | undefined>>,
  directory: string,
  exists: (path: string) => Promise<boolean> = fileExists,
): Promise<Parsed<DeploymentConfigLocation>> {
  const named = environment.CODE_ZERO_CONFIG?.trim();
  if (named) return { ok: true, value: { path: resolve(directory, named), legacy: false } };
  const current = join(directory, DEPLOYMENT_CONFIG_FILE);
  const legacy = join(directory, LEGACY_DEPLOYMENT_CONFIG_FILE);
  const [hasCurrent, hasLegacy] = await Promise.all([exists(current), exists(legacy)]);
  if (hasCurrent && hasLegacy)
    return {
      ok: false,
      issues: [
        {
          path: '$',
          message: `Both ${DEPLOYMENT_CONFIG_FILE} and ${LEGACY_DEPLOYMENT_CONFIG_FILE} exist in ${directory}; keep one, or name it with CODE_ZERO_CONFIG.`,
        },
      ],
    };
  if (hasLegacy) return { ok: true, value: { path: legacy, legacy: true } };
  return { ok: true, value: { path: current, legacy: false } };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    // Absent or unreadable both mean "not this candidate"; reading it later reports the reason.
    return false;
  }
}

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
  const { config, issues } = await loadDeploymentFile(path);
  return { config, issues };
}

/**
 * Everything the deployment file says: the configuration, and the settings it states.
 *
 * The two halves fail differently on purpose. A refused configuration field falls back to its own
 * default, which is always the most closed one. The settings are refused whole: a limit, a model,
 * or a sandbox that was mistyped must not quietly become a different one, so their caller gets the
 * complete document or every issue in it, and has to decide what a run does without them.
 */
export interface DeploymentFile extends DeploymentConfigResult {
  settings: Parsed<DeploymentSettings>;
  /**
   * Whether the file states any settings section, so a deployment whose settings come from the
   * dashboard can say the file's are ignored rather than leave its operator editing a dead copy.
   */
  declaresSettings: boolean;
}

/** Read the deployment file once, for both its configuration and its settings. */
export async function loadDeploymentFile(
  path: string,
  edition: Edition = 'self-hosted',
): Promise<DeploymentFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT')
      return {
        config: structuredClone(defaultDeploymentConfig),
        issues: [],
        settings: parseDeploymentSettings({}, edition),
        declaresSettings: false,
      };
    const issue = { path: '$', message: `Could not read ${path}: ${String(error)}` };
    return {
      config: structuredClone(defaultDeploymentConfig),
      issues: [issue],
      settings: { ok: false, issues: [issue] },
      declaresSettings: false,
    };
  }
  return parseDeploymentFile(raw, edition);
}

/** Validate the file's text, for both halves. Separate from reading so tests need no filesystem. */
export function parseDeploymentFile(
  text: string,
  edition: Edition = 'self-hosted',
): DeploymentFile {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    const issue = {
      path: '$',
      message: error instanceof Error ? error.message : 'YAML parsing failed.',
    };
    return {
      config: structuredClone(defaultDeploymentConfig),
      issues: [issue],
      settings: { ok: false, issues: [issue] },
      declaresSettings: false,
    };
  }
  return {
    ...configFromDocument(parsed),
    settings: parseDeploymentSettings(parsed, edition, DEPLOYMENT_CONFIG_SECTIONS),
    declaresSettings: declaresDeploymentSettings(parsed),
  };
}

/** Validate the file's text. Separated from reading it so the tests never touch a filesystem. */
export function parseDeploymentConfig(text: string): DeploymentConfigResult {
  const { config, issues } = parseDeploymentFile(text);
  return { config, issues };
}

function configFromDocument(parsed: unknown): DeploymentConfigResult {
  const issues: DeploymentConfigIssue[] = [];
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
export function describeDeploymentConfigIssues(issues: readonly DeploymentConfigIssue[]): string {
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
  if (!isStringArray(value) || !value.every((entry) => entry.trim() !== '')) {
    issues.push({ path: `${path}.${key}`, message: 'Expected a list of non-empty strings.' });
    return undefined;
  }
  return value.map((entry) => entry.trim());
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
    if (!isStringArray(value) || value.length === 0) {
      issues.push({ path, message: 'Expected a non-empty list of execution modes.' });
      // Recorded with nothing granted rather than left out: a name absent from this map reads
      // downstream as "no grant configured", which resolves to the non-writable defaults. A grant
      // that was configured and refused must never resolve to more than the empty list this
      // parsed to — the mistake it corrects would otherwise widen the very principal it named.
      grants.set(name, []);
      continue;
    }
    const parsed: RunMode[] = [];
    let valid = true;
    for (const entry of value) {
      const mode = entry.trim();
      if (!isRunMode(mode)) {
        issues.push({ path, message: `Unknown execution mode: ${mode}` });
        valid = false;
        continue;
      }
      parsed.push(mode);
    }
    grants.set(name, valid ? parsed : []);
  }
  return grants;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isRunMode(value: string): value is RunMode {
  return RUN_MODES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
