/**
 * The organization shapes the dashboard renders.
 *
 * Declared here rather than imported from `@code-zero/auth`: that package pulls Better Auth and
 * its database adapter, which must not reach a browser bundle. These mirror the fields the client
 * plugin returns, narrowed to what the UI actually reads.
 */

/** Roles the invitation and member views can assign. */
export const ORGANIZATION_ROLES = ['member', 'admin', 'owner'] as const;

/**
 * The error code the auth server refuses an organization invitation with when the deployment has
 * no way to deliver it. Mirrors `ORGANIZATION_INVITATION_DELIVERY_UNAVAILABLE` in
 * `@code-zero/auth`, for the same reason the shapes above are mirrored rather than imported.
 */
export const INVITATION_DELIVERY_UNAVAILABLE = 'INVITATION_DELIVERY_UNAVAILABLE';

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
