---
name: orpc-server
description: Use when changing apps/dashboard server routes, oRPC contracts, handlers, middleware, transport setup, or typed clients.
---

# oRPC server

`packages/api` owns the router and its runtime delegation; `apps/dashboard`'s `server/` directory is the transport adapter and composition root that serves it, alongside the app's own Nuxt frontend.

## Rules

- Keep procedure contracts and router composition in `packages/api/src/orpc/router.ts`, and the
  control-plane operations they delegate to in `packages/api/src/operations.ts`,
  `control-plane.ts`, `access.ts`, and `dashboard.ts`. `packages/api` holds no HTTP host of its
  own — it only exports `rpcRouter`, `requestLoggerStorage`, and the plain functions those depend
  on. It does not depend on `packages/auth`.
- The HTTP host is Nuxt's own Nitro server. Routes live in `apps/dashboard/server/`:
  - `routes/rpc/[...].ts` mounts `rpcRouter` over `RPCHandler` (the typed RPC transport).
  - `api/v1/[...].ts` mounts the same `rpcRouter` over `OpenAPIHandler` (REST + docs at `/api/v1/docs`).
  - `auth.config.ts` (at the `server/` root) configures `@onmax/nuxt-better-auth`, which mounts
    `/api/auth/**` itself — there is no hand-written auth route file.
  Each route file exports its handler directly (`export default defineEventHandler(...)`), with no
  intermediate `const route` binding, so the file's one public shape is the one Nitro scans for.
  `server/**/*.ts` relies on Nitro's auto-imports: h3 helpers (`defineEventHandler`, `toWebRequest`,
  `setResponseStatus`, `createError`) and this app's own `server/utils/**` exports (`errors`,
  `taskStore`, `buildRpcContext`, the environment resolvers) are used unimported. Import explicitly
  only what auto-imports cannot provide — workspace and third-party packages, and anything a
  plain-Node unit test loads directly (`server/utils/errors.ts` imports `createError` from `h3` for
  exactly that reason). `app/**/*.ts` is unchanged and still uses explicit imports.
  `typecheck` is one `nuxt typecheck` pass
  (Golar, configured in `apps/dashboard/golar.config.ts`) covering `app/`, `modules/`, `server/`,
  and `test/` — there is no separate `tsc --project` or `vue-tsc` invocation.
- `apps/dashboard` pins `nuxt` to the stable v4 channel (`^4.5.2` in `package.json`), whose
  `@nuxt/nitro-server` depends on `nitropack` v2 + classic h3 (`h3@^1.15.11`, also a direct
  dependency), not the standalone Nitro v3 package. Route handlers use classic h3's API:
  `import { defineEventHandler, toWebRequest } from 'h3';`. Call `toWebRequest(event)` to get a
  standard `Request`, pass it to `handler.handle(request, {...})`, and return the resulting
  `Response`. Do not reach for Nitro v3's Fetch-first `defineHandler`/`EventHandlerWithFetch` from
  `nitro`/`nitro/h3`; that API belongs to the unreleased `nuxt-nightly` v5 channel this project does
  not use.
- Declare a procedure's HTTP method, path, tags, and summary with `.meta(openapi({...}))`
  (`import { openapi } from '@orpc/openapi'`), not the `.route({...})` sugar from
  `@orpc/openapi/extensions/route`. That extension patches `.route()` onto the builder via a bare
  side-effect import; Nitro's production bundler tree-shakes it away even though the package's own
  `sideEffects` field marks the module as one to keep, silently dropping every `/api/v1/**` route
  while `/rpc/**` and the build both still look fine. `.meta(openapi(...))` is a real import a
  bundler can't discard, and is what `.route()` expands to internally. This metadata only affects
  the OpenAPI transport; the RPC transport ignores it. Add it whenever a procedure should be
  reachable over `/api/v1/**`, which today means every procedure.
- Infer client types from the router; do not duplicate request or response interfaces.
- Validate inputs at the procedure boundary and return stable domain-shaped results.
- Procedures call the agent runtime through typed APIs. They do not execute shell commands or
  mutate checkouts directly.
- Persist through the `KeyValueStorage` contract, adapted over the ViteHub KV Runtime Helper in
  `apps/dashboard/server/utils/store.ts`, so KV drivers stay interchangeable; never store review
  input or checkout paths. ViteHub is composed into Nuxt's own Nitro build from
  `apps/dashboard/nuxt.config.ts`, which registers `vite-hub/nuxt` as an ordinary module entry
  (`['vite-hub/nuxt', { preset, kv: true }]`) with the deployment preset from `config/env.ts`. Prove KV changes with a real `nuxt build` and a request against a route that reads
  the store, not just `nuxt prepare` or a type check.
- Transport failures are `H3Error`s from the catalogue in `server/utils/errors.ts`
  (`errors.notFound()`, `errors.misconfigured(variable)`, `errors.internal(error)`), thrown and left
  to Nitro to serialise. A route names the failure instead of spelling out a status inline, so the
  same disposition cannot drift between transports, and there is no hand-rolled `Response` builder.
  `errors.internal` redacts the message with `redactSecrets` and attaches no `cause`, because Nitro
  logs a thrown error whole. Successful dispositions return a plain object, with
  `setResponseStatus(event, ...)` when the status is not 200.
- Environment variables the server reads live in `server/utils/environment.ts`, one resolver each,
  taking the environment record as an argument rather than reading `process.env` themselves. They
  deliberately do not move to Nuxt's `runtimeConfig`: its defaults are baked at build time and
  would require renaming every variable to a `NUXT_`-prefixed form, while a deployment sets
  `GITHUB_WEBHOOK_SECRET` and `CODE_ZERO_CHECKOUT_PATH` at run time.
- Keep transport-specific headers, status mapping, and request objects out of runtime packages.
- Nuxt's Nitro server is the only top-level HTTP host; do not introduce Express, Hono, or a second
  one.
- Request logging goes through `EvlogHandlerPlugin` (`@orpc/evlog`), configured with
  `packages/api`'s shared `requestLoggerStorage` in every transport's `plugins` array. Read the
  logger inside a procedure with `requestLoggerStorage?.getStore()?.set({...})` — never the
  throwing `useLogger()` helper, which errors outside a request the plugin instrumented, including
  `createRouterClient` tests.

## Workflow

1. Read the router, its tests, and the runtime method being exposed.
2. Define or adjust the oRPC procedure contract in `packages/api/src/orpc/router.ts`, including its
   `.meta(openapi(...))` metadata.
3. Keep the handler thin: validate, authorize, delegate, translate.
4. Add router tests with `createRouterClient`, without opening a real network port.
5. Update the README client example when the public router shape changes.
6. Run `aube run test --filter @code-zero/api`, then `--filter @code-zero/dashboard`, typecheck,
   and build. For KV or transport-mounting changes, also run a real `nuxt build` and hit the route.
