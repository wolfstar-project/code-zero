import { ORPCError, os } from '@orpc/server';
import type { RequestHeadersHandlerPluginContext } from '@orpc/server/plugins';
import type { Session, User } from 'better-auth';

import { apiKeyPrincipal, sessionPrincipal, type Principal } from '../access.js';

/**
 * The Better Auth endpoints this integration calls, declared structurally.
 *
 * Typed against `better-auth`'s own `Session`/`User` rather than a hand-rolled shape, but never
 * against a concrete instance: building one needs a database adapter and the deployment's
 * authentication policy, both of which live in `@code-zero/auth`. This package holds the
 * control-plane router and must not reach persistence or policy, so the composition root
 * (`apps/web/server/`) constructs the instance and passes it in through the oRPC context.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | oRPC — Better Auth integration}
 */
export interface BetterAuthSessionApi {
  api: {
    getSession: (options: { headers: Headers }) => Promise<BetterAuthSessionPayload | null>;
    /**
     * The admin plugin's permission check, which decides who administers the deployment.
     *
     * Optional in the type because the composition root widens its plugin list, so a real
     * instance does not carry the plugin's endpoints in its static type even though it serves
     * them. At runtime an instance without it grants no one the administrator modes.
     */
    userHasPermission?: (options: {
      body: {
        userId: string;
        role?: string;
        permissions: Readonly<Record<string, readonly string[]>>;
      };
    }) => Promise<{ success: boolean }>;
  };
}

/**
 * The fields this integration reads from a resolved session, and nothing more.
 *
 * Narrowed from Better Auth's full `Session`/`User` on purpose: a real instance satisfies this
 * structurally, while a test double does not have to fabricate the dozens of fields the mapping
 * below never looks at.
 */
interface BetterAuthSessionPayload {
  /** `activeOrganizationId` is the organization plugin's field, absent while it is off. */
  session: Pick<Session, 'id'> & { readonly activeOrganizationId?: string | null };
  /** `role` is the admin plugin's field, so it is absent from Better Auth's base `User`. */
  user: Pick<User, 'id' | 'email'> & { readonly role?: unknown };
}

/**
 * Better Auth's API-key verification, declared structurally for the same reason as
 * {@link BetterAuthSessionApi}.
 *
 * The plugin's `verifyApiKey` is server-only and enforces everything a key carries besides its
 * permissions: that it exists, is enabled, has not expired, has uses left, and is within its rate
 * limit. Kept apart from {@link BetterAuthSessionApi} because the two are offered to different
 * transports: `/api/v1/**` verifies keys but must never honour a session cookie.
 */
export interface ApiKeyVerifier {
  verifyApiKey: (options: { body: { key: string } }) => Promise<{
    valid: boolean;
    key: {
      id: string;
      referenceId: string;
      permissions?: Readonly<Record<string, readonly string[]>> | null;
    } | null;
  }>;
}

/**
 * Context the authentication middleware reads.
 *
 * `reqHeaders` is injected by `RequestHeadersHandlerPlugin`, which every transport that wants
 * session authentication must carry — it is the documented way to reach request headers from a
 * procedure without leaking the transport's own request object into this package.
 */
export interface BetterAuthContext extends RequestHeadersHandlerPluginContext {
  /**
   * Better Auth instance backing dashboard sessions. Absent on transports that accept operator
   * tokens only, which leaves {@link BetterAuthContext.principal} the sole identity source there.
   */
  auth?: BetterAuthSessionApi;
  /**
   * Principal the transport already resolved from a static operator token.
   *
   * Checked first: it is a constant-time header comparison, whereas a session costs a lookup in
   * the authentication store, so a machine caller never pays for one.
   */
  principal?: Principal;
  /**
   * An organization API key the transport found in the `Authorization` header and did not match
   * against an operator token. Verified lazily, like a session, so only a procedure that needs an
   * identity pays for the lookup.
   */
  presentedApiKey?: string;
  /** Verifies {@link BetterAuthContext.presentedApiKey}. Absent where keys are not enabled. */
  apiKeys?: ApiKeyVerifier;
}

/**
 * The permission that makes an account an administrator of the deployment.
 *
 * Granting roles is the one permission that implies every other: an account that may set roles
 * can make itself anything. Asking for it, rather than for a role name, leaves the admin plugin
 * the only place that decides what administration is — its `adminRoles`, its access control, and
 * its `adminUserIds` — instead of this package parsing `user.role` against a second list.
 */
const ADMINISTRATION_PERMISSION = { user: ['set-role'] } as const;

/**
 * Ask Better Auth's admin plugin whether `user` administers the deployment.
 *
 * Passes the role the session already carried, so the check costs no further lookup; the plugin
 * still resolves what that role means. Fails closed: an instance without the plugin, or a check
 * that throws, grants the non-writable modes rather than the writable ones.
 */
async function isAdministrator(
  auth: BetterAuthSessionApi,
  user: BetterAuthSessionPayload['user'],
): Promise<boolean> {
  const check = auth.api.userHasPermission;
  if (!check) return false;
  try {
    const { success } = await check({
      body: {
        userId: user.id,
        ...(typeof user.role === 'string' ? { role: user.role } : {}),
        permissions: ADMINISTRATION_PERMISSION,
      },
    });
    return success;
  } catch {
    return false;
  }
}

/**
 * Resolve a dashboard session into a {@link Principal}, or `undefined` when there is none.
 *
 * Exported for the transports that want the identity outside a procedure (request logging, for
 * instance); procedures reach it through {@link authMiddleware}.
 */
export async function betterAuthPrincipal(
  context: BetterAuthContext,
): Promise<Principal | undefined> {
  const { auth, reqHeaders } = context;
  if (!auth || !reqHeaders) return undefined;
  const sessionData = await auth.api.getSession({ headers: reqHeaders });
  if (!sessionData?.session || !sessionData.user) return undefined;
  const { session, user } = sessionData;
  // The email is the identity an operator recognises in an audit trail; the immutable user id is
  // the fallback so a deployment that leaves it blank still records something resolvable.
  const name = user.email.trim() === '' ? user.id : user.email;
  return sessionPrincipal(name, await isAdministrator(auth, user), {
    userId: user.id,
    activeOrganizationId: session.activeOrganizationId ?? null,
  });
}

/**
 * Resolve a presented organization API key into a {@link Principal}.
 *
 * Returns `undefined` when none was presented, and `null` when one was presented and refused:
 * the caller chose that credential, so a failure must not fall back to whatever session cookie
 * happens to ride along. A verifier that throws refuses the key, as does a deployment without one.
 */
async function apiKeyPrincipalFrom(
  context: BetterAuthContext,
): Promise<Principal | null | undefined> {
  const { presentedApiKey, apiKeys } = context;
  if (presentedApiKey === undefined) return undefined;
  if (!apiKeys) return null;
  try {
    const { valid, key } = await apiKeys.verifyApiKey({ body: { key: presentedApiKey } });
    if (!valid || !key) return null;
    // The key id is what an organization sees in its key list and revokes by, and the reference
    // is the organization that owns it, so the trail names something an operator can act on.
    return apiKeyPrincipal(
      `api-key:${key.id}@${key.referenceId}`,
      key.permissions,
      key.referenceId,
    );
  } catch {
    return null;
  }
}

/**
 * Requires an authenticated caller: a static operator token, an organization API key, or a Better
 * Auth dashboard session.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | oRPC — Better Auth integration}
 */
export const authMiddleware = os
  .$context<BetterAuthContext>()
  .middleware(async ({ context, next }) => {
    const fromKey = context.principal ? undefined : await apiKeyPrincipalFrom(context);
    const principal =
      context.principal ?? (fromKey === undefined ? await betterAuthPrincipal(context) : fromKey);
    if (!principal) throw new ORPCError('UNAUTHORIZED', { message: 'Authentication required' });
    return next({ context: { principal } });
  });
