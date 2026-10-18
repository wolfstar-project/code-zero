import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { user } from './auth.js';
import { organization } from './organization.js';

/**
 * The table `@better-auth/sso` owns: one row per identity provider an organization connected.
 *
 * Migrated on every deployment, but only written where the Enterprise `sso` entitlement registers
 * the plugin at all. The provider configuration columns hold JSON documents the plugin encodes
 * itself; an OIDC client secret inside `oidc_config` is the reason this table must never be
 * exported verbatim.
 */
export const ssoProvider = pgTable(
  'sso_provider',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    /** JSON-encoded OIDC settings, client secret included. */
    oidcConfig: text('oidc_config'),
    /** JSON-encoded SAML settings. */
    samlConfig: text('saml_config'),
    /** The account that registered the provider. */
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    /** The identifier sign-in requests name the provider by. */
    providerId: text('provider_id').notNull(),
    /**
     * The organization the provider signs members into. Cascades: a provider must not keep
     * admitting people into an organization that no longer exists.
     */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    /** The email domain routed to this provider. */
    domain: text('domain').notNull(),
    /** Whether the domain's ownership was proven, which domain verification requires before routing. */
    domainVerified: boolean('domain_verified').notNull().default(false),
  },
  (table) => [
    uniqueIndex('sso_provider_provider_id_unique').on(table.providerId),
    index('sso_provider_organization_id_idx').on(table.organizationId),
    index('sso_provider_domain_idx').on(table.domain),
  ],
);
