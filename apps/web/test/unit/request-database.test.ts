import { describe, expect, it } from 'vitest';

import { createRequestDatabase, type RequestScope } from '../../server/utils/request-database.js';

interface Client {
  readonly connectionString: string;
}

function worker(connectionString: string): RequestScope {
  return { context: { cloudflare: { env: { HYPERDRIVE: { connectionString } } } } };
}

const FALLBACK: Client = { connectionString: 'process-wide' };

/** A selection over a request that tests switch between, and a record of every client opened. */
function harness() {
  const opened: Client[] = [];
  const state: { current: RequestScope | undefined } = { current: undefined };
  const select = createRequestDatabase<Client>({
    request: () => state.current,
    open: (connectionString) => {
      const client = { connectionString };
      opened.push(client);
      return client;
    },
    fallback: () => FALLBACK,
  });

  return { opened, state, select };
}

describe('createRequestDatabase', () => {
  it('opens one client per request and reuses it for the rest of that request', () => {
    const { select, state, opened } = harness();
    state.current = worker('postgres://hyperdrive/one');

    const first = select();
    const second = select();

    expect(second).toBe(first);
    expect(opened).toHaveLength(1);
  });

  it('gives each request its own client, even while two overlap', () => {
    const { select, state } = harness();
    const one = worker('postgres://hyperdrive/one');
    const two = worker('postgres://hyperdrive/two');

    state.current = one;
    const forOne = select();
    state.current = two;
    const forTwo = select();
    state.current = one;

    expect(forTwo).not.toBe(forOne);
    expect(select()).toBe(forOne);
    expect(forOne.connectionString).toBe('postgres://hyperdrive/one');
    expect(forTwo.connectionString).toBe('postgres://hyperdrive/two');
  });

  it.each([
    ['no request in progress', undefined],
    ['a request without a Cloudflare context', { context: {} }],
    ['a request without the Hyperdrive binding', { context: { cloudflare: { env: {} } } }],
    [
      'a binding that carries no connection string',
      { context: { cloudflare: { env: { HYPERDRIVE: {} } } } },
    ],
  ])('uses the process-wide client for %s', (_name, request) => {
    const { select, state, opened } = harness();
    state.current = request;

    expect(select()).toBe(FALLBACK);
    expect(opened).toHaveLength(0);
  });

  it('opens nothing until a client is asked for', () => {
    const { state, opened } = harness();
    state.current = worker('postgres://hyperdrive/one');

    expect(opened).toHaveLength(0);
  });
});
