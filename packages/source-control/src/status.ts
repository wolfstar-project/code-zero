import { redactSecrets, secretValuesFromEnvironment } from '@code-zero/shared';

import type { ProviderKind } from './contracts.js';

export interface ProviderRequestOptions {
  provider: ProviderKind;
  method: 'POST' | 'PATCH';
  url: string;
  token: string;
  /** The Authorization scheme the provider expects. */
  tokenScheme: 'Bearer' | 'token';
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  fetch?: typeof globalThis.fetch | undefined;
}

/**
 * Send one JSON request to a provider API.
 *
 * The token is only ever sent as an Authorization header, and any error body is redacted before
 * it is raised, so a failed publish cannot leak a credential into logs.
 */
export async function sendProviderRequest(options: ProviderRequestOptions): Promise<unknown> {
  const request = options.fetch ?? globalThis.fetch;
  const response = await request(options.url, {
    method: options.method,
    headers: {
      accept: 'application/json',
      authorization: `${options.tokenScheme} ${options.token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(options.body),
  });
  if (!response.ok) {
    const detail = redactSecrets(await response.text(), [
      options.token,
      ...secretValuesFromEnvironment(),
    ]);
    throw new Error(
      `${options.provider} status request failed (${String(response.status)}): ${detail.slice(0, 1_000)}`,
    );
  }
  // Some providers answer 204 or a non-JSON body; the callers only need success.
  return response.json().catch(() => undefined);
}
