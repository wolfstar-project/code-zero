import type { AsyncLocalStorage } from 'node:async_hooks';

import { createLoggerStorage } from '@orpc/evlog/node';
import type { RequestLogger } from 'evlog';

/**
 * One AsyncLocalStorage-backed request logger, shared by every transport that wraps `rpcRouter`.
 *
 * `createLoggerStorage()` returns a matched pair: the storage each transport hands to
 * `EvlogHandlerPlugin`, and the `useLogger()` accessor procedures read it back through. They have
 * to come from the same call — a second `createLoggerStorage()` would open its own slot and read
 * an empty store.
 */
const loggerStorage = createLoggerStorage();

/**
 * Handed to `EvlogHandlerPlugin` by each transport in `apps/web/server/`.
 *
 * Explicitly typed: without an annotation, tsdown's declaration bundler cannot portably name the
 * inferred type across the `evlog` package boundary.
 */
export const requestLoggerStorage: AsyncLocalStorage<RequestLogger> | undefined =
  loggerStorage.storage;

/**
 * The request logger for the in-flight request.
 *
 * Throws when called outside a request an `EvlogHandlerPlugin`-instrumented transport opened, which
 * is deliberate: a procedure that enriches the wide event should fail loudly if the plugin was
 * dropped from a handler's `plugins` array rather than silently stop logging. Callers that also run
 * without a transport — the `createRouterClient` tests in `router.test.ts` — open the store
 * themselves through {@link requestLoggerStorage}.
 */
export const useLogger: () => Required<RequestLogger> = loggerStorage.useLogger;
