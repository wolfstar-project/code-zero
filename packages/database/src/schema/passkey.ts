import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { user } from './auth.js';

/**
 * The table `@better-auth/passkey` owns: one row per WebAuthn credential an account registered.
 *
 * Carries `createdAt` alone, like `invite_use`: the plugin declares no `updatedAt`, and a column the
 * adapter does not know about would stay at its default forever. The counter it does update is the
 * credential's own signature counter, not a row timestamp.
 */
export const passkey = pgTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    /** A label the account holder chose, so they can tell two security keys apart. */
    name: text('name'),
    /** The credential's public key. Public by construction: the private half never leaves the authenticator. */
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * The credential id the authenticator presents on every assertion. Unique, because a sign-in is
     * resolved by it alone: two rows sharing one would let one credential answer for two accounts.
     */
    credentialID: text('credential_id').notNull(),
    /** The authenticator's signature counter, which detects a cloned credential when it goes backwards. */
    counter: integer('counter').notNull(),
    /** `singleDevice` or `multiDevice` (a synced passkey). */
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    /** Comma-separated transports (`usb`, `nfc`, `ble`, `internal`, `hybrid`) the browser reported. */
    transports: text('transports'),
    /** The authenticator model's identifier, when it disclosed one. */
    aaguid: text('aaguid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('passkey_user_id_idx').on(table.userId),
    uniqueIndex('passkey_credential_id_unique').on(table.credentialID),
  ],
);
