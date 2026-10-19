import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { user } from './auth.js';

/**
 * The tables `@better-auth/scim` owns, in its managed-connection configuration.
 *
 * Migrated on every deployment, but only written where the Enterprise `scim` entitlement registers
 * the plugin. The set is fixed by the plugin rather than chosen here: the connection catalog
 * (`scim_managed_*`) holds the per-organization provisioning connections and their bearer
 * credentials, and the remaining tables are the directory state a provisioning client pushes in
 * (users, groups, memberships, the role grants projected from them, and the tombstones that keep a
 * deleted external id from being silently re-linked).
 *
 * Field names follow the plugin's model fields exactly; the `*_key` columns are the plugin's own
 * normalized uniqueness keys and are what makes each upsert a single guarded write. No table
 * carries the shared `timestampColumns`: the plugin writes its own `created_at`/`updated_at`
 * where it declares them, and a column it does not know about would stay at its default forever.
 */

export const scimManagedConnection = pgTable(
  'scim_managed_connection',
  {
    id: text('id').primaryKey(),
    creationRequestId: text('creation_request_id').notNull().unique(),
    connectionId: text('connection_id').notNull().unique(),
    provisioningDomainId: text('provisioning_domain_id').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by').notNull(),
    decommissionStartedAt: timestamp('decommission_started_at', { withTimezone: true }),
    decommissionStartedBy: text('decommission_started_by'),
    decommissionedAt: timestamp('decommissioned_at', { withTimezone: true }),
    decommissionedBy: text('decommissioned_by'),
  },
  (table) => [
    index('scim_managed_connection_provisioning_domain_id_idx').on(table.provisioningDomainId),
  ],
);

export const scimManagedCredential = pgTable(
  'scim_managed_credential',
  {
    id: text('id').primaryKey(),
    connectionRecordId: text('connection_record_id')
      .notNull()
      .references(() => scimManagedConnection.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    /** An HMAC of the bearer token under the deployment's SCIM credential secret, never the token. */
    tokenDigest: text('token_digest').notNull(),
    hashVersion: text('hash_version').notNull(),
    activeSlotKey: text('active_slot_key').notNull().unique(),
    status: text('status').notNull(),
    serializedScopes: text('serialized_scopes').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    decommissionedAt: timestamp('decommissioned_at', { withTimezone: true }),
  },
  (table) => [
    index('scim_managed_credential_connection_record_id_idx').on(table.connectionRecordId),
  ],
);

export const scimManagedConnectionEvent = pgTable(
  'scim_managed_connection_event',
  {
    id: text('id').primaryKey(),
    connectionRecordId: text('connection_record_id')
      .notNull()
      .references(() => scimManagedConnection.id, { onDelete: 'cascade' }),
    eventKey: text('event_key').notNull().unique(),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    actorId: text('actor_id').notNull(),
    credentialId: text('credential_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('scim_managed_connection_event_connection_record_id_idx').on(table.connectionRecordId),
  ],
);

export const scimConnectionBinding = pgTable(
  'scim_connection_binding',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    connectionKey: text('connection_key').notNull().unique(),
    provisioningDomainId: text('provisioning_domain_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    decommissionedAt: timestamp('decommissioned_at', { withTimezone: true }),
    decommissionStatus: text('decommission_status').notNull().default('active'),
    decommissionCursorUserId: text('decommission_cursor_user_id'),
    decommissionReconciledUserCount: integer('decommission_reconciled_user_count')
      .notNull()
      .default(0),
    decommissionBatchCount: integer('decommission_batch_count').notNull().default(0),
    decommissionRevision: integer('decommission_revision').notNull().default(0),
    decommissionCompletedAt: timestamp('decommission_completed_at', { withTimezone: true }),
    decommissionLeaseId: text('decommission_lease_id'),
    decommissionLeaseExpiresAt: timestamp('decommission_lease_expires_at', { withTimezone: true }),
  },
  (table) => [index('scim_connection_binding_connection_id_idx').on(table.connectionId)],
);

export const scimIdentityTombstone = pgTable(
  'scim_identity_tombstone',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    provisioningDomainId: text('provisioning_domain_id').notNull(),
    externalId: text('external_id').notNull(),
    externalIdKey: text('external_id_key').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    profile: text('profile').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('scim_identity_tombstone_connection_id_idx').on(table.connectionId),
    index('scim_identity_tombstone_provisioning_domain_id_idx').on(table.provisioningDomainId),
    index('scim_identity_tombstone_user_id_idx').on(table.userId),
  ],
);

export const scimSubject = pgTable(
  'scim_subject',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    profileSourceId: text('profile_source_id'),
    revision: integer('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('scim_subject_profile_source_id_idx').on(table.profileSourceId)],
);

export const scimUser = pgTable(
  'scim_user',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    provisioningDomainId: text('provisioning_domain_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectionUserKey: text('connection_user_key').notNull().unique(),
    userName: text('user_name').notNull(),
    userNameKey: text('user_name_key').notNull().unique(),
    primaryEmail: text('primary_email').notNull(),
    workEmailValueIndex: text('work_email_value_index').notNull(),
    emailValueIndex: text('email_value_index').notNull(),
    displayName: text('display_name').notNull(),
    formattedName: text('formatted_name').notNull(),
    givenName: text('given_name'),
    familyName: text('family_name'),
    serializedEmails: text('serialized_emails').notNull(),
    serializedAttributes: text('serialized_attributes'),
    externalId: text('external_id'),
    externalIdKey: text('external_id_key').unique(),
    active: boolean('active').notNull(),
    orderKey: text('order_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('scim_user_connection_id_idx').on(table.connectionId),
    index('scim_user_provisioning_domain_id_idx').on(table.provisioningDomainId),
    index('scim_user_user_id_idx').on(table.userId),
  ],
);

export const scimProjectionGrant = pgTable(
  'scim_projection_grant',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    provisioningDomainId: text('provisioning_domain_id').notNull(),
    scimUserId: text('scim_user_id')
      .notNull()
      .references(() => scimUser.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sourceKind: text('source_kind').notNull(),
    sourceId: text('source_id').notNull(),
    sourceValue: text('source_value'),
    role: text('role').notNull(),
    grantKey: text('grant_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('scim_projection_grant_connection_id_idx').on(table.connectionId),
    index('scim_projection_grant_provisioning_domain_id_idx').on(table.provisioningDomainId),
    index('scim_projection_grant_scim_user_id_idx').on(table.scimUserId),
    index('scim_projection_grant_user_id_idx').on(table.userId),
  ],
);

export const scimGroup = pgTable(
  'scim_group',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    provisioningDomainId: text('provisioning_domain_id').notNull(),
    revision: integer('revision').notNull().default(0),
    displayName: text('display_name').notNull(),
    displayNameKey: text('display_name_key').notNull().unique(),
    externalId: text('external_id'),
    externalIdKey: text('external_id_key').unique(),
    orderKey: text('order_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('scim_group_connection_id_idx').on(table.connectionId),
    index('scim_group_provisioning_domain_id_idx').on(table.provisioningDomainId),
  ],
);

export const scimGroupMember = pgTable(
  'scim_group_member',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    groupId: text('group_id')
      .notNull()
      .references(() => scimGroup.id, { onDelete: 'cascade' }),
    scimUserId: text('scim_user_id')
      .notNull()
      .references(() => scimUser.id, { onDelete: 'cascade' }),
    membershipKey: text('membership_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('scim_group_member_connection_id_idx').on(table.connectionId),
    index('scim_group_member_group_id_idx').on(table.groupId),
    index('scim_group_member_scim_user_id_idx').on(table.scimUserId),
  ],
);
