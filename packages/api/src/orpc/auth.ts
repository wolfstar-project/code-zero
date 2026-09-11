import { ORPCError, os } from '@orpc/server';
import type { RequestHeadersHandlerPluginContext } from '@orpc/server/plugins';
import type { Session, User } from 'better-auth';

import { sessionPrincipal, type Principal } from '../access.js';

/**
 * The one Better Auth endpoint this integration calls, declared structurally.
 *
 * Typed against `better-auth`'s own `Session`/`User` rather than a hand-rolled shape, but never
 * against a concrete instance: building one needs a database adapter and the deployment's
 * authentication policy, both of which live in `@code-zero/auth`. This package holds the
 * control-plane router and must not reach persistence or policy, so the composition root
 * (`apps/dashboard/server/`) constructs the instance and passes it in through the oRPC context.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | oRPC — Better Auth integration}
 */
export interface BetterAuthSessionApi {
  api: {
    getSession: (options: { headers: Headers }) => Promise<BetterAuthSessionPayload | null>;
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
  session: Pick<Session, 'id'>;
  /** `role` is an additional field the deployment adds, so it is absent from Better Auth's `User`. */
  user: Pick<User, 'id' | 'email'> & { readonly role?: unknown };
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
  /** App-wide role granted the writable execution modes. Defaults to {@link DEFAULT_ADMIN_ROLE}. */
  adminRole?: string;
}

/** App-wide role that grants a signed-in user the writable execution modes. */
const DEFAULT_ADMIN_ROLE = 'admin';

/**
 * Better Auth's base `User` carries no `role`; the deployment adds it as an additional field (see
 * `@code-zero/auth`'s `authBetterAuthOptions`). Read defensively rather than asserted, so a
 * deployment that drops the field grants the non-writable modes instead of throwing.
 *
 * Better Auth stores multiple roles as one comma-separated string, so membership is checked
 * rather than equality: an account provisioned with, say, `"support,admin"` holds the admin role
 * exactly as much as one provisioned with `"admin"` alone.
 */
function isAdministrator(user: BetterAuthSessionPayload['user'], adminRole: string): boolean {
  if (typeof user.role !== 'string') return false;
  return user.role
    .split(',')
    .map((role) => role.trim())
    .includes(adminRole);
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
  const { user } = sessionData;
  // The email is the identity an operator recognises in an audit trail; the immutable user id is
  // the fallback so a deployment that leaves it blank still records something resolvable.
  const name = user.email.trim() === '' ? user.id : user.email;
  return sessionPrincipal(name, isAdministrator(user, context.adminRole ?? DEFAULT_ADMIN_ROLE));
}

/**
 * Requires an authenticated caller: a static operator token, or a Better Auth dashboard session.
 *
 * @see {@link https://orpc.dev/docs/integrations/better-auth | oRPC — Better Auth integration}
 */
export const authMiddleware = os
  .$context<BetterAuthContext>()
  .middleware(async ({ context, next }) => {
    const principal = context.principal ?? (await betterAuthPrincipal(context));
    if (!principal) throw new ORPCError('UNAUTHORIZED', { message: 'Authentication required' });
    return next({ context: { principal } });
  });
