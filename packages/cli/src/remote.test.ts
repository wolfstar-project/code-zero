import { describe, expect, it } from 'vitest';

import type { StoredCredential } from './credentials.js';
import { runRemotely, type RemoteRunRequest } from './remote.js';

const ORIGIN = 'https://code-zero.example.com';
const NOW = Date.parse('2026-08-09T10:00:00.000Z');

const REQUEST: RemoteRunRequest = {
  origin: ORIGIN,
  repository: '/srv/checkouts/acme-app',
  mode: 'observe',
  trigger: 'proactive',
};

function credentials(credential?: Partial<StoredCredential>) {
  if (!credential) return () => Promise.resolve({});
  return () =>
    Promise.resolve({
      [ORIGIN]: {
        accessToken: 'session-token-value',
        expiresAt: '2026-08-09T11:00:00.000Z',
        ...credential,
      },
    });
}

interface Recorded {
  url: string;
  headers: Headers;
  body: unknown;
}

function transport(response: Response) {
  const requests: Recorded[] = [];
  const send: typeof globalThis.fetch = async (input, init) => {
    requests.push({
      // The adapter only ever passes a string URL; narrowed rather than stringified.
      url: typeof input === 'string' ? input : 'url' in input ? input.url : input.href,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return response;
  };
  return { send, requests };
}

function rpc(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ json: body }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('runRemotely', () => {
  it('presents the stored session as a bearer token on the RPC transport', async () => {
    const { send, requests } = transport(rpc({ id: 'cz_1', state: 'completed', plan: [] }));

    const outcome = await runRemotely(REQUEST, {
      fetch: send,
      credentials: credentials({}),
      now: () => NOW,
    });

    expect(outcome).toEqual({ ok: true, result: { id: 'cz_1', state: 'completed', plan: [] } });
    expect(requests[0]?.url).toBe(`${ORIGIN}/rpc/tasks/create`);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer session-token-value');
    // Only the RPC transport resolves a session, and its CSRF guard reads this header.
    expect(requests[0]?.headers.get('sec-fetch-mode')).toBe('cors');
  });

  it('sends the run the operator asked for, and no feedback for a proactive one', async () => {
    const { send, requests } = transport(rpc({ id: 'cz_1', state: 'completed', plan: [] }));

    await runRemotely(REQUEST, { fetch: send, credentials: credentials({}), now: () => NOW });

    expect(requests[0]?.body).toEqual({
      json: {
        repository: '/srv/checkouts/acme-app',
        mode: 'observe',
        trigger: 'proactive',
      },
    });
  });

  it('carries the feedback when the run is triggered by one', async () => {
    const { send, requests } = transport(rpc({ id: 'cz_1', state: 'completed', plan: [] }));

    await runRemotely(
      { ...REQUEST, trigger: 'feedback', feedback: 'Possible null dereference' },
      { fetch: send, credentials: credentials({}), now: () => NOW },
    );

    expect(requests[0]?.body).toMatchObject({ json: { feedback: 'Possible null dereference' } });
  });

  it('sends nothing at all when this machine holds no session for the deployment', async () => {
    const { send, requests } = transport(rpc({ id: 'cz_1', state: 'completed', plan: [] }));

    const outcome = await runRemotely(REQUEST, { fetch: send, credentials: credentials() });

    expect(outcome).toEqual({ ok: false, failure: { kind: 'signed-out' } });
    expect(requests).toEqual([]);
  });

  it('recognises an expired session offline, rather than spending a round trip on it', async () => {
    const { send, requests } = transport(rpc({ id: 'cz_1', state: 'completed', plan: [] }));

    const outcome = await runRemotely(REQUEST, {
      fetch: send,
      credentials: credentials({ expiresAt: '2026-08-09T09:00:00.000Z' }),
      now: () => NOW,
    });

    expect(outcome).toEqual({ ok: false, failure: { kind: 'expired' } });
    expect(requests).toEqual([]);
  });

  it('treats an unparseable expiry as expired rather than as valid', async () => {
    const { send } = transport(rpc({ id: 'cz_1', state: 'completed', plan: [] }));

    const outcome = await runRemotely(REQUEST, {
      fetch: send,
      credentials: credentials({ expiresAt: 'whenever' }),
      now: () => NOW,
    });

    expect(outcome).toEqual({ ok: false, failure: { kind: 'expired' } });
  });

  it('reports the rule the deployment refused on', async () => {
    const { send } = transport(
      rpc({ code: 'FORBIDDEN', message: 'Repository is not allow-listed for task creation' }, 403),
    );

    const outcome = await runRemotely(REQUEST, {
      fetch: send,
      credentials: credentials({}),
      now: () => NOW,
    });

    expect(outcome).toEqual({
      ok: false,
      failure: {
        kind: 'refused',
        message: 'Repository is not allow-listed for task creation',
      },
    });
  });

  it('reads a rejected session as expired, so the advice is to sign in again', async () => {
    const { send } = transport(rpc({ code: 'UNAUTHORIZED' }, 401));

    const outcome = await runRemotely(REQUEST, {
      fetch: send,
      credentials: credentials({}),
      now: () => NOW,
    });

    expect(outcome).toEqual({ ok: false, failure: { kind: 'expired' } });
  });

  it('refuses an answer that is not a result, which must never reach the exit-code table', async () => {
    const { send } = transport(rpc({ queued: true }));

    const outcome = await runRemotely(REQUEST, {
      fetch: send,
      credentials: credentials({}),
      now: () => NOW,
    });

    expect(outcome).toMatchObject({ ok: false, failure: { kind: 'refused' } });
  });

  it('refuses a non-terminal answer, which the exit-code table has no entry for', async () => {
    // `id`/`state` alone pass the loosest possible shape check; a real, in-progress `/rpc`
    // response looks exactly like this before the run finishes. Accepting it here would report
    // exit code 0 for a task that has not actually finished yet.
    const { send } = transport(rpc({ id: 'cz_1', state: 'queued' }));

    const outcome = await runRemotely(REQUEST, {
      fetch: send,
      credentials: credentials({}),
      now: () => NOW,
    });

    expect(outcome).toMatchObject({ ok: false, failure: { kind: 'refused' } });
  });

  it('names the unreachable deployment instead of throwing at the operator', async () => {
    const outcome = await runRemotely(REQUEST, {
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
      credentials: credentials({}),
      now: () => NOW,
    });

    expect(outcome).toMatchObject({
      ok: false,
      failure: { kind: 'refused', message: expect.stringContaining(ORIGIN) },
    });
  });
});
