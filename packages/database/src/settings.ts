import { and, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import type { Schema } from './schema/index.js';
import { member } from './schema/organization.js';
import { deploymentSetting, organizationSetting } from './schema/settings.js';

/**
 * Any Drizzle Postgres client opened on this package's schema.
 *
 * The deployment passes its `postgres-js` client (`Database`); the tests pass an in-memory PGlite
 * one, which speaks the same query builder. Typed by what the queries below use rather than by one
 * driver, so neither caller has to pretend to be the other.
 */
type SettingsDatabase = PgDatabase<PgQueryResultHKT, Schema>;

/** The one key the deployment's settings row is stored under. */
const DEPLOYMENT_SETTINGS_ID = 'deployment';

/**
 * A stored settings document and who saved it.
 *
 * The document stays `unknown` here: this package stores what it is given and returns what it
 * holds. Deciding whether a document is valid is `@code-zero/config`'s job, and its caller asks on
 * every read, so a row written by hand cannot reach a run unchecked.
 */
export interface StoredSettings {
  document: unknown;
  updatedBy: string;
  updatedAt: Date;
}

/** The deployment's stored settings, or null when the dashboard has never saved any. */
export async function readDeploymentSettings(
  database: SettingsDatabase,
): Promise<StoredSettings | null> {
  const [row] = await database
    .select()
    .from(deploymentSetting)
    .where(eq(deploymentSetting.id, DEPLOYMENT_SETTINGS_ID))
    .limit(1);
  return row ? toStored(row) : null;
}

/** Replace the deployment's settings. The caller has already validated the document. */
export async function saveDeploymentSettings(
  database: SettingsDatabase,
  document: Record<string, unknown>,
  updatedBy: string,
): Promise<StoredSettings> {
  const updatedAt = new Date();
  const [row] = await database
    .insert(deploymentSetting)
    .values({ id: DEPLOYMENT_SETTINGS_ID, document, updatedBy, updatedAt })
    .onConflictDoUpdate({
      target: deploymentSetting.id,
      set: { document, updatedBy, updatedAt },
    })
    .returning();
  if (!row) throw new Error('The deployment settings could not be saved');
  return toStored(row);
}

/** An organization's stored limits, or null when it never chose any. */
export async function readOrganizationSettings(
  database: SettingsDatabase,
  organizationId: string,
): Promise<StoredSettings | null> {
  const [row] = await database
    .select()
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, organizationId))
    .limit(1);
  return row ? toStored(row) : null;
}

/** Replace an organization's limits. The caller has already checked the member and the plan. */
export async function saveOrganizationSettings(
  database: SettingsDatabase,
  organizationId: string,
  document: Record<string, unknown>,
  updatedBy: string,
): Promise<StoredSettings> {
  const updatedAt = new Date();
  const [row] = await database
    .insert(organizationSetting)
    .values({ organizationId, document, updatedBy, updatedAt })
    .onConflictDoUpdate({
      target: organizationSetting.organizationId,
      set: { document, updatedBy, updatedAt },
    })
    .returning();
  if (!row) throw new Error('The organization settings could not be saved');
  return toStored(row);
}

/**
 * The role an account holds in an organization, or null when it is not a member.
 *
 * Read from the membership table on every call rather than from the session: a session remembers
 * which organization it last acted in, not whether the account still belongs to it, so a removed
 * member's session must not keep answering for the organization.
 */
export async function organizationMemberRole(
  database: SettingsDatabase,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await database
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

function toStored(row: { document: unknown; updatedBy: string; updatedAt: Date }): StoredSettings {
  return { document: row.document, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}
