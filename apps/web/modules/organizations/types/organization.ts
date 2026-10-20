/**
 * The organization shapes the dashboard renders.
 *
 * Declared here rather than imported from `@code-zero/auth`: that package pulls Better Auth and
 * its database adapter, which must not reach a browser bundle. These mirror the fields the client
 * plugin returns, narrowed to what the UI actually reads.
 */

/**
 * Roles an invitation can grant. `owner` is not one of them: ownership is handed over by an owner
 * from the member list, never granted to an address by whoever holds the invite permission.
 */
export const ORGANIZATION_ROLES = ['member', 'admin'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo?: string | null;
}

export interface OrganizationMember {
  readonly id: string;
  readonly role: string;
  readonly user: {
    readonly name: string;
    readonly email: string;
  };
}
