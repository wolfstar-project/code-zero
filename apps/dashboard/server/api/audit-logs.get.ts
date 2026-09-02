import { ADMIN_USER_ROLE } from '@code-zero/auth/config';

/**
 * The dashboard's read side of the audit trail, for signed-in administrators only.
 *
 * Deliberately a Nitro route rather than an oRPC procedure. Reads on `rpcRouter` are open by
 * design and CORS-exposed under `/api/v1/**`, and the router authenticates operator tokens, not
 * the browser session a dashboard user actually carries — an audit procedure there would either
 * be world-readable or unreachable from the page. A same-origin route behind the Better Auth
 * cookie is the narrowest guard available, and it keeps the trail out of the public REST surface.
 */
export default defineEventHandler(async (event) => {
  // Raises 401 when the request carries no session.
  const session = await requireUserSession(event);
  if (!rolesOf(session.user).includes(ADMIN_USER_ROLE))
    throw errors.forbidden('Reading the audit log requires the admin role');

  const query = getQuery(event);
  // A repeated query parameter arrives as an array, so both are read as strings or ignored: the
  // store clamps a page size it is given, and an unparseable one falls back to its own default
  // rather than reaching it as NaN.
  const limit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number.NaN;
  const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : undefined;
  try {
    return await auditLogStore.list({
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    });
  } catch (error) {
    throw errors.internal(error);
  }
});

/**
 * The roles carried by a session's user.
 *
 * `role` is one of `@code-zero/auth`'s Better Auth `additionalFields`, which the module's
 * `AuthUser` type does not reflect, hence the narrow structural read rather than a wider cast of
 * the session itself. Better Auth stores multiple roles as one comma-separated string, so
 * membership is a split rather than an equality check. Anything that is not a string — an absent
 * field, a schema that drifted — yields no roles at all, so the caller fails closed.
 */
function rolesOf(user: unknown): string[] {
  if (typeof user !== 'object' || user === null || !('role' in user)) return [];
  const role: unknown = user.role;
  return typeof role === 'string' ? role.split(',').map((entry) => entry.trim()) : [];
}
