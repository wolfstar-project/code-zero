import { accessFromEnvironment, requestLoggerStorage, rpcRouter } from '@code-zero/api';
import { EvlogHandlerPlugin } from '@orpc/evlog';
import { RPCHandler } from '@orpc/server/fetch';
import {
  RequestHeadersHandlerPlugin,
  SimpleCsrfProtectionHandlerPlugin,
} from '@orpc/server/plugins';

const handler = new RPCHandler(rpcRouter, {
  plugins: [
    // Publishes the request's headers into the oRPC context as `reqHeaders`, which is what
    // `packages/api`'s Better Auth middleware reads the session cookie from. Without it a
    // procedure would have to be handed the transport's own request object.
    new RequestHeadersHandlerPlugin(),
    // This transport authenticates with the dashboard's session cookie, so a cross-site request
    // could otherwise be authenticated by the browser on the visitor's behalf. The plugin checks
    // `Sec-Fetch-Mode`, a header every browser attaches to a `fetch()` call and that a simple
    // cross-site form submission cannot forge — no client-side plugin is needed to satisfy it, see
    // `app/plugins/orpc.client.ts` and `orpc.server.ts`.
    new SimpleCsrfProtectionHandlerPlugin(),
    new EvlogHandlerPlugin({ storage: requestLoggerStorage, plugins: auditPlugins }),
  ],
});
// Fails closed: without configured tokens every mutation is rejected while reads stay open.
const access = accessFromEnvironment();

/**
 * Typed oRPC surface under `/rpc/**`.
 *
 * The transport only validates, authenticates, delegates, and serialises. It holds no runner and
 * no checkout, so an HTTP client cannot reach a repository except through the procedures in
 * {@link rpcRouter}, which run behind the runner boundary. Same-origin only (no CORS plugin): the
 * dashboard's own client is the only intended caller, which is also what makes accepting its
 * session cookie safe here. Cross-origin REST callers use `/api/v1/**`, which stays token-only.
 *
 * `serverAuth(event)` is `@onmax/nuxt-better-auth`'s own instance — the same one serving
 * `/api/auth/**` — so a session minted by signing in is the session a procedure sees, with no
 * second configuration to drift.
 */
export default defineEventHandler(async (event) => {
  const request = toWebRequest(event);
  try {
    const { matched, response } = await handler.handle(request, {
      prefix: '/rpc',
      context: {
        ...buildRpcContext(request, access, taskStore, serverAuth(event)),
        auditLog: auditLogStore,
      },
    });
    if (matched) return response;
  } catch (error) {
    throw errors.internal(error);
  }
  // Outside the `catch` above, so an unmatched path stays a 404 instead of being rethrown as 500.
  throw errors.notFound();
});
