import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { timestampColumns } from './columns.js';
import { organization } from './organization.js';

/**
 * The deployment's settings, when the dashboard is their source.
 *
 * One row at most: a deployment has one set of settings, so the primary key is pinned to a single
 * value and a second row cannot exist to disagree with the first. The document is the same YAML
 * shape the deployment file holds, stored as JSON; this package keeps it opaque, and
 * `@code-zero/config` validates it on every write and every read, so a row edited by hand is
 * refused rather than trusted.
 *
 * Deliberately absent from the `schema` object Better Auth resolves models against: nothing about
 * authentication reads or writes it.
 */
export const deploymentSetting = pgTable(
  'deployment_setting',
  {
    id: text('id').primaryKey(),
    document: jsonb('document').notNull(),
    /** Who saved this version, as the audit trail names them. */
    updatedBy: text('updated_by').notNull(),
    ...timestampColumns,
  },
  (table) => [check('deployment_setting_singleton', sql`${table.id} = 'deployment'`)],
);

/**
 * The stricter limits an organization chose for its own work on the managed cloud.
 *
 * Keyed by the organization and removed with it. Only ever lower than the plan when written; the
 * reader still takes the minimum, because the plan can be lowered after a row was saved.
 */
export const organizationSetting = pgTable('organization_setting', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  document: jsonb('document').notNull(),
  updatedBy: text('updated_by').notNull(),
  ...timestampColumns,
});
