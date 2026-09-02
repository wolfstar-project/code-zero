import {
  authenticate,
  mayTargetRepository,
  type BetterAuthSessionApi,
  type ControlPlaneAccess,
  type RpcContext,
  type TaskStore,
} from '@code-zero/api';

/**
 * Builds the oRPC context shared by the `/rpc/**` and `/api/v1/**` transports.
 *
 * Both transports authorize and delegate through the same {@link rpcRouter} procedures, so they
 * resolve context identically apart from `auth`: only `/rpc/**` accepts a dashboard session, and
 * only because it is same-origin and carries CSRF protection. `/api/v1/**` is the cross-origin
 * REST surface, where honouring a cookie would turn every allowed origin into a confused deputy,
 * so it is left token-only.
 *
 * `principal` is resolved eagerly because it is a constant-time comparison against the configured
 * operator tokens. A session is not: `packages/api`'s `authMiddleware` performs that lookup, and
 * only for procedures that require an identity, so an anonymous read never queries the
 * authentication store.
 *
 * Takes `store` rather than importing `taskStore` itself, so this stays testable without pulling
 * in the ViteHub KV binding `../utils/store.js` resolves at runtime.
 */
export function buildRpcContext(
  request: Request,
  access: ControlPlaneAccess | undefined,
  store: TaskStore,
  auth?: BetterAuthSessionApi,
): RpcContext {
  const principal = authenticate(request.headers.get('authorization') ?? undefined, access);
  return {
    store,
    ...(principal ? { principal } : {}),
    ...(auth ? { auth } : {}),
    mayTargetRepository: (repository) => mayTargetRepository(repository, access),
  };
}
