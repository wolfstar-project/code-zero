import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { timestampColumns } from './columns.js';

/**
 * Better Auth's core tables, declared in Drizzle so the session store is owned by this repository
 * rather than generated behind the library's own migration tool.
 *
 * Column names must match what Better Auth queries: the adapter maps model fields by name, so
 * renaming anything here silently breaks sign-in rather than failing at build time.
 */

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    /**
     * Application roles held by the account, as Better Auth stores them: one comma-separated
     * string, not a set. Nullable because an account can predate any role grant, and because a
     * private invitation pre-creates an inert row before redemption decides what it grants.
     *
     * Distinct from `member.role`, which scopes a role to a single organization. This column is
     * app-wide, and Better Auth's admin plugin is its authority: it decides which values grant
     * administration, and Better Enrollment merges invitation grants into the same string.
     */
    role: text('role'),
    /**
     * The authentication method this account most recently signed in with (`email`, `github`, …).
     *
     * Written by Better Auth's last-login-method plugin, which also mirrors the value into a
     * non-essential cookie. The column is the durable copy: the cookie is per-browser, so without
     * it a returning user on a new device is offered no hint about how they signed up. Nullable
     * because every account predates its first sign-in under this plugin.
     */
    lastLoginMethod: text('last_login_method'),
    /**
     * Set by Better Auth's two-factor plugin once the first authenticator code has verified a
     * pending enrollment, never at enrollment itself: an account that started setup and abandoned
     * it must still sign in with its password alone.
     */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    /**
     * Admin plugin: whether an administrator has banned the account. A banned account's sessions
     * are revoked and every new sign-in is refused until the ban is lifted or `banExpires` passes.
     */
    banned: boolean('banned').notNull().default(false),
    /** Admin plugin: the reason the ban was imposed with, shown to the administrators who list it. */
    banReason: text('ban_reason'),
    /** Admin plugin: when a temporary ban lapses. Null means the ban, if any, does not expire. */
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [uniqueIndex('user_email_unique').on(table.email)],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      // Signing out a deleted account must not leave a usable session behind.
      .references(() => user.id, { onDelete: 'cascade' }),
    // Which organization the session is currently acting in. Written by the organization plugin
    // when the user switches context; null means no organization is selected.
    activeOrganizationId: text('active_organization_id'),
    /**
     * Admin plugin: the administrator acting through this session when it was minted by
     * impersonation, null for every session the account holder signed in to themselves. It is what
     * makes an impersonated action attributable, so it cascades with the administrator's account
     * rather than outliving it as a session nobody answers for.
     */
    impersonatedBy: text('impersonated_by').references(() => user.id, { onDelete: 'cascade' }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('session_token_unique').on(table.token),
    index('session_user_id_idx').on(table.userId),
  ],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestampColumns,
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestampColumns,
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);
