import { resolve } from 'node:path';

import {
  authenticate,
  type BetterAuthSessionApi,
  type ControlPlaneAccess,
  type RepositoryAdmin,
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
 * Which checkout a run may target is asked of `repositories` per request rather than fixed at
 * boot: the allow-list is a table an operator edits from the dashboard, so a repository added a
 * moment ago has to be answerable without a restart. The path is resolved first, so `/srv/app` and
 * `/srv/app/../app` cannot be two different answers.
 *
 * The same `repositories` also becomes `context.repositories`, the capability
 * `repositories.list`/`.save`/`.remove` read and write: it is a superset of the narrower
 * `{ allows }` shape those procedures need, and the composition root has only the one store to
 * hand either surface.
 *
 * Takes `store` rather than importing `taskStore` itself, so this stays testable without pulling
 * in the ViteHub KV binding `../utils/store.js` resolves at runtime.
 */
export function buildRpcContext(
  request: Request,
  access: ControlPlaneAccess | undefined,
  store: TaskStore,
  repositories: RepositoryAdmin & { allows: (checkoutPath: string) => Promise<boolean> },
  auth?: BetterAuthSessionApi,
): RpcContext {
  const principal = authenticate(request.headers.get('authorization') ?? undefined, access);
  return {
    store,
    ...(principal ? { principal } : {}),
    ...(auth ? { auth } : {}),
    mayTargetRepository: (repository) => repositories.allows(resolve(repository)),
    repositories,
  };
}
