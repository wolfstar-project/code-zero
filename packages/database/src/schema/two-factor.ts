import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { user } from './auth.js';
import { timestampColumns } from './columns.js';

/**
 * The table Better Auth's two-factor plugin owns: one TOTP enrollment per account.
 *
 * Kept beside the other plugin tables rather than in `auth.ts` for the same reason `device.ts` is:
 * it belongs to one plugin, and a reader looking for what that plugin stores finds it in one file.
 * The plugin is registered on every deployment, but a row exists only for an account that started
 * enrollment, and `user.two_factor_enabled` stays false until that enrollment is verified.
 */
export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    /**
     * The TOTP seed, encrypted with the deployment's auth secret before it reaches this column, so
     * a dump of the table alone cannot mint codes.
     */
    secret: text('secret').notNull(),
    /** The one-time recovery codes, encrypted the same way and consumed one by one. */
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      // A deleted account must not leave a second factor behind for whoever reuses its address.
      .references(() => user.id, { onDelete: 'cascade' }),
    /** False while an enrollment awaits its first code; the plugin writes true once it verifies. */
    verified: boolean('verified').notNull().default(true),
    /** Consecutive failed challenges, which the plugin's lockout counts against. */
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    /** Set while the account is locked out of the challenge after too many failures. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    index('two_factor_secret_idx').on(table.secret),
    index('two_factor_user_id_idx').on(table.userId),
  ],
);
