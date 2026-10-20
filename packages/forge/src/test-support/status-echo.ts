import type { FetchLike } from 'forges';

import type { ForgeKind } from '../contracts.js';

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | null;
  body: string;
}

function readBody(body: string): Record<string, unknown> {
  if (body.length === 0) return {};
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

/**
 * The status each forge's API returns for a report, echoing the native state it was sent.
 *
 * This is what makes degradation observable: a forge without a neutral state records whatever the
 * provider mapped it to, and the publication compares that with the state it asked for.
 */
const echoes: Record<ForgeKind, (sent: Record<string, unknown>) => Record<string, unknown>> = {
  github: (sent) => ({ id: 1, state: sent.state, context: sent.context }),
  gitlab: (sent) => ({ id: 1, status: sent.state, name: sent.name }),
  gitea: (sent) => ({ id: 1, status: sent.state, context: sent.context }),
  forgejo: (sent) => ({ id: 1, status: sent.state, context: sent.context }),
  bitbucket: (sent) => ({ key: sent.key, name: sent.name, state: sent.state }),
  'azure-devops': (sent) => ({ id: 1, state: sent.state, context: sent.context }),
};

/** A `fetch` that answers every status report like the forge would, and records each request. */
export function statusEcho(kind: ForgeKind): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    requests.push({
      method: init?.method ?? 'GET',
      url,
      authorization: new Headers(init?.headers).get('authorization'),
      body,
    });
    return new Response(JSON.stringify(echoes[kind](readBody(body))), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, requests };
}
