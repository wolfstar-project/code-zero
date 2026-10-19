import {
  effectiveExecution,
  type DeploymentConfigIssue,
  type DeploymentSettings,
  type Edition,
  type ExecutionSettings,
  type OrganizationLimits,
} from '@code-zero/config';
import { isModelConfigured } from '@code-zero/models';

import type { ScheduleLimits } from './control-plane.js';

/** What the deployment's settings resolved to when they were read. */
export type SettingsState =
  | {
      readonly ok: true;
      readonly settings: DeploymentSettings;
      /** Who saved the stored settings, and when. Null for the file source and for defaults. */
      readonly saved: { readonly by: string; readonly at: string } | null;
      /**
       * Problems that leave the settings usable: a deployment file that states settings while the
       * dashboard is their source, for one. Shown, never acted on.
       */
      readonly warnings: readonly DeploymentConfigIssue[];
    }
  | { readonly ok: false; readonly issues: readonly DeploymentConfigIssue[] };

/** A service a deployment depends on. */
export type ServiceName = 'model' | 'sandbox' | 'database' | 'mail';

/**
 * Whether one service is set up, and nothing more.
 *
 * No credential, URL, host, or provider name: on the managed cloud these are the service's own
 * secrets, and a customer is owed whether the service works, not how it is wired.
 */
export interface ServiceStatus {
  readonly service: ServiceName;
  readonly configured: boolean;
}

/** An account's membership in one organization, as the store holds it right now. */
export interface OrganizationMembership {
  readonly role: string;
  /** Whether that role may change the organization's policy. */
  readonly managesPolicy: boolean;
}

/**
 * Organization limits on the managed cloud, backed by the composition root's store.
 *
 * Membership is a lookup rather than something carried on the session, because a session remembers
 * the organization it last acted in, not whether its account still belongs there.
 */
export interface OrganizationSettingsStore {
  membership(organizationId: string, userId: string): Promise<OrganizationMembership | null>;
  /** The stored limits document, or null when the organization never chose any. */
  read(organizationId: string): Promise<unknown>;
  save(organizationId: string, document: Record<string, unknown>, actor: string): Promise<void>;
}

interface SettingsAuthorityBase {
  readonly edition: Edition;
  /** Reads the source again on every call, so a saved change is what the next run is held to. */
  read(): Promise<SettingsState>;
  services(): Promise<readonly ServiceStatus[]>;
  /** Present only on the managed cloud, where organizations may choose stricter limits. */
  readonly organizations?: OrganizationSettingsStore;
}

/** Settings read from the trusted deployment file. Nothing in the control plane can write them. */
export interface FileSettingsAuthority extends SettingsAuthorityBase {
  readonly source: 'file';
  /** The file an administrator edits, shown so they know where to look. */
  readonly filePath: string;
}

/** Settings kept in the store and edited from the dashboard. */
export interface DashboardSettingsAuthority extends SettingsAuthorityBase {
  readonly source: 'dashboard';
  save(settings: DeploymentSettings, actor: string): Promise<void>;
}

/**
 * The deployment's settings, as the composition root backs them.
 *
 * Declared structurally so this package stays free of the store and the file system: `apps/web`
 * builds one from `@code-zero/database` and the deployment file, and a test builds one from memory.
 * Which of the two sources it is was decided in the deployment's environment before the process
 * started; nothing a request carries can change it.
 */
export type DeploymentSettingsAuthority = FileSettingsAuthority | DashboardSettingsAuthority;

/**
 * What one run is held to: the deployment's settings and, on the managed cloud, the stricter limits
 * of the organization it was started for.
 */
export interface RunPolicy {
  readonly settings: DeploymentSettings;
  readonly organization?: { readonly id: string; readonly limits: OrganizationLimits };
  /**
   * Whether the run may only execute inside an isolated sandbox: the deployment's container
   * sandbox, or a hosted sandbox provider's lease. True on the managed cloud, where a customer's
   * repository must never run on the service's own host; a run that would reach neither is refused.
   */
  readonly isolationRequired?: boolean;
}

/** The limits a run is held to once its organization's are applied. */
export function runExecution(policy: RunPolicy): ExecutionSettings {
  return effectiveExecution(policy.settings.execution, policy.organization?.limits ?? null);
}

/**
 * The scheduler limits for a run under this policy.
 *
 * The deployment's limit bounds every run together; an organization's lower limit bounds only its
 * own runs. Feeding the organization's value in as the deployment-wide one would let one cautious
 * organization throttle every other tenant.
 */
export function scheduleLimits(policy: RunPolicy): ScheduleLimits {
  const { organization } = policy;
  return {
    maxConcurrent: policy.settings.execution.maxConcurrentTasks,
    ...(organization
      ? { group: { key: organization.id, maxConcurrent: runExecution(policy).maxConcurrentTasks } }
      : {}),
  };
}

/** What the composition root knows about the connections it opened. */
export interface DeploymentConnections {
  database: boolean;
  mail: boolean;
  /**
   * Whether a hosted sandbox provider (Cloudflare, Vercel, ViteHub) is wired into task execution.
   * It brings its own image, so it counts as the sandbox whether or not a container is configured.
   */
  hostedSandbox: boolean;
}

/**
 * Whether each service the deployment depends on is set up, from the settings and the connections.
 *
 * The model is reported only when the deployment names one: otherwise each repository chooses its
 * own, and there is no single answer to give. Only the credential's presence is checked — never its
 * value, and never whether the provider accepts it, which only a run can find out.
 */
export function deploymentServices(
  settings: DeploymentSettings | null,
  connections: DeploymentConnections,
  environment: NodeJS.ProcessEnv,
): ServiceStatus[] {
  return [
    ...(settings?.model
      ? [
          {
            service: 'model' as const,
            configured: isModelConfigured(settings.model.provider, environment),
          },
        ]
      : []),
    {
      service: 'sandbox',
      configured: connections.hostedSandbox || (settings?.runner ?? null) !== null,
    },
    { service: 'database', configured: connections.database },
    { service: 'mail', configured: connections.mail },
  ];
}
