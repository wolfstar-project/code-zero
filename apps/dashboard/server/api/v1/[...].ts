import {
  accessFromEnvironment,
  controlPlaneOriginsFromEnvironment,
  requestLoggerStorage,
  rpcRouter,
} from '@code-zero/api';
import { EvlogHandlerPlugin } from '@orpc/evlog';
import { OpenAPIGenerator } from '@orpc/openapi';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIReferenceHandlerPlugin } from '@orpc/openapi/plugins';
import { CORSHandlerPlugin } from '@orpc/server/plugins';
import { ZodToJsonSchemaConverter } from '@orpc/zod';

const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
// `rpcRouter` is static, so the spec is generated once at module load rather than per request to
// `/api/v1/docs` or `/api/v1/openapi.json`.
const openApiSpec = generator.generate(rpcRouter, {
  base: {
    info: { title: 'Code Zero control plane', version: '0.3.0' },
    // `POST /webhooks/github` is a plain Nitro route, not an oRPC procedure — see
    // `server/utils/openapi.ts` for why — so it is merged into the generated spec here instead of
    // appearing as a path the OpenAPI transport itself serves.
    webhooks: { github: githubWebhookPathItem },
  },
});

/**
 * REST/OpenAPI surface for `rpcRouter`, mounted under `/api/v1/**`.
 *
 * Same router, same authorization rules as the `/rpc/**` RPC transport; only the wire protocol
 * differs, for callers that want plain HTTP instead of the typed oRPC client. Unlike `/rpc/**`,
 * this transport is meant for cross-origin callers, so it carries a CORS plugin — restricted to
 * `CODE_ZERO_CONTROL_PLANE_ORIGINS`'s allow-list (default: none) rather than reflecting any
 * request origin, since `tasks.list`/`tasks.get`/`health` are unauthenticated and would otherwise
 * be readable by any website's browser-side JavaScript.
 */
const handler = new OpenAPIHandler(rpcRouter, {
  plugins: [
    new CORSHandlerPlugin({ origin: controlPlaneOriginsFromEnvironment() }),
    new EvlogHandlerPlugin({ storage: requestLoggerStorage }),
    new OpenAPIReferenceHandlerPlugin({
      docsPath: '/docs',
      specPath: '/openapi.json',
      spec: () => openApiSpec,
    }),
  ],
});
// Fails closed: without configured tokens every mutation is rejected while reads stay open.
const access = accessFromEnvironment();

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event);
  try {
    const { matched, response } = await handler.handle(request, {
      prefix: '/api/v1',
      context: { ...buildRpcContext(request, access, taskStore), audit: auditRecorder },
    });
    if (matched) return response;
  } catch (error) {
    throw errors.internal(error);
  }
  // Outside the `catch` above, so an unmatched path stays a 404 instead of being rethrown as 500.
  throw errors.notFound();
});
