// Types only: `@code-zero/config` reads files and parses YAML, so none of its code belongs in the
// browser bundle. The lists below restate its enumerations, and the server re-checks every value.
import type { OrganizationSettingsView, SettingsView } from '@code-zero/api';
import type { DeploymentSettings, ExecutionSettings, OrganizationLimits } from '@code-zero/config';
import type { ModelProviderKind, NetworkPolicy, RunMode } from '@code-zero/shared';
import { ORPCError } from '@orpc/client';

export type SelfHostedSettingsView = Extract<SettingsView, { edition: 'self-hosted' }>;
export type CloudSettingsView = Extract<SettingsView, { edition: 'cloud' }>;
export type ContainerEngine = NonNullable<DeploymentSettings['runner']>['engine'];

// Records rather than arrays, so adding a mode, a policy, an engine or a provider to the shared
// types fails the type check here until the form offers it too.
const MODE_SET: Record<RunMode, true> = {
  observe: true,
  suggest: true,
  fix: true,
  autonomous: true,
};
const NETWORK_SET: Record<NetworkPolicy, true> = { none: true, restricted: true, full: true };
const ENGINE_SET: Record<ContainerEngine, true> = { docker: true, podman: true };
const PROVIDER_SET: Record<ModelProviderKind, true> = {
  'ai-gateway': true,
  anthropic: true,
  'claude-code': true,
  'codex-cli': true,
  google: true,
  openai: true,
  'openai-compatible': true,
};

/** In the canonical order the parser stores them in: least to most write access. */
export const RUN_MODES = keysOf(MODE_SET);
/** Narrowest first. */
export const NETWORK_POLICIES = keysOf(NETWORK_SET);
export const CONTAINER_ENGINES = keysOf(ENGINE_SET);
export const MODEL_PROVIDERS = keysOf(PROVIDER_SET);

/**
 * What the form starts from when the stored settings cannot be read: the parser's own defaults
 * (`defaultDeploymentSettings` in `@code-zero/config`), so saving an untouched form changes nothing
 * a deployment without settings did not already do.
 */
export const DEFAULT_SETTINGS: DeploymentSettings = {
  execution: {
    maxConcurrentTasks: 4,
    commandTimeoutMinutes: 30,
    allowedModes: RUN_MODES,
    maxNetwork: 'full',
  },
  model: null,
  runner: null,
};

/**
 * What a number input holds. Vue's `v-model` casts a `type="number"` input's value to a number and
 * leaves it as text when it cannot (an emptied field is `''`), so both arrive here, and an emptied
 * field is reported as empty rather than turned into a `0` the server would refuse for a reason
 * the reader did not cause.
 */
export type NumberText = string | number;

/** The editable settings, flat so every control binds one field and every issue names one. */
export interface SettingsFormState {
  maxConcurrentTasks: NumberText;
  commandTimeoutMinutes: NumberText;
  allowedModes: RunMode[];
  maxNetwork: NetworkPolicy;
  /** `repository` leaves the model to each repository's `.code-zero.yml`. */
  modelSource: 'repository' | 'deployment';
  modelProvider: ModelProviderKind;
  modelName: string;
  /** `repository` leaves isolation to each repository's `.code-zero.yml`. */
  runnerSource: 'repository' | 'container';
  runnerEngine: ContainerEngine;
  runnerImage: string;
}

export type SettingsField = keyof SettingsFormState;

/** An organization's own limits. An empty number, or unrestricted modes, means the plan's value. */
export interface OrganizationFormState {
  maxConcurrentTasks: NumberText;
  commandTimeoutMinutes: NumberText;
  restrictModes: boolean;
  allowedModes: RunMode[];
}

export type OrganizationField = keyof OrganizationFormState;

/** `settings.update`'s input, as `deploymentSettingsInput` in `@code-zero/api` declares it. */
export interface SettingsInput {
  execution: {
    maxConcurrentTasks: number;
    commandTimeoutMinutes: number;
    allowedModes: string[];
    maxNetwork: string;
  };
  model: { provider: string; name: string } | null;
  runner: { isolation: string; engine: string; image: string } | null;
}

/** The `limits` half of `settings.organization.update`'s input. `null` keeps the plan's value. */
export interface OrganizationLimitsInput {
  maxConcurrentTasks: number | null;
  commandTimeoutMinutes: number | null;
  allowedModes: string[] | null;
}

/**
 * One problem with one field: a key this app translates, or the server's own sentence.
 *
 * The server's sentences come from the settings parser and name the rule a value broke ("Expected
 * an integer from 1 to 64."); they are rendered as text, never as markup.
 */
export type IssueText = { readonly key: string } | { readonly text: string };

/** Problems by field. `form` holds those that belong to no single control. */
export type FieldIssues<Field extends string> = Partial<Record<Field | 'form', IssueText[]>>;

export type FormResult<Input, Field extends string> =
  | { ok: true; input: Input }
  | { ok: false; issues: FieldIssues<Field> };

/** An issue as the settings procedures report it in a `BAD_REQUEST`'s `data.issues`. */
export interface ServerIssue {
  path: string;
  message: string;
}

/** Why a settings call failed, in the terms the page has copy for. */
export type SettingsError =
  | 'forbidden'
  | 'unauthorized'
  | 'unavailable'
  | 'invalid'
  | 'precondition'
  | 'generic';

/** Paths the settings parser reports, most specific first, and the control each belongs to. */
const SETTINGS_PATHS: readonly (readonly [string, SettingsField])[] = [
  ['$.execution.max_concurrent_tasks', 'maxConcurrentTasks'],
  ['$.execution.command_timeout_minutes', 'commandTimeoutMinutes'],
  ['$.execution.allowed_modes', 'allowedModes'],
  ['$.execution.max_network', 'maxNetwork'],
  ['$.model.provider', 'modelProvider'],
  ['$.model.name', 'modelName'],
  ['$.model', 'modelSource'],
  ['$.runner.engine', 'runnerEngine'],
  ['$.runner.image', 'runnerImage'],
  ['$.runner', 'runnerSource'],
];

/** The organization limits parser reports paths from the limits document's own root. */
const ORGANIZATION_PATHS: readonly (readonly [string, OrganizationField])[] = [
  ['$.max_concurrent_tasks', 'maxConcurrentTasks'],
  ['$.command_timeout_minutes', 'commandTimeoutMinutes'],
  ['$.allowed_modes', 'allowedModes'],
];

const NUMBER_REQUIRED: IssueText = { key: 'dashboard.settings.form.numberRequired' };

/** The form a set of settings fills in. */
export function formFromSettings(settings: DeploymentSettings): SettingsFormState {
  return {
    maxConcurrentTasks: String(settings.execution.maxConcurrentTasks),
    commandTimeoutMinutes: String(settings.execution.commandTimeoutMinutes),
    allowedModes: [...settings.execution.allowedModes],
    maxNetwork: settings.execution.maxNetwork,
    modelSource: settings.model ? 'deployment' : 'repository',
    modelProvider: settings.model?.provider ?? 'openai',
    modelName: settings.model?.name ?? '',
    runnerSource: settings.runner ? 'container' : 'repository',
    runnerEngine: settings.runner?.engine ?? 'docker',
    runnerImage: settings.runner?.image ?? '',
  };
}

/** The form for a self-hosted view: its settings, or the defaults while they are invalid. */
export function formFromView(view: SelfHostedSettingsView): SettingsFormState {
  return formFromSettings(view.state.ok ? view.state.settings : DEFAULT_SETTINGS);
}

/**
 * The `settings.update` input a form describes.
 *
 * Only what cannot be sent at all is caught here — an emptied number. Bounds, names and images
 * are the server's to judge, with the same parser the deployment file goes through, so the form
 * and the file cannot come to disagree about what is allowed.
 */
export function settingsInputFromForm(
  form: SettingsFormState,
): FormResult<SettingsInput, SettingsField> {
  const issues: FieldIssues<SettingsField> = {};
  const maxConcurrentTasks = requiredNumber(form.maxConcurrentTasks);
  const commandTimeoutMinutes = requiredNumber(form.commandTimeoutMinutes);
  if (maxConcurrentTasks === null) issues.maxConcurrentTasks = [NUMBER_REQUIRED];
  if (commandTimeoutMinutes === null) issues.commandTimeoutMinutes = [NUMBER_REQUIRED];
  if (maxConcurrentTasks === null || commandTimeoutMinutes === null) return { ok: false, issues };
  return {
    ok: true,
    input: {
      execution: {
        maxConcurrentTasks,
        commandTimeoutMinutes,
        // Sent in the canonical order whatever order the boxes were ticked in.
        allowedModes: RUN_MODES.filter((mode) => form.allowedModes.includes(mode)),
        maxNetwork: form.maxNetwork,
      },
      model:
        form.modelSource === 'deployment'
          ? { provider: form.modelProvider, name: form.modelName.trim() }
          : null,
      runner:
        form.runnerSource === 'container'
          ? { isolation: 'container', engine: form.runnerEngine, image: form.runnerImage.trim() }
          : null,
    },
  };
}

/** The form an organization's stored limits fill in. */
export function organizationFormFromView(
  view: OrganizationSettingsView,
  plan: ExecutionSettings | null,
): OrganizationFormState {
  return organizationFormFromLimits(view.limits, plan);
}

/**
 * The draft's modes are only ever the plan's: the form shows a box for each of those and no
 * other, so a mode the plan does not allow — the full list while the plan's own modes apply, or a
 * stored mode the plan has since dropped — would otherwise be sent without the reader seeing it.
 */
export function organizationFormFromLimits(
  limits: OrganizationLimits,
  plan: ExecutionSettings | null,
): OrganizationFormState {
  const offered = selectableModes(plan);
  return {
    maxConcurrentTasks: limits.maxConcurrentTasks === null ? '' : String(limits.maxConcurrentTasks),
    commandTimeoutMinutes:
      limits.commandTimeoutMinutes === null ? '' : String(limits.commandTimeoutMinutes),
    restrictModes: limits.allowedModes !== null,
    allowedModes: limits.allowedModes
      ? offered.filter((mode) => limits.allowedModes?.includes(mode))
      : offered,
  };
}

/**
 * The organization limits a form describes. An empty number keeps the plan's value, so the only
 * local mistake left is text that is not a number at all.
 */
export function organizationInputFromForm(
  form: OrganizationFormState,
): FormResult<OrganizationLimitsInput, OrganizationField> {
  const issues: FieldIssues<OrganizationField> = {};
  const maxConcurrentTasks = optionalNumber(form.maxConcurrentTasks);
  const commandTimeoutMinutes = optionalNumber(form.commandTimeoutMinutes);
  if (maxConcurrentTasks === undefined) issues.maxConcurrentTasks = [NUMBER_REQUIRED];
  if (commandTimeoutMinutes === undefined) issues.commandTimeoutMinutes = [NUMBER_REQUIRED];
  if (maxConcurrentTasks === undefined || commandTimeoutMinutes === undefined)
    return { ok: false, issues };
  return {
    ok: true,
    input: {
      maxConcurrentTasks,
      commandTimeoutMinutes,
      allowedModes: form.restrictModes
        ? RUN_MODES.filter((mode) => form.allowedModes.includes(mode))
        : null,
    },
  };
}

/** Server issues for the deployment settings form, by the control each one belongs to. */
export function settingsFieldIssues(issues: readonly ServerIssue[]): FieldIssues<SettingsField> {
  return byField(issues, SETTINGS_PATHS);
}

/** Server issues for the organization limits form, by the control each one belongs to. */
export function organizationFieldIssues(
  issues: readonly ServerIssue[],
): FieldIssues<OrganizationField> {
  return byField(issues, ORGANIZATION_PATHS);
}

/**
 * The issues a refused save carried, or null when the refusal was not about the values.
 *
 * Read defensively: the shape is the settings procedures' own, but anything that does not match it
 * (the transport's input validation, say) still reaches the reader as a form-level issue rather
 * than vanishing.
 */
export function issuesFromError(caught: unknown): ServerIssue[] | null {
  if (!(caught instanceof ORPCError) || caught.code !== 'BAD_REQUEST') return null;
  const data: unknown = caught.data;
  const list = isRecord(data) && Array.isArray(data.issues) ? (data.issues as unknown[]) : [];
  const issues = list.flatMap((issue): ServerIssue[] =>
    isRecord(issue) && typeof issue.message === 'string'
      ? [{ path: typeof issue.path === 'string' ? issue.path : '$', message: issue.message }]
      : [],
  );
  return issues;
}

/**
 * The error code decides the copy, never the server's message: a refusal's wording is the
 * server's, and the page has its own sentence for each kind of refusal.
 */
export function classifySettingsError(caught: unknown): SettingsError {
  if (!(caught instanceof ORPCError)) return 'generic';
  switch (caught.code) {
    case 'FORBIDDEN':
      return 'forbidden';
    case 'UNAUTHORIZED':
      return 'unauthorized';
    case 'NOT_IMPLEMENTED':
      return 'unavailable';
    case 'BAD_REQUEST':
      return 'invalid';
    case 'PRECONDITION_FAILED':
      return 'precondition';
    default:
      return 'generic';
  }
}

/** Whether a mode is the one every deployment and organization must keep. */
export function isRequiredMode(mode: RunMode): boolean {
  return mode === 'observe';
}

/** The plan's modes an organization may choose from: it can narrow them, never add to them. */
export function selectableModes(plan: ExecutionSettings | null): RunMode[] {
  return plan ? RUN_MODES.filter((mode) => plan.allowedModes.includes(mode)) : [...RUN_MODES];
}

/** A set's keys, in the order they were written. */
function keysOf<Key extends string>(set: Readonly<Record<Key, true>>): Key[] {
  return Object.keys(set).filter((key): key is Key => key in set);
}

function byField<Field extends string>(
  issues: readonly ServerIssue[],
  paths: readonly (readonly [string, Field])[],
): FieldIssues<Field> {
  const grouped: FieldIssues<Field> = {};
  for (const issue of issues) {
    const field = paths.find(([prefix]) => covers(prefix, issue.path))?.[1] ?? 'form';
    (grouped[field] ??= []).push({ text: issue.message });
  }
  return grouped;
}

function covers(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

function requiredNumber(text: NumberText): number | null {
  const trimmed = String(text).trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** `null` for an empty field, `undefined` for text that is not a number. */
function optionalNumber(text: NumberText): number | null | undefined {
  const trimmed = String(text).trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
