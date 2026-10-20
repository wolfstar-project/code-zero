import type { RpcRouter } from '@code-zero/api';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

/**
 * Browser-side oRPC client for `/rpc/**`, and the TanStack Query utilities built on it.
 *
 * A relative `url` is enough: the dashboard's client only ever talks to its own origin (see
 * `server/routes/rpc/[...].ts`), so the browser resolves `/rpc` against `document.baseURI` and
 * attaches the session cookie the same way it would for any other same-origin `fetch`. The
 * transport's `SimpleCsrfProtectionHandlerPlugin` needs no client-side counterpart either: it is
 * satisfied by the `Sec-Fetch-Mode` header every browser `fetch()` call already carries.
 *
 * Provided under `$orpc`/`$orpcQuery` rather than exported from a plain module: `orpc.server.ts`
 * provides the same two keys from a differently-configured link, and only one of the two ever
 * ships in a given bundle (Nuxt's `.client`/`.server` suffix), so call sites reach either through
 * `useNuxtApp()` without caring which one ran.
 */
export default defineNuxtPlugin(() => {
  const link = new RPCLink({ url: '/rpc' });
  const client: RouterClient<RpcRouter> = createORPCClient(link);

  return {
    provide: {
      orpc: client,
      orpcQuery: createTanstackQueryUtils(client),
    },
  };
});
