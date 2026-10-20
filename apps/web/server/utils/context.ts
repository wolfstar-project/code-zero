import { resolve } from 'node:path';

import {
  authenticate,
  type ApiKeyVerifier,
  type BetterAuthSessionApi,
  type ControlPlaneAccess,
  type RepositoryAdmin,
  type RpcContext,
  type TaskStore,
} from '@code-zero/api';
import { API_KEY_PREFIX } from '@code-zero/auth/config';

const BEARER_PREFIX = 'Bearer ';

/**
 * Builds the oRPC context shared by the `/rpc/**` and `/api/v1/**` transports.
 *
 * Both transports authorize and delegate through the same {@link rpcRouter} procedures, so they
 * resolve context identically apart from `credentials.session`: only `/rpc/**` accepts a dashboard
 * session, and only because it is same-origin and carries CSRF protection. `/api/v1/**` is the
 * cross-origin REST surface, where honouring a cookie would turn every allowed origin into a
 * confused deputy, so it accepts bearer credentials only: operator tokens and organization API
 * keys, which both transports verify.
 *
 * `principal` is resolved eagerly because it is a constant-time comparison against the configured
 * operator tokens. A session or an API key is not: `packages/api`'s `authMiddleware` performs that
 * lookup, and only for procedures that require an identity, so an anonymous read never queries the
 * authentication store. A bearer value is treated as an API key only when it matched no operator
 * token and carries the key prefix, so an operator token never reaches the key store.
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
  credentials: { session?: BetterAuthSessionApi; apiKeys?: ApiKeyVerifier } = {},
): RpcContext {
  const authorization = request.headers.get('authorization') ?? undefined;
  const principal = authenticate(authorization, access);
  const presentedApiKey =
    !principal && authorization?.startsWith(`${BEARER_PREFIX}${API_KEY_PREFIX}`)
      ? authorization.slice(BEARER_PREFIX.length)
      : undefined;
  const { session, apiKeys } = credentials;
  return {
    store,
    ...(principal ? { principal } : {}),
    ...(session ? { auth: session } : {}),
    ...(presentedApiKey === undefined ? {} : { presentedApiKey }),
    ...(apiKeys ? { apiKeys } : {}),
    mayTargetRepository: (repository) => repositories.allows(resolve(repository)),
    repositories,
  };
}

/**
 * The API-key verifier of a Better Auth instance, or `undefined` when it serves none.
 *
 * The instance's static type does not list the plugin's endpoints (the composition root widens
 * its plugin list), so the endpoint is looked up at runtime. A deployment that left API keys off
 * has no `verifyApiKey`, and a presented key is then refused rather than looked up.
 */
export function apiKeyVerifier(auth: { api: object }): ApiKeyVerifier | undefined {
  const { api } = auth;
  if (!('verifyApiKey' in api) || typeof api.verifyApiKey !== 'function') return undefined;
  const verify = api.verifyApiKey;
  return {
    verifyApiKey: async (options) => {
      const result: unknown = await verify.call(api, options);
      return isVerification(result) ? result : { valid: false, key: null };
    },
  };
}

type Verification = Awaited<ReturnType<ApiKeyVerifier['verifyApiKey']>>;

/** Whether a `verifyApiKey` answer has the fields the middleware reads. */
function isVerification(value: unknown): value is Verification {
  if (typeof value !== 'object' || value === null || !('valid' in value) || !('key' in value))
    return false;
  const { valid, key } = value;
  if (typeof valid !== 'boolean') return false;
  if (key === null) return true;
  return (
    typeof key === 'object' &&
    'id' in key &&
    typeof key.id === 'string' &&
    'referenceId' in key &&
    typeof key.referenceId === 'string'
  );
}
