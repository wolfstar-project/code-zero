import type { RpcRouter } from '@code-zero/api';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

/**
 * Server-rendered oRPC client for `/rpc/**`, and the TanStack Query utilities built on it.
 *
 * Mirrors `orpc.client.ts` under the same `$orpc`/`$orpcQuery` keys — Nuxt's `.client`/`.server`
 * suffix ships only one of the two per bundle, so a call site never has to know which ran. The
 * link itself differs because SSR runs the transport's own `fetch` on the Node side, where a bare
 * `/rpc` path cannot be resolved: `origin` supplies the request's own origin so the call reaches
 * this same deployment, and `headers` forwards the incoming `cookie` header so the render sees the
 * same session the browser is about to receive — without it, an authenticated visit would render
 * signed out and only pick up the session once client-side hydration re-issued every query.
 */
export default defineNuxtPlugin(() => {
  const requestOrigin = useRequestURL().origin;
  const forwardedHeaders = useRequestHeaders(['cookie']);
  const link = new RPCLink({
    url: '/rpc',
    origin: requestOrigin,
    headers: forwardedHeaders,
  });
  const client: RouterClient<RpcRouter> = createORPCClient(link);

  return {
    provide: {
      orpc: client,
      orpcQuery: createTanstackQueryUtils(client),
    },
  };
});
