import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access';

/**
 * Organization access control: what each organization role may do inside one organization.
 *
 * Kept in its own entry point and free of any database or server import, so the dashboard can
 * load the same roles into the organization client plugin and ask "may I?" before rendering a
 * button, with the server still enforcing the answer.
 *
 * The statements are Better Auth's own organization statements extended with Code Zero's. The
 * built-in ones cannot be dropped: the organization plugin checks `organization`, `member`,
 * `invitation`, and `team` permissions on its own endpoints, Better Enrollment checks
 * `invitation: ["create"]` before an organization invites into itself, and the API-key plugin
 * checks `apiKey` with its own CRUD verbs. So two vocabularies share a resource where they meet:
 * `member` carries the plugin's `create`/`update`/`delete` beside Code Zero's `invite`/`remove`,
 * and `apiKey` carries the plugin's `read`/`update`/`delete` beside `create`/`revoke`. Every role
 * below grants them in step — a role that may `invite` may also create an invitation, and one
 * that may `revoke` a key may also delete it — so either vocabulary gives the same answer.
 */
export const statements = {
  ...defaultStatements,
  member: [...defaultStatements.member, 'invite', 'remove'],
  repository: ['read', 'write', 'configure'],
  task: ['create', 'approve', 'cancel'],
  policy: ['write'],
  billing: ['manage'],
  apiKey: ['create', 'read', 'update', 'delete', 'revoke'],
} as const;

export const accessControl = createAccessControl(statements);

/**
 * Members run work and read what it found. They cannot approve a write, change policy, or manage
 * anyone else, which is what keeps `observe` the effective default for the role most accounts hold.
 */
export const member = accessControl.newRole({
  ...memberAc.statements,
  repository: ['read'],
  task: ['create'],
});

/**
 * Admins run the organization day to day: repositories, approvals, policy, members, and keys. They
 * cannot manage billing or delete the organization, which stay with its owners.
 */
export const admin = accessControl.newRole({
  ...adminAc.statements,
  member: [...adminAc.statements.member, 'invite', 'remove'],
  repository: ['read', 'write', 'configure'],
  task: ['create', 'approve', 'cancel'],
  policy: ['write'],
  apiKey: ['create', 'read', 'update', 'delete', 'revoke'],
});

/** Owners hold every permission, billing and deletion of the organization included. */
export const owner = accessControl.newRole({
  ...ownerAc.statements,
  member: [...ownerAc.statements.member, 'invite', 'remove'],
  repository: ['read', 'write', 'configure'],
  task: ['create', 'approve', 'cancel'],
  policy: ['write'],
  billing: ['manage'],
  apiKey: ['create', 'read', 'update', 'delete', 'revoke'],
});

/** The organization roles, keyed by the name stored in `member.role`. */
export const organizationRoles = { owner, admin, member };

/** A role name an organization membership may hold. */
export type OrganizationRoleName = keyof typeof organizationRoles;
