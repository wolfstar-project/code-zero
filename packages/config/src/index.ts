import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChangeRisk, ModelProviderKind, NetworkPolicy, RunMode } from '@code-zero/shared';
import { parse } from 'yaml';

import { assertExecutableCommand } from './checks.js';

export {
  defaultDeploymentConfig,
  DEPLOYMENT_CONFIG_FILE,
  describeDeploymentConfigIssues,
  loadDeploymentConfig,
  parseDeploymentConfig,
  type DeploymentConfig,
  type DeploymentConfigIssue,
  type DeploymentConfigResult,
} from './deployment.js';
export {
  assertExecutableCommand,
  checkKinds,
  detectPackageManager,
  discoverChecks,
  knownLockfiles,
  packageManagerFromLockfiles,
  resolveChecks,
  type CheckKind,
  type PackageManager,
  type RepositoryProbe,
} from './checks.js';

/** Where repository commands are executed. */
export type RunnerIsolation = 'local' | 'container';

/** Container engines the isolated runner knows how to drive. */
export type ContainerEngine = 'docker' | 'podman';

/** How the runtime decides whether a reviewer's claim is supported. */
export interface ValidationPolicy {
  /** Below this model confidence a supported claim is reported as inconclusive, never fixed. */
  minConfidence: number;
  /** Require at least one piece of cited evidence. */
  requireEvidence: boolean;
  /** Require at least one cited file to exist in the checkout. */
  requireKnownFiles: boolean;
  /** Require backtick-quoted evidence to appear in a cited file. */
  verifyQuotedEvidence: boolean;
}

/** Execution boundary settings. */
export interface RunnerPolicy {
  isolation: RunnerIsolation;
  engine: ContainerEngine;
  /** Container image used when `isolation` is `container`. Required in that mode. */
  image?: string;
  /** Mount point for the checkout inside the container. */
  workdir: string;
  /** Container CPU limit, passed through verbatim (for example `2`). */
  cpus?: string;
  /** Container memory limit, passed through verbatim (for example `4g`). */
  memory?: string;
  /** Pre-provisioned network used for the `restricted` egress policy. */
  network?: string;
  /** Ceiling on captured output per command, in bytes. */
  maxOutputBytes: number;
}

/** Policy for turning scoped GitHub issues into verified pull requests. */
export interface IssuePolicy {
  /** Issue-to-PR runs are opt-in per repository, like proactive review. */
  enabled: boolean;
  /**
   * Label an issue must carry before it becomes a task. Scoping is explicit: an issue nobody
   * labeled is never picked up, so arbitrary issue text cannot start a run on its own.
   */
  requireLabel: string;
  /** Prefix for the isolated branch a verified issue task publishes its changes on. */
  branchPrefix: string;
  /**
   * Report the validation verdict back on the issue as a comment: whether the repository actually
   * has the reported problem, with the evidence or the rejection reasons. Report-only; it never
   * changes what a run may write.
   */
  validationComment: boolean;
}

export interface CodeZeroConfig {
  version: 1;
  mode: RunMode;
  /** Explicit check commands. When empty the checkout's own scripts are discovered. */
  checks: string[];
  proactive: { enabled: boolean };
  issues: IssuePolicy;
  autofix: {
    enabled: boolean;
    minConfidence: number;
    /** High-impact changes are never accepted here and always require human approval. */
    allowedChangeRisks: Exclude<ChangeRisk, 'high-impact'>[];
    /** Autonomous writes must use a runner that can prove isolation when this is true. */
    requireIsolated: boolean;
  };
  validation: ValidationPolicy;
  agent: { maxAttempts: number; timeoutMs: number; maxChangedFiles: number };
  permissions: { network: NetworkPolicy };
  runner: RunnerPolicy;
  model: {
    provider: ModelProviderKind;
    name: string;
    inputCostPerMillionTokens?: number;
    outputCostPerMillionTokens?: number;
  };
}

export const defaultConfig: CodeZeroConfig = {
  version: 1,
  mode: 'observe',
  checks: [],
  proactive: { enabled: false },
  issues: {
    enabled: false,
    requireLabel: 'code-zero',
    branchPrefix: 'code-zero/',
    validationComment: true,
  },
  autofix: {
    enabled: false,
    minConfidence: 0.85,
    allowedChangeRisks: ['mechanical'],
    requireIsolated: true,
  },
  validation: {
    minConfidence: 0.6,
    requireEvidence: true,
    requireKnownFiles: true,
    verifyQuotedEvidence: true,
  },
  agent: { maxAttempts: 3, timeoutMs: 1_800_000, maxChangedFiles: 10 },
  permissions: { network: 'restricted' },
  runner: {
    isolation: 'local',
    engine: 'docker',
    workdir: '/workspace',
    maxOutputBytes: 200_000,
  },
  model: { provider: 'openai-compatible', name: process.env.CODE_ZERO_MODEL ?? 'gpt-5' },
};

const runModes = new Set<string>(['observe', 'suggest', 'fix', 'autonomous']);
const networkPolicies = new Set<string>(['none', 'restricted', 'full']);
const modelProviders = new Set<string>([
  'ai-gateway',
  'anthropic',
  'claude-code',
  'codex-cli',
  'google',
  'openai',
  'openai-compatible',
]);

function assertConfig(value: unknown): asserts value is Partial<CodeZeroConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Configuration must be a YAML object');
}

export async function loadConfig(cwd: string): Promise<CodeZeroConfig> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, '.code-zero.yml'), 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return structuredClone(defaultConfig);
    throw error;
  }
  const parsed: unknown = parse(raw);
  assertConfig(parsed);
  return validateConfig({
    ...defaultConfig,
    ...parsed,
    proactive: { ...defaultConfig.proactive, ...parsed.proactive },
    issues: { ...defaultConfig.issues, ...parsed.issues },
    autofix: { ...defaultConfig.autofix, ...parsed.autofix },
    validation: { ...defaultConfig.validation, ...parsed.validation },
    agent: { ...defaultConfig.agent, ...parsed.agent },
    permissions: { ...defaultConfig.permissions, ...parsed.permissions },
    runner: { ...defaultConfig.runner, ...parsed.runner },
    model: { ...defaultConfig.model, ...parsed.model },
  });
}

/**
 * Reject a configuration that cannot be honored.
 *
 * Every failure here is preferable to a run that silently widens permissions, skips verification,
 * or promises isolation the runner cannot deliver.
 */
export function validateConfig(config: CodeZeroConfig): CodeZeroConfig {
  if (config.version !== 1)
    throw new Error(`Unsupported configuration version: ${String(config.version)}`);
  if (!runModes.has(config.mode)) throw new Error(`Invalid mode: ${config.mode}`);
  if (!networkPolicies.has(config.permissions.network))
    throw new Error(`Invalid network policy: ${config.permissions.network}`);
  if (!modelProviders.has(config.model.provider))
    throw new Error(`Invalid model provider: ${config.model.provider}`);
  if (typeof config.model.name !== 'string' || config.model.name.trim().length === 0)
    throw new Error('model.name must be a non-empty string');
  if (Object.hasOwn(config.model, 'baseUrl'))
    throw new Error(
      'model.baseUrl is not allowed in repository policy; use CODE_ZERO_MODEL_BASE_URL',
    );

  if (!Array.isArray(config.checks)) throw new Error('checks must be a list of commands');
  for (const command of config.checks) {
    if (typeof command !== 'string') throw new Error('checks must contain only strings');
    assertExecutableCommand(command);
  }

  assertRatio(config.autofix.minConfidence, 'autofix.minConfidence');
  if (typeof config.proactive.enabled !== 'boolean')
    throw new Error('proactive.enabled must be a boolean');
  if (typeof config.issues.enabled !== 'boolean')
    throw new Error('issues.enabled must be a boolean');
  if (
    typeof config.issues.requireLabel !== 'string' ||
    config.issues.requireLabel.trim().length === 0
  )
    throw new Error('issues.requireLabel must be a non-empty label name');
  assertBranchPrefix(config.issues.branchPrefix);
  if (typeof config.issues.validationComment !== 'boolean')
    throw new Error('issues.validationComment must be a boolean');
  if (typeof config.autofix.enabled !== 'boolean')
    throw new Error('autofix.enabled must be a boolean');
  if (typeof config.autofix.requireIsolated !== 'boolean')
    throw new Error('autofix.requireIsolated must be a boolean');
  if (!Array.isArray(config.autofix.allowedChangeRisks))
    throw new Error('autofix.allowedChangeRisks must be a list');
  for (const risk of config.autofix.allowedChangeRisks)
    if (risk !== 'mechanical' && risk !== 'behavioral')
      throw new Error(`Invalid autofix change risk: ${String(risk)}`);
  assertRatio(config.validation.minConfidence, 'validation.minConfidence');
  assertPositiveInteger(config.agent.maxAttempts, 'agent.maxAttempts');
  assertPositiveInteger(config.agent.timeoutMs, 'agent.timeoutMs');
  assertPositiveInteger(config.agent.maxChangedFiles, 'agent.maxChangedFiles');
  assertPositiveInteger(config.runner.maxOutputBytes, 'runner.maxOutputBytes');
  assertNonNegativeOptional(
    config.model.inputCostPerMillionTokens,
    'model.inputCostPerMillionTokens',
  );
  assertNonNegativeOptional(
    config.model.outputCostPerMillionTokens,
    'model.outputCostPerMillionTokens',
  );

  if (config.runner.isolation !== 'local' && config.runner.isolation !== 'container')
    throw new Error(`Invalid runner isolation: ${String(config.runner.isolation)}`);
  if (config.runner.engine !== 'docker' && config.runner.engine !== 'podman')
    throw new Error(`Invalid container engine: ${String(config.runner.engine)}`);
  if (config.runner.isolation === 'container' && !config.runner.image)
    throw new Error('runner.image is required when runner.isolation is container');
  if (!config.runner.workdir.startsWith('/'))
    throw new Error('runner.workdir must be an absolute container path');

  return config;
}

/**
 * Whether policy permits this run to modify the checkout.
 *
 * Writing requires an explicit write mode and repository permission. `observe` and `suggest` can
 * never write, regardless of configuration.
 */
export function mayModifyRepository(config: CodeZeroConfig, mode: RunMode): boolean {
  return (mode === 'fix' || mode === 'autonomous') && config.autofix.enabled;
}

/** Whether repository policy permits this class of change to pass the autofix gate. */
export function mayAutofixChange(config: CodeZeroConfig, risk: ChangeRisk): boolean {
  return risk !== 'high-impact' && config.autofix.allowedChangeRisks.includes(risk);
}

/**
 * Branch prefixes become git ref names verbatim, so anything a ref cannot carry is rejected here
 * rather than surfacing later as a failed push or, worse, an unexpected ref.
 */
const BRANCH_PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\/?$/;

function assertBranchPrefix(value: unknown): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 100 ||
    value.includes('..') ||
    value.endsWith('.lock') ||
    value.endsWith('.lock/') ||
    !BRANCH_PREFIX.test(value)
  )
    throw new Error('issues.branchPrefix must be a valid git branch prefix');
}

function assertRatio(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${name} must be between 0 and 1`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeOptional(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0))
    throw new Error(`${name} must be a non-negative number`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
