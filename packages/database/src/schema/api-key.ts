import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { timestampColumns } from './columns.js';

/**
 * The table `@better-auth/api-key` owns: machine credentials for CI and the GitHub Action.
 *
 * Registered under the model name `apikey`, which is what the plugin resolves, while the SQL table
 * keeps the repository's snake-case convention.
 *
 * `reference_id` deliberately carries no foreign key. The plugin stores either a user id or an
 * organization id there depending on the key configuration (`config_id`) that minted the row, so a
 * constraint on one of the two tables would reject every key of the other kind.
 */
export const apiKey = pgTable(
  'api_key',
  {
    id: text('id').primaryKey(),
    /** Which key configuration minted the row, and therefore what `referenceId` points at. */
    configId: text('config_id').notNull().default('default'),
    name: text('name'),
    /** The first few characters of the key, prefix included, so a UI can tell keys apart. */
    start: text('start'),
    /** The organization (or user) that owns the key. */
    referenceId: text('reference_id').notNull(),
    /** The key's plaintext prefix (`cz_`). Not secret: it identifies the issuer, not the key. */
    prefix: text('prefix'),
    /**
     * A hash of the key, never the key itself. The plaintext is returned once, at creation, so a
     * dump of this table cannot be replayed against the API.
     */
    key: text('key').notNull(),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(true),
    /** Rate-limit window in milliseconds. */
    rateLimitTimeWindow: integer('rate_limit_time_window').default(86_400_000),
    rateLimitMax: integer('rate_limit_max').default(10),
    requestCount: integer('request_count').notNull().default(0),
    /** Uses left before the key stops verifying; null means unlimited. */
    remaining: integer('remaining'),
    lastRequest: timestamp('last_request', { withTimezone: true }),
    /** Null means the key never expires; the policy in `packages/auth` always sets one. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** JSON-encoded statements the key is limited to, in the access-control vocabulary. */
    permissions: text('permissions'),
    /** JSON-encoded metadata, when the configuration enables it. */
    metadata: text('metadata'),
    ...timestampColumns,
  },
  (table) => [
    index('api_key_config_id_idx').on(table.configId),
    index('api_key_reference_id_idx').on(table.referenceId),
    // Verification looks a presented key up by its hash alone, so two rows must never share one.
    uniqueIndex('api_key_key_unique').on(table.key),
  ],
);
