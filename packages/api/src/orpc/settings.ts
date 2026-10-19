import {
  EXECUTION_LIMITS,
  effectiveExecution,
  isModeAllowed,
  noOrganizationLimits,
  organizationLimitsAbovePlan,
  organizationLimitsDocument,
  parseDeploymentSettings,
  parseOrganizationLimits,
  renderDeploymentSettings,
  type DeploymentConfigIssue,
  type ExecutionSettings,
  type OrganizationLimits,
} from '@code-zero/config';
import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import type { Principal } from '../access.js';
import {
  runExecution,
  type DeploymentSettingsAuthority,
  type OrganizationSettingsStore,
  type RunPolicy,
  type ServiceStatus,
  type SettingsState,
} from '../settings.js';
import { principalActor } from './actor.js';
import { useLogger } from './logging.js';

/** What every settings handler reads from the procedure context. */
interface SettingsContext {
  principal: Principal;
  settings?: DeploymentSettingsAuthority | undefined;
}

/**
 * `settings.update`'s input: the shape of the settings, and nothing about their values.
 *
 * Values are checked once, by `@code-zero/config`'s parser, against the same rules the deployment
 * file is held to — a second copy of the bounds here is how the form and the file would come to
 * disagree about what is allowed.
 */
export const deploymentSettingsInput = z.object({
  execution: z.object({
    maxConcurrentTasks: z.number(),
    commandTimeoutMinutes: z.number(),
    allowedModes: z.array(z.string()),
    maxNetwork: z.string(),
  }),
  model: z.object({ provider: z.string(), name: z.string() }).nullable(),
  runner: z.object({ isolation: z.string(), engine: z.string(), image: z.string() }).nullable(),
});

/** `settings.organization.get`'s input. The organization is named, then membership is checked. */
export const organizationInput = z.object({ organizationId: z.string().min(1) });

/** `settings.organization.update`'s input: `null` keeps the plan's value. */
export const organizationLimitsInput = organizationInput.extend({
  limits: z.object({
    maxConcurrentTasks: z.number().nullable(),
    commandTimeoutMinutes: z.number().nullable(),
    allowedModes: z.array(z.string()).nullable(),
  }),
});

/** One organization's limits, as a member sees them. */
export interface OrganizationSettingsView {
  id: string;
  role: string;
  /** Whether this member may change the limits. The update procedure checks again regardless. */
  editable: boolean;
  limits: OrganizationLimits;
  /** True when the stored limits could not be read; runs for the organization are refused. */
  invalid: boolean;
  /** The limits its runs are held to, or null while the service settings are unavailable. */
  effective: ExecutionSettings | null;
}

/**
 * The settings page's read model.
 *
 * Self-hosted, an administrator sees the whole document and where it comes from. On the managed
 * cloud a customer sees whether each service works, the plan's limits, and their organization's
 * own — never the service's model, sandbox, or connections, and nothing that could carry a secret.
 */
export type SettingsView =
  | {
      edition: 'self-hosted';
      source: 'file' | 'dashboard';
      /** Whether settings can be saved from the dashboard at all. */
      editable: boolean;
      filePath: string | null;
      state: SettingsState;
      services: readonly ServiceStatus[];
      bounds: typeof EXECUTION_LIMITS;
    }
  | {
      edition: 'cloud';
      services: readonly ServiceStatus[];
      /** The plan's limits, or null while the service settings are unavailable. */
      plan: ExecutionSettings | null;
      organization: OrganizationSettingsView | null;
      bounds: typeof EXECUTION_LIMITS;
    };

const SESSION_ONLY =
  'Settings are managed from a signed-in dashboard session, not with a token or an API key';
const ADMIN_ONLY = 'Managing the deployment settings requires the admin role';
const CLOUD_LOCKED = 'The managed service configures these settings; they cannot be changed here';
const FILE_SOURCE =
  'These settings come from the deployment file; edit the file, or make the dashboard their source';
const NOT_A_MEMBER = 'You are not a member of this organization';
const NOT_A_POLICY_MANAGER = "Changing this organization's limits requires the owner or admin role";
const SETTINGS_INVALID =
  'The deployment settings are invalid, so no task can start until they are fixed';
const ORGANIZATION_LIMITS_INVALID =
  "This organization's stored limits are invalid, so its tasks cannot start until they are saved again";
const CLOUD_ONLY = 'Organization limits exist on the managed cloud only';
const NO_ORGANIZATION_SELECTED = 'Select the organization this task is for before starting it';
const KEY_WITHOUT_ORGANIZATION = 'This API key does not belong to an organization';
const ORGANIZATION_UNVERIFIABLE =
  'Organization membership cannot be verified on this deployment, so no customer task can start';

/** `settings.get`. Authorizes before it reads anything from the source or the services. */
export async function readSettings(context: SettingsContext): Promise<SettingsView> {
  const authority = requireAuthority(context.settings);
  const { principal } = context;
  if (principal.kind !== 'session') throw new ORPCError('FORBIDDEN', { message: SESSION_ONLY });
  if (authority.edition === 'self-hosted') {
    if (!principal.admin) throw new ORPCError('FORBIDDEN', { message: ADMIN_ONLY });
    const [state, services] = await Promise.all([authority.read(), authority.services()]);
    return {
      edition: 'self-hosted',
      source: authority.source,
      editable: authority.source === 'dashboard',
      filePath: authority.source === 'file' ? authority.filePath : null,
      state,
      services,
      bounds: EXECUTION_LIMITS,
    };
  }
  const [state, services] = await Promise.all([authority.read(), authority.services()]);
  // A customer is told whether the plan resolved, never why not: the reasons name the service's
  // own file and values.
  const plan = state.ok ? state.settings.execution : null;
  const organizationId = principal.account?.activeOrganizationId ?? null;
  const organization =
    organizationId && authority.organizations
      ? await organizationView(authority.organizations, principal, organizationId, plan)
      : null;
  return { edition: 'cloud', services, plan, organization, bounds: EXECUTION_LIMITS };
}

/** `settings.update`: replace the deployment settings, when the dashboard is their source. */
export async function updateSettings(
  context: SettingsContext,
  input: z.infer<typeof deploymentSettingsInput>,
): Promise<SettingsView> {
  const authority = requireAuthority(context.settings);
  const { principal } = context;
  const target = { type: 'settings', id: 'deployment' };
  // Every refusal below is decided here, on the server, whatever the page rendered: a disabled
  // input is a courtesy, not a control.
  if (principal.kind !== 'session') refuse(principal, 'settings.update', target, SESSION_ONLY);
  if (authority.edition === 'cloud') refuse(principal, 'settings.update', target, CLOUD_LOCKED);
  if (!principal.admin) refuse(principal, 'settings.update', target, ADMIN_ONLY);
  if (authority.source !== 'dashboard') refuse(principal, 'settings.update', target, FILE_SOURCE);

  const parsed = parseDeploymentSettings(documentFromInput(input));
  if (!parsed.ok) throw invalid(parsed.issues);
  await authority.save(parsed.value, principal.name);
  useLogger().audit({
    actor: principalActor(principal),
    action: 'settings.updated',
    outcome: 'success',
    target,
  });
  return readSettings(context);
}

/** `settings.export`: the settings as the YAML the deployment file would hold. */
export async function exportSettings(context: SettingsContext): Promise<{ yaml: string }> {
  const authority = requireAuthority(context.settings);
  if (context.principal.kind !== 'session')
    throw new ORPCError('FORBIDDEN', { message: SESSION_ONLY });
  if (authority.edition === 'cloud') throw new ORPCError('FORBIDDEN', { message: CLOUD_LOCKED });
  if (!context.principal.admin) throw new ORPCError('FORBIDDEN', { message: ADMIN_ONLY });
  const state = await authority.read();
  if (!state.ok) throw new ORPCError('PRECONDITION_FAILED', { message: SETTINGS_INVALID });
  return { yaml: renderDeploymentSettings(state.settings) };
}

/** `settings.organization.get`: one organization's limits, for one of its members. */
export async function readOrganizationSettings(
  context: SettingsContext,
  input: z.infer<typeof organizationInput>,
): Promise<OrganizationSettingsView> {
  const { authority, organizations } = requireOrganizations(context.settings);
  if (context.principal.kind !== 'session')
    throw new ORPCError('FORBIDDEN', { message: SESSION_ONLY });
  const state = await authority.read();
  const view = await organizationView(
    organizations,
    context.principal,
    input.organizationId,
    state.ok ? state.settings.execution : null,
  );
  if (!view) throw new ORPCError('FORBIDDEN', { message: NOT_A_MEMBER });
  return view;
}

/** `settings.organization.update`: lower an organization's limits below the plan. */
export async function updateOrganizationSettings(
  context: SettingsContext,
  input: z.infer<typeof organizationLimitsInput>,
): Promise<OrganizationSettingsView> {
  const { authority, organizations } = requireOrganizations(context.settings);
  const { principal } = context;
  const target = { type: 'organization', id: input.organizationId };
  if (principal.kind !== 'session' || !principal.account)
    refuse(principal, 'organization.settings.update', target, SESSION_ONLY);
  const membership = await organizations.membership(input.organizationId, principal.account.userId);
  // One answer for "no such organization" and "not yours", so the refusal does not reveal which
  // organizations exist.
  if (!membership) refuse(principal, 'organization.settings.update', target, NOT_A_MEMBER);
  if (!membership.managesPolicy)
    refuse(principal, 'organization.settings.update', target, NOT_A_POLICY_MANAGER);

  const state = await authority.read();
  if (!state.ok) throw new ORPCError('PRECONDITION_FAILED', { message: SETTINGS_INVALID });
  const parsed = parseOrganizationLimits({
    max_concurrent_tasks: input.limits.maxConcurrentTasks,
    command_timeout_minutes: input.limits.commandTimeoutMinutes,
    allowed_modes: input.limits.allowedModes,
  });
  if (!parsed.ok) throw invalid(parsed.issues);
  const abovePlan = organizationLimitsAbovePlan(parsed.value, state.settings.execution);
  if (abovePlan.length > 0) throw invalid(abovePlan);

  await organizations.save(
    input.organizationId,
    organizationLimitsDocument(parsed.value),
    principal.name,
  );
  useLogger().audit({
    actor: principalActor(principal),
    action: 'organization.settings.updated',
    outcome: 'success',
    target,
  });
  const view = await organizationView(
    organizations,
    principal,
    input.organizationId,
    state.settings.execution,
  );
  if (!view) throw new ORPCError('FORBIDDEN', { message: NOT_A_MEMBER });
  return view;
}

/**
 * The policy a task this principal creates runs under, or a refusal.
 *
 * `undefined` when the deployment keeps no settings at all, which is an embedded caller running
 * under repository policy alone, as it always has. Invalid settings refuse the task rather than
 * running it on defaults nobody chose, and so do an organization's unreadable limits.
 */
export async function taskPolicy(
  context: SettingsContext,
  request: { repository: string; mode: Principal['modes'][number] },
): Promise<RunPolicy | undefined> {
  const authority = context.settings;
  if (!authority) return undefined;
  const { principal } = context;
  const target = { type: 'repository', id: request.repository, mode: request.mode };
  const state = await authority.read();
  if (!state.ok) refuse(principal, 'task.create', target, SETTINGS_INVALID, 'PRECONDITION_FAILED');

  const owner = await runOwner(authority, principal);
  if (owner.kind === 'refused') refuse(principal, 'task.create', target, owner.reason);
  let organization: RunPolicy['organization'];
  if (owner.kind === 'organization') {
    const limits = parseOrganizationLimits(await owner.store.read(owner.id));
    if (!limits.ok)
      refuse(principal, 'task.create', target, ORGANIZATION_LIMITS_INVALID, 'PRECONDITION_FAILED');
    organization = { id: owner.id, limits: limits.value };
  }
  const policy: RunPolicy = {
    settings: state.settings,
    ...(organization ? { organization } : {}),
    isolationRequired: authority.edition === 'cloud',
  };
  if (!isModeAllowed(runExecution(policy), request.mode))
    refuse(
      principal,
      'task.create',
      target,
      `Execution mode '${request.mode}' is not allowed by the deployment settings`,
    );
  return policy;
}

/** Who a run is started for, decided once, when it is created. */
type RunOwner =
  | { kind: 'deployment' }
  | { kind: 'organization'; id: string; store: OrganizationSettingsStore }
  | { kind: 'refused'; reason: string };

/**
 * Who a run is started for.
 *
 * Self-hosted, every run is the deployment's own. On the managed cloud a customer's run always
 * belongs to one verified organization: an organization API key to the organization Better Auth
 * bound it to, and a session to the organization it selected, once the member table confirms the
 * account still belongs there. A session with no organization selected, or one that selected an
 * organization it is not (or no longer) a member of, is refused rather than run under the plan
 * alone — falling back would let a customer shed their organization's stricter limits by clearing
 * or switching the selection.
 *
 * Operator tokens are the one deliberate exception: they are the service's own credentials, set in
 * its environment by its operators, so they act for the deployment under the plan and never for a
 * customer organization.
 */
async function runOwner(
  authority: DeploymentSettingsAuthority,
  principal: Principal,
): Promise<RunOwner> {
  if (authority.edition !== 'cloud' || principal.kind === 'token') return { kind: 'deployment' };
  const store = authority.organizations;
  if (!store) return { kind: 'refused', reason: ORGANIZATION_UNVERIFIABLE };
  if (principal.kind === 'apiKey')
    return principal.organizationId
      ? { kind: 'organization', id: principal.organizationId, store }
      : { kind: 'refused', reason: KEY_WITHOUT_ORGANIZATION };
  const account = principal.account;
  if (!account?.activeOrganizationId) return { kind: 'refused', reason: NO_ORGANIZATION_SELECTED };
  const membership = await store.membership(account.activeOrganizationId, account.userId);
  return membership
    ? { kind: 'organization', id: account.activeOrganizationId, store }
    : { kind: 'refused', reason: NOT_A_MEMBER };
}

async function organizationView(
  store: OrganizationSettingsStore,
  principal: Principal,
  organizationId: string,
  plan: ExecutionSettings | null,
): Promise<OrganizationSettingsView | null> {
  if (!principal.account) return null;
  const membership = await store.membership(organizationId, principal.account.userId);
  if (!membership) return null;
  const parsed = parseOrganizationLimits(await store.read(organizationId));
  const limits = parsed.ok ? parsed.value : noOrganizationLimits;
  return {
    id: organizationId,
    role: membership.role,
    editable: membership.managesPolicy,
    limits,
    invalid: !parsed.ok,
    effective: plan && parsed.ok ? effectiveExecution(plan, limits) : null,
  };
}

/** The deployment-file document a settings form describes, ready for the one strict parser. */
function documentFromInput(
  input: z.infer<typeof deploymentSettingsInput>,
): Record<string, unknown> {
  return {
    execution: {
      max_concurrent_tasks: input.execution.maxConcurrentTasks,
      command_timeout_minutes: input.execution.commandTimeoutMinutes,
      allowed_modes: input.execution.allowedModes,
      max_network: input.execution.maxNetwork,
    },
    ...(input.model ? { model: { ...input.model } } : {}),
    ...(input.runner ? { runner: { ...input.runner } } : {}),
  };
}

function requireAuthority(
  settings: DeploymentSettingsAuthority | undefined,
): DeploymentSettingsAuthority {
  if (!settings)
    throw new ORPCError('NOT_IMPLEMENTED', { message: 'This deployment keeps no settings' });
  return settings;
}

function requireOrganizations(settings: DeploymentSettingsAuthority | undefined): {
  authority: DeploymentSettingsAuthority;
  organizations: OrganizationSettingsStore;
} {
  const authority = requireAuthority(settings);
  if (authority.edition !== 'cloud' || !authority.organizations)
    throw new ORPCError('FORBIDDEN', { message: CLOUD_ONLY });
  return { authority, organizations: authority.organizations };
}

/** A settings document the parser refused, with every issue for the form to point at. */
function invalid(issues: readonly DeploymentConfigIssue[]): ORPCError<'BAD_REQUEST', unknown> {
  return new ORPCError('BAD_REQUEST', {
    message: 'The settings are invalid',
    data: { issues: issues.map((issue) => ({ path: issue.path, message: issue.message })) },
  });
}

/**
 * Refuse, and leave the refusal in the audit trail.
 *
 * Refusals are recorded as deliberately as grants: a key or an account repeatedly reaching for
 * settings it was never given is the signal a trail exists to preserve.
 */
function refuse(
  principal: Principal,
  action: string,
  target: Record<string, unknown> & { type: string; id: string },
  message: string,
  code: 'FORBIDDEN' | 'PRECONDITION_FAILED' = 'FORBIDDEN',
): never {
  useLogger().audit.deny(message, { actor: principalActor(principal), action, target });
  throw new ORPCError(code, { message });
}
