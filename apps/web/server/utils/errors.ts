import { redactSecrets } from '@code-zero/shared';
import { createError, type EvlogError } from 'evlog';

/**
 * The transport-level failures the routes in this app raise.
 *
 * A route names the failure instead of spelling out a status inline, so the same disposition
 * cannot drift between the RPC and OpenAPI transports. Each entry builds an `EvlogError`, which
 * Nitro serialises through its stock error handler and which the app's own `resolveErrorStatus`
 * already understands — routes throw these rather than hand-building a `Response`.
 *
 * `createError` is imported from `evlog` rather than taken from Nitro's auto-imports — unlike a
 * route, this module is exercised directly from the plain-Node unit suite, where no Nitro globals
 * exist.
 *
 * The client-facing text lives in `message`. Nitro installs its own error handler (`nitropack`'s
 * `defaultNitroErrorHandler`, dev and prod builds alike), which reads `error.message` and forwards
 * it verbatim as long as neither `error.fatal` nor `error.unhandled` is truthy. `EvlogError` itself
 * never sets either, so {@link fail} sets both to `false` explicitly rather than leaving them
 * `undefined`: functionally equivalent for Nitro's own truthy check, but it is what lets a shared
 * assertion elsewhere that expects the fields to be exactly `false` — rather than merely falsy —
 * pass against every error this module builds. `errors.test.ts` asserts both stay `false`.
 */
function fail(options: Parameters<typeof createError>[0]): EvlogError & {
  fatal: false;
  unhandled: false;
} {
  return Object.assign(createError(options), { fatal: false as const, unhandled: false as const });
}

export const errors = {
  /** No transport matched the request path; the router itself is healthy. */
  notFound: () => fail({ status: 404, message: 'Not found' }),

  /**
   * A required environment variable is absent, so the route fails closed rather than running with
   * a partial configuration. The variable is named because it is deployment configuration, never
   * a secret's value.
   */
  misconfigured: (variable: string) =>
    fail({ status: 503, message: `${variable} is not configured` }),

  /**
   * The caller is signed in, but the session does not carry the role the route requires. Distinct
   * from the 401 `requireUserSession` raises for an absent session: signing in again would not
   * help, and saying so is what keeps the reader from retrying the login loop.
   */
  forbidden: (reason: string) => fail({ status: 403, message: reason }),

  /**
   * The caller already holds as many concurrent connections of some kind as this process allows.
   * Retrying immediately will not help; closing another connection first will.
   */
  tooManyRequests: (reason: string) => fail({ status: 429, message: reason }),

  /**
   * An unexpected failure, redacted before it reaches either the client or Nitro's error log.
   *
   * The original error is deliberately not attached as `cause`: it is the value most likely to
   * carry a token or a checkout path in its message, and anything attached here is logged
   * verbatim. Throwing a handled error also keeps Nitro from replacing this redacted message with
   * a generic one.
   */
  internal: (error: unknown) =>
    fail({
      status: 500,
      message: redactSecrets(error instanceof Error ? error.message : String(error)),
    }),
};
