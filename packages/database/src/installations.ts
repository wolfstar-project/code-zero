import { and, asc, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import type { Schema } from './schema/index.js';
import { forgeInstallation, organizationRepository } from './schema/installation.js';

/** Any Drizzle Postgres client opened on this package's schema, as `settings.ts` accepts one. */
type InstallationDatabase = PgDatabase<PgQueryResultHKT, Schema>;

/** The modes an organization's repository may be selected with: the two that cannot write. */
export type OrganizationRepositoryMode = 'observe' | 'suggest';

const MODES = new Set<string>(['observe', 'suggest']);

function isMode(value: string): value is OrganizationRepositoryMode {
  return MODES.has(value);
}

/** An installation attached to an organization, as every consumer outside this package sees one. */
export interface InstallationRecord {
  id: string;
  organizationId: string;
  provider: string;
  externalId: string;
  accountLogin: string;
  accountType: string;
  suspended: boolean;
}

/** A repository an organization selected, with the installation that reaches it. */
export interface OrganizationRepositoryRecord {
  id: string;
  organizationId: string;
  installationId: string;
  provider: string;
  externalId: string;
  owner: string;
  name: string;
  mode: OrganizationRepositoryMode;
}

/** What a caller supplies to attach an installation. The store mints the identity. */
export interface InstallationInput {
  organizationId: string;
  provider?: string;
  externalId: string;
  accountLogin: string;
  accountType: string;
  createdByUserId?: string | null;
}

/** One repository to select. */
export interface RepositorySelection {
  externalId: string;
  owner: string;
  name: string;
  mode?: OrganizationRepositoryMode;
}

/** The installation is already attached to a different organization. */
export class InstallationAlreadyAttachedError extends Error {
  constructor() {
    super('This installation is already attached to another organization');
    this.name = 'InstallationAlreadyAttachedError';
  }
}

/** The installation does not exist, or does not belong to the organization asking. */
export class InstallationNotFoundError extends Error {
  constructor() {
    super('This installation is not attached to the organization');
    this.name = 'InstallationNotFoundError';
  }
}

/**
 * Attach an installation to an organization.
 *
 * Idempotent for the organization that already holds it, so a reloaded callback page changes
 * nothing. Refused when another organization holds it: the unique index is what makes that true
 * under concurrency, and the conflict it raises is translated here rather than left as a driver
 * error nobody can tell apart from a failure.
 */
export async function attachInstallation(
  database: InstallationDatabase,
  input: InstallationInput,
): Promise<InstallationRecord> {
  const provider = input.provider ?? 'github';
  const [existing] = await database
    .select()
    .from(forgeInstallation)
    .where(
      and(
        eq(forgeInstallation.provider, provider),
        eq(forgeInstallation.externalId, input.externalId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.organizationId !== input.organizationId) {
      throw new InstallationAlreadyAttachedError();
    }
    const [updated] = await database
      .update(forgeInstallation)
      .set({
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        updatedAt: new Date(),
      })
      .where(eq(forgeInstallation.id, existing.id))
      .returning();
    if (!updated) throw new Error('The installation could not be updated');
    return toInstallation(updated);
  }

  try {
    const [created] = await database
      .insert(forgeInstallation)
      .values({
        id: globalThis.crypto.randomUUID(),
        organizationId: input.organizationId,
        provider,
        externalId: input.externalId,
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning();
    if (!created) throw new Error('The installation could not be attached');
    return toInstallation(created);
  } catch (error) {
    // A concurrent request attached it between the read above and this insert.
    if (isUniqueViolation(error)) throw new InstallationAlreadyAttachedError();
    throw error;
  }
}

/** The installations an organization has attached, oldest first. */
export async function listInstallations(
  database: InstallationDatabase,
  organizationId: string,
): Promise<InstallationRecord[]> {
  const rows = await database
    .select()
    .from(forgeInstallation)
    .where(eq(forgeInstallation.organizationId, organizationId))
    .orderBy(asc(forgeInstallation.createdAt));
  return rows.map(toInstallation);
}

/**
 * Record that the provider suspended or resumed an installation.
 *
 * Keyed by the provider's coordinates, not the row id, because the provider's webhook names an
 * installation by its own id. Returns whether a row was found: a webhook for an installation nobody
 * attached is expected and is not an error.
 */
export async function setInstallationSuspended(
  database: InstallationDatabase,
  provider: string,
  externalId: string,
  suspended: boolean,
): Promise<boolean> {
  const rows = await database
    .update(forgeInstallation)
    .set({ suspendedAt: suspended ? new Date() : null, updatedAt: new Date() })
    .where(
      and(eq(forgeInstallation.provider, provider), eq(forgeInstallation.externalId, externalId)),
    )
    .returning({ id: forgeInstallation.id });
  return rows.length > 0;
}

/**
 * Select repositories for an organization through one of its installations.
 *
 * The installation is looked up under the organization first, so an id belonging to someone else's
 * installation is indistinguishable from one that does not exist. A repository already selected has
 * its mode updated instead of being duplicated.
 */
export async function selectRepositories(
  database: InstallationDatabase,
  input: {
    organizationId: string;
    installationId: string;
    repositories: readonly RepositorySelection[];
  },
): Promise<OrganizationRepositoryRecord[]> {
  for (const repository of input.repositories) {
    const mode = repository.mode ?? 'observe';
    if (!isMode(mode))
      throw new Error('Unsupported repository mode: only observe and suggest are accepted');
  }

  const [installation] = await database
    .select()
    .from(forgeInstallation)
    .where(
      and(
        eq(forgeInstallation.id, input.installationId),
        eq(forgeInstallation.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!installation) throw new InstallationNotFoundError();

  const saved: OrganizationRepositoryRecord[] = [];
  for (const repository of input.repositories) {
    const mode = repository.mode ?? 'observe';
    const [row] = await database
      .insert(organizationRepository)
      .values({
        id: globalThis.crypto.randomUUID(),
        organizationId: input.organizationId,
        installationId: installation.id,
        provider: installation.provider,
        externalId: repository.externalId,
        owner: repository.owner,
        name: repository.name,
        mode,
      })
      .onConflictDoUpdate({
        target: [
          organizationRepository.organizationId,
          organizationRepository.provider,
          organizationRepository.owner,
          organizationRepository.name,
        ],
        set: { mode, externalId: repository.externalId, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error('The repository could not be selected');
    saved.push(toRepository(row));
  }
  return saved;
}

/** The repositories an organization selected, oldest first. */
export async function listOrganizationRepositories(
  database: InstallationDatabase,
  organizationId: string,
): Promise<OrganizationRepositoryRecord[]> {
  const rows = await database
    .select()
    .from(organizationRepository)
    .where(eq(organizationRepository.organizationId, organizationId))
    .orderBy(asc(organizationRepository.createdAt));
  return rows.map(toRepository);
}

/** Remove a selected repository, only from the organization that holds it. */
export async function removeOrganizationRepository(
  database: InstallationDatabase,
  organizationId: string,
  id: string,
): Promise<boolean> {
  const rows = await database
    .delete(organizationRepository)
    .where(
      and(
        eq(organizationRepository.id, id),
        eq(organizationRepository.organizationId, organizationId),
      ),
    )
    .returning({ id: organizationRepository.id });
  return rows.length > 0;
}

function toInstallation(row: typeof forgeInstallation.$inferSelect): InstallationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    externalId: row.externalId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    suspended: row.suspendedAt !== null,
  };
}

function toRepository(
  row: typeof organizationRepository.$inferSelect,
): OrganizationRepositoryRecord {
  if (!isMode(row.mode)) throw new Error(`Stored repository has an unsupported mode: ${row.mode}`);
  return {
    id: row.id,
    organizationId: row.organizationId,
    installationId: row.installationId,
    provider: row.provider,
    externalId: row.externalId,
    owner: row.owner,
    name: row.name,
    mode: row.mode,
  };
}

/** Postgres reports a unique violation as SQLSTATE 23505, on the error or on its `cause`. */
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error; typeof current === 'object' && current !== null;) {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
