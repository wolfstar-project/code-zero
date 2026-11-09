import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { user } from './auth.js';
import { timestampColumns } from './columns.js';
import { organization } from './organization.js';

/**
 * A source-control installation attached to one organization: the GitHub App installed on a user or
 * an organization account, as the managed cloud sees it.
 *
 * This is the cloud's counterpart to `repository`, which describes checkouts on a host. A cloud
 * deployment has no checkout, so what a customer connects is an installation, and what it may act
 * on is whatever the installation grants.
 *
 * No credential lives here. An installation token is minted per request from the app's own key,
 * which is a deployment secret; the row only records which installation belongs to which
 * organization.
 */
export const forgeInstallation = pgTable(
  'forge_installation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Which provider `externalId` is an installation of. Only `github` exists today. */
    provider: text('provider').notNull().default('github'),
    /** The provider's installation id, kept as text so a provider with another id shape fits. */
    externalId: text('external_id').notNull(),
    /** The user or organization account the app is installed on, as the provider names it. */
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    /**
     * Who attached it. Kept when the account is deleted so the trail survives, but no longer
     * names anyone.
     */
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    /** Set while the provider reports the installation suspended; null while it is active. */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    // An installation belongs to exactly one organization. The database enforces it, because two
    // requests that each checked first would otherwise both attach the same installation.
    uniqueIndex('forge_installation_provider_external_unique').on(table.provider, table.externalId),
    index('forge_installation_organization_idx').on(table.organizationId),
  ],
);

/**
 * A repository an organization chose to have Code Zero watch, reached through one installation.
 *
 * `owner` and `name` are the provider coordinates, refreshed whenever the repository is selected
 * again. `externalId` is the provider's own repository id and is what identifies the row, so a
 * rename on the provider updates it instead of adding a second entry for the same repository.
 */
export const organizationRepository = pgTable(
  'organization_repository',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    installationId: text('installation_id')
      .notNull()
      .references(() => forgeInstallation.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('github'),
    externalId: text('external_id').notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    /**
     * The execution mode un-requested work runs under. Only the two non-writable modes are
     * accepted, checked where rows are written, as `repository.mode` is.
     */
    mode: text('mode').notNull().default('observe'),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('organization_repository_external_unique').on(
      table.organizationId,
      table.provider,
      table.externalId,
    ),
    index('organization_repository_installation_idx').on(table.installationId),
  ],
);
