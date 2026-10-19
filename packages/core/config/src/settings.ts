import {
  redactSecrets,
  secretValuesFromEnvironment,
  type ModelProviderKind,
  type NetworkPolicy,
  type RunMode,
} from '@code-zero/shared';
import { parse, stringify } from 'yaml';

import type { DeploymentConfigIssue } from './deployment.js';
import type { CodeZeroConfig, ContainerEngine } from './index.js';

/**
 * Which product a deployment is.
 *
 * `cloud` is the managed service, where the service's own operators configure the model, the
 * sandbox, and every connection, and customers only see whether each one works. It is stated by the
 * deployment, never inferred: a self-hosted install that happens to run on Cloudflare is still
 * self-hosted, and treating it otherwise would lock its operator out of their own settings.
 */
export type Edition = 'self-hosted' | 'cloud';

/**
 * Where a self-hosted deployment's settings are read from. Exactly one of the two is authoritative.
 *
 * `file` is the trusted deployment file, which the dashboard shows read-only. `dashboard` is the
 * store, edited from the settings page and exportable as the same YAML the file would hold.
 */
export type SettingsSource = 'file' | 'dashboard';

/** The answer to parsing something untrusted: the value, or every reason it was refused. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly DeploymentConfigIssue[] };

/** How much work the deployment takes on, and in which modes. */
export interface ExecutionSettings {
  /** Tasks this deployment runs at once. The scheduler queues the rest. */
  readonly maxConcurrentTasks: number;
  /**
   * Minutes after which one repository command is stopped, and the longest a hosted sandbox lease
   * lasts. Not a limit on a whole run: a run that executes several commands, or waits on the model,
   * can take longer than this in total.
   */
  readonly commandTimeoutMinutes: number;
  /** Execution modes a run may start in. Always includes `observe`. */
  readonly allowedModes: readonly RunMode[];
  /**
   * The widest egress any run may have, however it is executed: the local runner, the container
   * sandbox, or a hosted sandbox provider, which receives it with every lease request. A repository
   * may narrow it, never widen it. `full` states no ceiling.
   */
  readonly maxNetwork: NetworkPolicy;
}

/** The model every run uses, in place of whatever a repository's `.code-zero.yml` chose. */
export interface ModelSettings {
  readonly provider: ModelProviderKind;
  readonly name: string;
}

/**
 * The Docker or Podman sandbox for the runs this process executes itself, in place of whatever a
 * repository's `.code-zero.yml` chose.
 *
 * Only container isolation can be imposed: a deployment setting that downgraded a repository to
 * the host would be the one place a run ends up less isolated than its own policy asked for. A hosted
 * sandbox provider brings its own image and ignores this one, so the setting only describes runs
 * started on this process's own container engine.
 */
export interface SandboxSettings {
  readonly isolation: 'container';
  readonly engine: ContainerEngine;
  readonly image: string;
}

/**
 * The deployment-wide settings the dashboard shows and, when it is the source, edits.
 *
 * Every field changes what a run does: nothing here is a label. Credentials never live here — the
 * parser refuses anything shaped like one — so the document can be shown and exported whole.
 */
export interface DeploymentSettings {
  readonly execution: ExecutionSettings;
  /** `null` leaves the model to each repository's `.code-zero.yml`. */
  readonly model: ModelSettings | null;
  /** `null` leaves isolation to each repository's `.code-zero.yml`. */
  readonly runner: SandboxSettings | null;
}

/**
 * Stricter limits an organization chose for its own work on the managed cloud.
 *
 * `null` means the plan's value applies. A stored value is never trusted to stay below the plan,
 * because the plan can be lowered after it was saved; {@link effectiveExecution} takes the minimum.
 */
export interface OrganizationLimits {
  readonly maxConcurrentTasks: number | null;
  readonly commandTimeoutMinutes: number | null;
  readonly allowedModes: readonly RunMode[] | null;
}

const RUN_MODES: readonly RunMode[] = ['observe', 'suggest', 'fix', 'autonomous'];
const NETWORK_POLICIES: readonly NetworkPolicy[] = ['none', 'restricted', 'full'];
const CONTAINER_ENGINES: readonly ContainerEngine[] = ['docker', 'podman'];
const MODEL_PROVIDERS: readonly ModelProviderKind[] = [
  'ai-gateway',
  'anthropic',
  'claude-code',
  'codex-cli',
  'google',
  'openai',
  'openai-compatible',
];

/** The range each limit accepts, published so a form can offer the same bounds the parser checks. */
export const EXECUTION_LIMITS = {
  maxConcurrentTasks: { minimum: 1, maximum: 64 },
  commandTimeoutMinutes: { minimum: 1, maximum: 1_440 },
} as const;

/**
 * What a deployment gets when it states no setting: today's behaviour, unchanged.
 *
 * Four concurrent tasks is the scheduler's long-standing default, and thirty minutes is the
 * repository policy's own default command timeout, so a deployment that never opens the settings page runs
 * exactly as it did before the page existed.
 */
export const defaultDeploymentSettings: DeploymentSettings = {
  execution: {
    maxConcurrentTasks: 4,
    commandTimeoutMinutes: 30,
    allowedModes: RUN_MODES,
    maxNetwork: 'full',
  },
  model: null,
  runner: null,
};

/** An organization that chose nothing: the plan applies as it is. */
export const noOrganizationLimits: OrganizationLimits = {
  maxConcurrentTasks: null,
  commandTimeoutMinutes: null,
  allowedModes: null,
};

/** The deployment file's top-level keys that belong to the settings document. */
const SETTINGS_SECTIONS = ['execution', 'model', 'runner'] as const;

const EXECUTION_KEYS = [
  'max_concurrent_tasks',
  'command_timeout_minutes',
  'allowed_modes',
  'max_network',
];
const ORGANIZATION_KEYS = ['max_concurrent_tasks', 'command_timeout_minutes', 'allowed_modes'];
const MODEL_KEYS = ['provider', 'name'];
const RUNNER_KEYS = ['isolation', 'engine', 'image'];

/** A container image reference: never empty, never a flag, never whitespace. */
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/;
/** A model name: printable ASCII without whitespace, which every supported transport accepts. */
const MODEL_NAME = /^[\x21-\x7E]{1,200}$/;

/**
 * Read the edition from the deployment's environment.
 *
 * Only `CODE_ZERO_EDITION` decides it. A value this function does not know is refused rather than
 * read as self-hosted: guessing wrong in either direction either hides a managed service's locks or
 * hands a customer the service's own settings.
 */
export function editionFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Parsed<Edition> {
  const value = environment.CODE_ZERO_EDITION?.trim();
  if (!value || value === 'self-hosted') return ok('self-hosted');
  if (value === 'cloud') return ok('cloud');
  return err('CODE_ZERO_EDITION', 'Expected self-hosted or cloud.');
}

/**
 * Read which source a deployment's settings come from.
 *
 * The file is the default, so a deployment that upgrades keeps reading the file it already has. The
 * dashboard has to be chosen here, in the environment, where only whoever runs the deployment can
 * choose it: no request can move the source, so the file's read-only promise cannot be talked
 * around through the API. A cloud deployment cannot choose the dashboard at all.
 */
export function settingsSourceFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  edition: Edition,
): Parsed<SettingsSource> {
  const value = environment.CODE_ZERO_SETTINGS_SOURCE?.trim();
  if (!value || value === 'file') return ok('file');
  if (value !== 'dashboard') return err('CODE_ZERO_SETTINGS_SOURCE', 'Expected file or dashboard.');
  if (edition === 'cloud')
    return err(
      'CODE_ZERO_SETTINGS_SOURCE',
      'A cloud deployment reads its service settings from the deployment file only.',
    );
  return ok('dashboard');
}

/** Whether a parsed deployment file states any settings section at all. */
export function declaresDeploymentSettings(document: unknown): boolean {
  return isRecord(document) && SETTINGS_SECTIONS.some((section) => document[section] !== undefined);
}

/**
 * Parse the settings sections of a deployment document, refusing it whole on any mistake.
 *
 * Unlike the rest of the deployment file, nothing here falls back to a default field by field: a
 * limit or a sandbox that was meant and mistyped must not quietly become a different one, so the
 * caller gets either the complete document or every issue in it. Keys outside the three sections
 * are ignored, because they belong to the deployment configuration, which parses them itself.
 */
export function parseDeploymentSettings(
  document: unknown,
  edition: Edition = 'self-hosted',
): Parsed<DeploymentSettings> {
  // An empty file parses to null, and states no setting, exactly like a file that has none.
  const root = document ?? {};
  if (!isRecord(root)) return err('$', 'Expected an object.');
  const issues: DeploymentConfigIssue[] = [];
  const settings: DeploymentSettings = {
    execution: executionSection(root.execution, issues),
    model: modelSection(root.model, issues),
    runner: runnerSection(root.runner, issues),
  };
  // The managed service names its model here, so no customer repository can pick one that bills the
  // service's credentials. Its sandbox is not required here: a hosted sandbox provider is wired by the
  // composition root, not described in this file, and a Cloudflare-hosted service has no container
  // engine to name. Runs that would reach neither are refused where runs start.
  if (edition === 'cloud' && (root.model === undefined || root.model === null))
    issues.push({ path: '$.model', message: 'A cloud deployment must configure the model.' });
  return issues.length > 0 ? { ok: false, issues } : ok(settings);
}

/** Parse settings written as YAML: an export, or a file that holds nothing else. */
export function parseDeploymentSettingsText(
  text: string,
  edition: Edition = 'self-hosted',
): Parsed<DeploymentSettings> {
  let document: unknown;
  try {
    document = parse(text);
  } catch (error) {
    return err('$', error instanceof Error ? error.message : 'YAML parsing failed.');
  }
  return parseDeploymentSettings(document, edition);
}

/**
 * The settings as the document they are stored and exported as: the deployment file's own keys.
 *
 * One shape for the store and the export, so what an administrator downloads is byte for byte what
 * the file source would read back.
 */
export function deploymentSettingsDocument(settings: DeploymentSettings): Record<string, unknown> {
  const document: Record<string, unknown> = {
    execution: {
      max_concurrent_tasks: settings.execution.maxConcurrentTasks,
      command_timeout_minutes: settings.execution.commandTimeoutMinutes,
      allowed_modes: [...settings.execution.allowedModes],
      max_network: settings.execution.maxNetwork,
    },
  };
  if (settings.model)
    document.model = { provider: settings.model.provider, name: settings.model.name };
  if (settings.runner)
    document.runner = {
      isolation: settings.runner.isolation,
      engine: settings.runner.engine,
      image: settings.runner.image,
    };
  return document;
}

/**
 * Render the settings as YAML for an administrator to download.
 *
 * The document holds no credential by construction; every string still passes through redaction
 * against the environment's own secrets, so a value that slipped past the parser cannot leave the
 * deployment through an export.
 */
export function renderDeploymentSettings(
  settings: DeploymentSettings,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return redactSecrets(
    stringify(deploymentSettingsDocument(settings)),
    secretValuesFromEnvironment(environment),
  );
}

/** Parse the limits an organization stored. Bounds are checked here; the plan is checked on write. */
export function parseOrganizationLimits(document: unknown): Parsed<OrganizationLimits> {
  if (document === null || document === undefined) return ok(noOrganizationLimits);
  if (!isRecord(document)) return err('$', 'Expected an object.');
  const issues: DeploymentConfigIssue[] = [];
  unknownKeys(document, ORGANIZATION_KEYS, '$', issues);
  const limits: OrganizationLimits = {
    maxConcurrentTasks: nullable(document.max_concurrent_tasks, () =>
      boundedInteger(
        document.max_concurrent_tasks,
        '$.max_concurrent_tasks',
        EXECUTION_LIMITS.maxConcurrentTasks,
        issues,
      ),
    ),
    commandTimeoutMinutes: nullable(document.command_timeout_minutes, () =>
      boundedInteger(
        document.command_timeout_minutes,
        '$.command_timeout_minutes',
        EXECUTION_LIMITS.commandTimeoutMinutes,
        issues,
      ),
    ),
    allowedModes: nullable(document.allowed_modes, () =>
      modeList(document.allowed_modes, '$.allowed_modes', issues),
    ),
  };
  return issues.length > 0 ? { ok: false, issues } : ok(limits);
}

/** The limits as the document they are stored as. */
export function organizationLimitsDocument(limits: OrganizationLimits): Record<string, unknown> {
  return {
    max_concurrent_tasks: limits.maxConcurrentTasks,
    command_timeout_minutes: limits.commandTimeoutMinutes,
    allowed_modes: limits.allowedModes ? [...limits.allowedModes] : null,
  };
}

/** Every value an organization chose that the plan does not allow. Empty when all fit. */
export function organizationLimitsAbovePlan(
  limits: OrganizationLimits,
  plan: ExecutionSettings,
): DeploymentConfigIssue[] {
  const issues: DeploymentConfigIssue[] = [];
  if (limits.maxConcurrentTasks !== null && limits.maxConcurrentTasks > plan.maxConcurrentTasks)
    issues.push({
      path: '$.max_concurrent_tasks',
      message: `The plan allows at most ${String(plan.maxConcurrentTasks)}.`,
    });
  if (
    limits.commandTimeoutMinutes !== null &&
    limits.commandTimeoutMinutes > plan.commandTimeoutMinutes
  )
    issues.push({
      path: '$.command_timeout_minutes',
      message: `The plan allows at most ${String(plan.commandTimeoutMinutes)}.`,
    });
  for (const mode of limits.allowedModes ?? [])
    if (!plan.allowedModes.includes(mode))
      issues.push({ path: '$.allowed_modes', message: `The plan does not allow ${mode}.` });
  return issues;
}

/**
 * The limits a run is held to: the plan, lowered wherever the organization chose less.
 *
 * Minimums and an intersection, never a replacement, so a stored value that is now above a lowered
 * plan cannot raise anything.
 */
export function effectiveExecution(
  plan: ExecutionSettings,
  limits: OrganizationLimits | null,
): ExecutionSettings {
  if (!limits) return plan;
  return {
    maxConcurrentTasks: Math.min(
      plan.maxConcurrentTasks,
      limits.maxConcurrentTasks ?? plan.maxConcurrentTasks,
    ),
    commandTimeoutMinutes: Math.min(
      plan.commandTimeoutMinutes,
      limits.commandTimeoutMinutes ?? plan.commandTimeoutMinutes,
    ),
    allowedModes: limits.allowedModes
      ? plan.allowedModes.filter((mode) => limits.allowedModes?.includes(mode))
      : plan.allowedModes,
    // The network ceiling is the service's, like the sandbox it describes: no organization moves it.
    maxNetwork: plan.maxNetwork,
  };
}

/**
 * A repository's configuration with the deployment's settings applied: stricter wins everywhere.
 *
 * The repository's `.code-zero.yml` is untrusted input from the checkout being worked on, so where
 * the deployment states a model or a sandbox, the deployment's choice replaces the repository's
 * rather than merging with it. The command timeout is the shorter of the two, and the network the
 * narrower, whatever executes the run: a repository may ask for less than the deployment allows,
 * never more. A repository's own container
 * network name is dropped under a deployment sandbox, because `--network host` is a name too.
 *
 * `execution` is the effective limit for this run — the plan lowered by an organization's limits on
 * the managed cloud — and defaults to the deployment's own.
 */
export function applyDeploymentSettings(
  config: CodeZeroConfig,
  settings: DeploymentSettings,
  execution: ExecutionSettings = settings.execution,
): CodeZeroConfig {
  const applied: CodeZeroConfig = {
    ...config,
    agent: {
      ...config.agent,
      timeoutMs: Math.min(config.agent.timeoutMs, execution.commandTimeoutMinutes * 60_000),
    },
    permissions: {
      ...config.permissions,
      network: narrowerNetwork(config.permissions.network, execution.maxNetwork),
    },
  };
  if (settings.model) applied.model = deploymentModel(config.model, settings.model);
  if (settings.runner)
    applied.runner = {
      ...withoutContainerNetwork(config.runner),
      isolation: 'container',
      engine: settings.runner.engine,
      image: settings.runner.image,
    };
  return applied;
}

/** Whether the effective limits let a run start in this mode. */
export function isModeAllowed(execution: ExecutionSettings, mode: RunMode): boolean {
  return execution.allowedModes.includes(mode);
}

/**
 * The deployment's model, keeping the repository's prices only when they describe that same model.
 *
 * A price is a statement about one model; carried over to another it would make the usage figures
 * lie, so it is dropped rather than reused.
 */
function deploymentModel(
  repository: CodeZeroConfig['model'],
  deployment: ModelSettings,
): CodeZeroConfig['model'] {
  if (repository.provider === deployment.provider && repository.name === deployment.name)
    return { ...repository };
  return { provider: deployment.provider, name: deployment.name };
}

/** The repository's runner policy minus the container network it named for itself. */
function withoutContainerNetwork(runner: CodeZeroConfig['runner']): CodeZeroConfig['runner'] {
  const kept: CodeZeroConfig['runner'] = { ...runner };
  delete kept.network;
  return kept;
}

function narrowerNetwork(left: NetworkPolicy, right: NetworkPolicy): NetworkPolicy {
  return NETWORK_POLICIES.indexOf(left) <= NETWORK_POLICIES.indexOf(right) ? left : right;
}

function executionSection(value: unknown, issues: DeploymentConfigIssue[]): ExecutionSettings {
  const defaults = defaultDeploymentSettings.execution;
  const section = optionalSection(value, '$.execution', issues);
  if (!section) return defaults;
  unknownKeys(section, EXECUTION_KEYS, '$.execution', issues);
  return {
    maxConcurrentTasks:
      section.max_concurrent_tasks === undefined
        ? defaults.maxConcurrentTasks
        : boundedInteger(
            section.max_concurrent_tasks,
            '$.execution.max_concurrent_tasks',
            EXECUTION_LIMITS.maxConcurrentTasks,
            issues,
          ),
    commandTimeoutMinutes:
      section.command_timeout_minutes === undefined
        ? defaults.commandTimeoutMinutes
        : boundedInteger(
            section.command_timeout_minutes,
            '$.execution.command_timeout_minutes',
            EXECUTION_LIMITS.commandTimeoutMinutes,
            issues,
          ),
    allowedModes:
      section.allowed_modes === undefined
        ? defaults.allowedModes
        : modeList(section.allowed_modes, '$.execution.allowed_modes', issues),
    maxNetwork:
      section.max_network === undefined
        ? defaults.maxNetwork
        : networkPolicy(section.max_network, '$.execution.max_network', issues),
  };
}

function networkPolicy(
  value: unknown,
  path: string,
  issues: DeploymentConfigIssue[],
): NetworkPolicy {
  if (typeof value === 'string' && isOneOf(NETWORK_POLICIES, value)) return value;
  issues.push({ path, message: 'Expected none, restricted, or full.' });
  return 'none';
}

function modelSection(value: unknown, issues: DeploymentConfigIssue[]): ModelSettings | null {
  const section = optionalSection(value, '$.model', issues);
  if (!section) return null;
  unknownKeys(section, MODEL_KEYS, '$.model', issues);
  const provider = section.provider;
  if (typeof provider !== 'string' || !isOneOf(MODEL_PROVIDERS, provider)) {
    issues.push({
      path: '$.model.provider',
      message: `Expected one of ${MODEL_PROVIDERS.join(', ')}.`,
    });
    return null;
  }
  const name = settingString(
    section.name,
    '$.model.name',
    MODEL_NAME,
    'Expected a model name.',
    issues,
  );
  return name === undefined ? null : { provider, name };
}

function runnerSection(value: unknown, issues: DeploymentConfigIssue[]): SandboxSettings | null {
  const section = optionalSection(value, '$.runner', issues);
  if (!section) return null;
  unknownKeys(section, RUNNER_KEYS, '$.runner', issues);
  if (section.isolation !== 'container') {
    issues.push({
      path: '$.runner.isolation',
      message:
        'Only container isolation can be enforced; remove the runner section to let each repository choose.',
    });
    return null;
  }
  const engine = section.engine ?? 'docker';
  if (typeof engine !== 'string' || !isOneOf(CONTAINER_ENGINES, engine)) {
    issues.push({ path: '$.runner.engine', message: 'Expected docker or podman.' });
    return null;
  }
  const image = settingString(
    section.image,
    '$.runner.image',
    IMAGE_REFERENCE,
    'Expected a container image reference.',
    issues,
  );
  return image === undefined ? null : { isolation: 'container', engine, image };
}

function optionalSection(
  value: unknown,
  path: string,
  issues: DeploymentConfigIssue[],
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (isRecord(value)) return value;
  issues.push({ path, message: 'Expected an object.' });
  return undefined;
}

/** A misspelled key is refused, not ignored: ignoring it is how a limit silently stays the default. */
function unknownKeys(
  section: Record<string, unknown>,
  known: readonly string[],
  path: string,
  issues: DeploymentConfigIssue[],
): void {
  for (const key of Object.keys(section))
    if (!known.includes(key)) issues.push({ path: `${path}.${key}`, message: 'Unknown setting.' });
}

function boundedInteger(
  value: unknown,
  path: string,
  bounds: { readonly minimum: number; readonly maximum: number },
  issues: DeploymentConfigIssue[],
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < bounds.minimum ||
    value > bounds.maximum
  ) {
    issues.push({
      path,
      message: `Expected an integer from ${String(bounds.minimum)} to ${String(bounds.maximum)}.`,
    });
    return bounds.minimum;
  }
  return value;
}

/**
 * A list of execution modes in the canonical order, with `observe` required.
 *
 * `observe` is what every unrequested run starts in and the one mode that can never write, so a
 * deployment without it would refuse its own default rather than be any safer.
 */
function modeList(value: unknown, path: string, issues: DeploymentConfigIssue[]): RunMode[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string' && isOneOf(RUN_MODES, entry)) ||
    !value.includes('observe')
  ) {
    issues.push({ path, message: 'Expected a list of execution modes that includes observe.' });
    return ['observe'];
  }
  return RUN_MODES.filter((mode) => value.includes(mode));
}

function settingString(
  value: unknown,
  path: string,
  pattern: RegExp,
  message: string,
  issues: DeploymentConfigIssue[],
): string | undefined {
  if (typeof value !== 'string' || !pattern.test(value.trim())) {
    issues.push({ path, message });
    return undefined;
  }
  const text = value.trim();
  // A setting is shown on a page and exported as a file, so a credential pasted into one would
  // leave the deployment through both. Anything the redactor would rewrite is refused instead.
  if (redactSecrets(text) !== text) {
    issues.push({ path, message: 'Looks like a credential. Credentials stay in the environment.' });
    return undefined;
  }
  return text;
}

function nullable<T>(value: unknown, read: () => T): T | null {
  return value === undefined || value === null ? null : read();
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((candidate) => candidate === value);
}

function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

function err<T>(path: string, message: string): Parsed<T> {
  return { ok: false, issues: [{ path, message }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
