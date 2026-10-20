import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { timestampColumns } from './columns.js';

/**
 * Tables the Better Enrollment plugin owns.
 *
 * Kept in their own file for the same reason `organization.ts` is: the plugin is optional policy
 * (`AUTH_ENABLE_INVITATIONS`), so a deployment that never turns invitations on still migrates
 * these tables but never writes to them. The same column-naming constraint as `auth.ts` applies —
 * the adapter maps model fields by name.
 *
 * The store deliberately carries no foreign key on `organizationId`, `teamId`, `createdByUserId`,
 * `preCreatedUserId`, or `revokedByUserId`. A redeemed invitation is a permanent audit record of
 * who let whom in, and it has to survive the deletion of the organization, team, or account it
 * names; `inviterName` and `inviterEmail` are denormalized onto the row for exactly that reason.
 * Only `inviteUse.inviteId` cascades, because a use is meaningless without the invite it belongs
 * to.
 */

export const invite = pgTable(
  'invite',
  {
    id: text('id').primaryKey(),
    /** `private` (bound to one email) or `public` (a shareable link with a use cap). */
    type: text('type').notNull(),
    /** `app`, `org-join`, or `org-create`: what the invitation grants. */
    kind: text('kind').notNull().default('app'),
    /** Set for private invites only; a public invite's accepter supplies their own address. */
    email: text('email'),
    name: text('name'),
    /** Application role granted on redemption, merged into `user.role` as a union. */
    role: text('role').notNull(),
    /**
     * SHA-256 of the invitation token. The token itself is never stored, so a dump of this table
     * cannot be turned back into a working invitation link.
     */
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('pending'),
    /** Which mode the invitation was created under: `invite-only` or `open`. */
    mode: text('mode').notNull(),
    organizationId: text('organization_id'),
    organizationRole: text('organization_role'),
    teamId: text('team_id'),
    /** `org-create`: the seat limit applied to the organization the invitee founds. */
    presetSeatLimit: integer('preset_seat_limit'),
    /**
     * The inert, unverified account a private invite pre-creates. Its existence is what locks the
     * invited address on every sign-in, sign-up, reset, and OAuth path while the invite is pending.
     */
    preCreatedUserId: text('pre_created_user_id'),
    /** Null when the invitation was minted by the server-only system endpoint. */
    createdByUserId: text('created_by_user_id'),
    inviterName: text('inviter_name').notNull(),
    inviterEmail: text('inviter_email').notNull(),
    /** Null means the invitation never expires. Expiry is derived at read time, never swept. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Null means unlimited uses; private invites are always exactly one. */
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: text('revoked_by_user_id'),
    ...timestampColumns,
  },
  (table) => [
    // Redemption looks an invitation up by the hash of the presented token, and two invitations
    // must never share one: the uniqueness is what makes redemption a single guarded write rather
    // than a choice between rows.
    uniqueIndex('invite_token_hash_unique').on(table.tokenHash),
    // A pending private invite is looked up by address on every sign-in, sign-up, and password
    // reset, so this index is on the hot path of the email lock, not just of the admin list.
    index('invite_email_idx').on(table.email),
    index('invite_status_idx').on(table.status),
    index('invite_organization_id_idx').on(table.organizationId),
    // The plugin resolves a pending private invite from the inert account it pre-created, which is
    // how the email lock recognises that account on every sign-in path.
    index('invite_pre_created_user_id_idx').on(table.preCreatedUserId),
    index('invite_created_by_user_id_idx').on(table.createdByUserId),
    index('invite_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * One row per redemption, appended and never updated.
 *
 * Carries `usedAt` alone rather than the shared {@link timestampColumns}: a use is a point-in-time
 * fact, so a mutable `updated_at` would suggest an audit record can be rewritten. The plugin does
 * not declare one either, and a column the adapter does not know about would stay at its default
 * forever.
 */
export const inviteUse = pgTable(
  'invite_use',
  {
    id: text('id').primaryKey(),
    inviteId: text('invite_id')
      .notNull()
      .references(() => invite.id, { onDelete: 'cascade' }),
    usedByUserId: text('used_by_user_id').notNull(),
    /** The address as it was redeemed, which for a public invite the accepter typed themselves. */
    inviteeEmail: text('invitee_email').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('invite_use_invite_id_idx').on(table.inviteId)],
);
