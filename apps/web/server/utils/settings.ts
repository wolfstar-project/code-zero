import {
  deploymentServices,
  type DeploymentConnections,
  type DeploymentSettingsAuthority,
  type OrganizationSettingsStore,
  type RunPolicy,
  type SettingsState,
} from '@code-zero/api';
import { organizationRoles } from '@code-zero/auth/access';
import {
  defaultDeploymentSettings,
  deploymentSettingsDocument,
  LEGACY_DEPLOYMENT_CONFIG_FILE,
  parseDeploymentSettings,
  type DeploymentConfigIssue,
  type Parsed,
} from '@code-zero/config';
import {
  optionalDatabaseUrlFromEnvironment,
  organizationMemberRole,
  readDeploymentSettings,
  readOrganizationSettings,
  saveDeploymentSettings,
  saveOrganizationSettings,
  type StoredSettings,
} from '@code-zero/database';
import { mailProviderNameFromEnvironment } from '@code-zero/mail';

import { database } from './database.js';
import {
  deploymentFile,
  deploymentIdentity,
  type DeploymentIdentity,
  type LoadedDeploymentFile,
} from './deployment.js';

/** The stored deployment settings, behind the two calls the dashboard source needs. */
export interface StoredSettingsSource {
  read(): Promise<StoredSettings | null>;
  save(document: Record<string, unknown>, actor: string): Promise<void>;
}

/** Everything the settings authority reads from, injected so a test can hold it all in memory. */
export interface SettingsAuthorityDependencies {
  identity: DeploymentIdentity;
  file: LoadedDeploymentFile;
  stored: StoredSettingsSource;
  organizations: OrganizationSettingsStore;
  connections: DeploymentConnections;
  environment: Readonly<Record<string, string | undefined>>;
}

/**
 * The deployment's settings, from exactly one source.
 *
 * With the file as the source, the file's settings sections are the settings and nothing writes
 * them. With the dashboard as the source, the store is, and the file's settings sections — if it
 * still has any — are reported as ignored rather than merged: a value has one home, and the
 * operator is told which one it is not. The file's control-plane and polling sections are read
 * either way; they are bootstrap policy, not settings.
 *
 * Every read goes back to the source, so a saved change is what the next run is held to.
 */
export function createSettingsAuthority(
  dependencies: SettingsAuthorityDependencies,
): DeploymentSettingsAuthority {
  const { identity, file, stored, organizations, connections, environment } = dependencies;

  async function read(): Promise<SettingsState> {
    if (identity.issues.length > 0) return { ok: false, issues: identity.issues };
    const notes = file.legacy ? [renameNote(file)] : [];
    if (identity.source === 'file') {
      if (!file.settings.ok) return { ok: false, issues: file.settings.issues };
      return { ok: true, settings: file.settings.value, saved: null, warnings: notes };
    }
    const record = await stored.read();
    const parsed: Parsed<typeof defaultDeploymentSettings> = record
      ? parseDeploymentSettings(record.document)
      : { ok: true, value: defaultDeploymentSettings };
    if (!parsed.ok) return { ok: false, issues: parsed.issues };
    return {
      ok: true,
      settings: parsed.value,
      saved: record ? { by: record.updatedBy, at: record.updatedAt.toISOString() } : null,
      warnings: file.declaresSettings ? [...notes, ignoredNote(file)] : notes,
    };
  }

  async function services() {
    const state = await read();
    return deploymentServices(state.ok ? state.settings : null, connections, environment);
  }

  const shared = {
    edition: identity.edition,
    read,
    services,
    ...(identity.edition === 'cloud' ? { organizations } : {}),
  };
  if (identity.source === 'dashboard')
    return {
      ...shared,
      source: 'dashboard',
      save: (settings, actor) => stored.save(deploymentSettingsDocument(settings), actor),
    };
  return { ...shared, source: 'file', filePath: file.path };
}

function renameNote(file: LoadedDeploymentFile): DeploymentConfigIssue {
  return {
    path: '$',
    message: `${file.path} uses the old name ${LEGACY_DEPLOYMENT_CONFIG_FILE}; rename it to config.yml.`,
  };
}

function ignoredNote(file: LoadedDeploymentFile): DeploymentConfigIssue {
  return {
    path: '$',
    message: `${file.path} states settings, which are ignored because the dashboard is their source. Remove them from the file.`,
  };
}

/**
 * Whether an organization role may change the organization's policy.
 *
 * Asked of `@code-zero/auth`'s own role definitions rather than a list of role names, so the
 * organization plugin and this check cannot disagree about who manages policy. A membership can
 * hold several comma-separated roles, the way Better Auth stores them; any one that grants
 * `policy: write` is enough.
 */
export function managesOrganizationPolicy(role: string): boolean {
  return role
    .split(',')
    .map((name) => name.trim())
    .some((name) => {
      const definition = Object.entries(organizationRoles).find(([key]) => key === name)?.[1];
      const statements: Readonly<Record<string, readonly string[] | undefined>> =
        definition?.statements ?? {};
      return statements.policy?.includes('write') ?? false;
    });
}

/** Organization limits and memberships, read from Postgres on every call. */
function postgresOrganizationSettings(): OrganizationSettingsStore {
  return {
    async membership(organizationId, userId) {
      const role = await organizationMemberRole(database(), organizationId, userId);
      return role === null ? null : { role, managesPolicy: managesOrganizationPolicy(role) };
    },
    read: async (organizationId) =>
      (await readOrganizationSettings(database(), organizationId))?.document ?? null,
    save: async (organizationId, document, actor) => {
      await saveOrganizationSettings(database(), organizationId, document, actor);
    },
  };
}

function postgresStoredSettings(): StoredSettingsSource {
  return {
    read: () => readDeploymentSettings(database()),
    save: async (document, actor) => {
      await saveDeploymentSettings(database(), document, actor);
    },
  };
}

/**
 * The authority this process uses, built once the instance file has been read.
 *
 * No hosted sandbox provider is wired into this app's task execution yet, so the sandbox counts as
 * set up only when the settings name a container sandbox.
 */
let pending: Promise<DeploymentSettingsAuthority> | undefined;

export function settingsAuthority(): Promise<DeploymentSettingsAuthority> {
  pending ??= deploymentFile().then((file) =>
    createSettingsAuthority({
      identity: deploymentIdentity(),
      file,
      stored: postgresStoredSettings(),
      organizations: postgresOrganizationSettings(),
      connections: {
        database: optionalDatabaseUrlFromEnvironment(process.env) !== undefined,
        mail: mailProviderNameFromEnvironment(process.env) !== 'console',
        hostedSandbox: false,
      },
      environment: process.env,
    }),
  );
  return pending;
}

/**
 * The policy work this deployment starts on its own — a webhook delivery, a polling pass — runs
 * under: the deployment's settings, with no organization, since that work belongs to no customer.
 * Refused while the settings are invalid, like every other run.
 */
export async function deploymentRunPolicy(): Promise<Parsed<RunPolicy>> {
  const authority = await settingsAuthority();
  const state = await authority.read();
  if (!state.ok) return { ok: false, issues: state.issues };
  return {
    ok: true,
    value: { settings: state.settings, isolationRequired: authority.edition === 'cloud' },
  };
}
