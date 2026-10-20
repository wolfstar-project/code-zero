import { redactSecrets, secretValuesFromEnvironment } from '@code-zero/shared';
import { ForgeApiError, ForgeError } from 'forges';

/** A connection or a call was configured in a way the forge cannot support. */
export class ForgeConfigurationError extends Error {
  constructor(
    readonly forge: string,
    message: string,
  ) {
    super(`${forge}: ${message}`);
    this.name = 'ForgeConfigurationError';
  }
}

/** A forge request failed. The message is redacted; the response body is never carried whole. */
export class ForgeRequestError extends Error {
  constructor(
    readonly forge: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ForgeRequestError';
  }
}

const MAX_DETAIL = 1_000;

/**
 * Run one forge call and turn any `forges` failure into a redacted `ForgeRequestError`.
 *
 * A failed response body can echo what the request sent, so both the message and the body are
 * passed through the connection's own credentials and the environment's before they are raised.
 */
export async function guarded<T>(
  forge: string,
  secrets: readonly string[],
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    const known = [...secrets, ...secretValuesFromEnvironment()];
    const body = error instanceof ForgeApiError ? ` ${error.body.slice(0, MAX_DETAIL)}` : '';
    const detail = redactSecrets(`${error.message}${body}`, known).slice(0, MAX_DETAIL);
    throw new ForgeRequestError(
      forge,
      `${forge} ${operation} failed (${error.name}): ${detail}`,
      error instanceof ForgeApiError ? error.status : undefined,
    );
  }
}
