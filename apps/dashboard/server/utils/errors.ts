import { redactSecrets } from '@code-zero/shared';
import { createError } from 'h3';

/**
 * The transport-level failures the routes in this app raise.
 *
 * A route names the failure instead of spelling out a status inline, so the same disposition
 * cannot drift between the RPC and OpenAPI transports. Each entry builds an `H3Error`, which
 * Nitro serialises and which the app's own `resolveErrorStatus` already understands — routes
 * throw these rather than hand-building a `Response`.
 *
 * `createError` is imported rather than taken from Nitro's auto-imports — unlike a route, this
 * module is exercised directly from the plain-Node unit suite, where no Nitro globals exist.
 *
 * The client-facing text lives in `message`, not `statusMessage` or `data`. Bare h3 (`sendError`)
 * only ever serialises `statusCode`/`statusMessage`/`data`, dropping `message` — but this app's
 * Nitro server never reaches that code path: Nitro installs its own error handler
 * (`nitropack`'s `defaultNitroErrorHandler`, dev and prod builds alike), which reads
 * `error.message` and forwards it verbatim as long as neither `error.fatal` nor `error.unhandled`
 * is set. `H3Error` defaults both to `false`, and no entry below sets either, so every message
 * here — `'Not found'`, the named variable, the redacted failure — reaches the client. Setting
 * `fatal`/`unhandled` on a future entry would silently replace its message with a generic
 * "Server Error" instead; `errors.test.ts` asserts both stay unset.
 */
export const errors = {
  /** No transport matched the request path; the router itself is healthy. */
  notFound: () =>
    createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Not found' }),

  /**
   * A required environment variable is absent, so the route fails closed rather than running with
   * a partial configuration. The variable is named because it is deployment configuration, never
   * a secret's value.
   */
  misconfigured: (variable: string) =>
    createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `${variable} is not configured`,
    }),

  /**
   * The caller is signed in, but the session does not carry the role the route requires. Distinct
   * from the 401 `requireUserSession` raises for an absent session: signing in again would not
   * help, and saying so is what keeps the reader from retrying the login loop.
   */
  forbidden: (reason: string) =>
    createError({ statusCode: 403, statusMessage: 'Forbidden', message: reason }),

  /**
   * An unexpected failure, redacted before it reaches either the client or Nitro's error log.
   *
   * The original error is deliberately not attached as `cause`: it is the value most likely to
   * carry a token or a checkout path in its message, and anything attached here is logged
   * verbatim. Throwing an `H3Error` also keeps the failure "handled", so Nitro reports this
   * redacted message instead of replacing it with a generic one.
   */
  internal: (error: unknown) =>
    createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: redactSecrets(error instanceof Error ? error.message : String(error)),
    }),
};
