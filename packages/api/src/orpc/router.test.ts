import { createRouterClient } from '@orpc/server';
import { createRequestLogger } from 'evlog';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Principal } from '../access.js';
import type { AuditEntryInput, AuditRecorder } from '../audit.js';
import { MemoryTaskStore, type StoredTask } from '../control-plane.js';
import type { BetterAuthSessionApi } from './auth.js';
import { requestLoggerStorage } from './logging.js';
import { rpcRouter } from './router.js';

const TIMESTAMP = '2026-08-09T10:00:00.000Z';
const VALIDATION_ERROR = /validation/i;
const APPROVAL_ERROR = /awaiting human review/i;
const UNAUTHORIZED_ERROR = /authentication required/i;
const FORBIDDEN_ERROR = /not allow-listed/i;
const MODE_ERROR = /not granted/i;
const STORAGE_ERROR = /storage unavailable/i;

let store: MemoryTaskStore;
let audited: AuditEntryInput[];

interface ClientOptions {
  principal?: Principal;
  auth?: BetterAuthSessionApi;
  reqHeaders?: Headers;
  allowRepository?: boolean;
}

/** Collects what the router recorded; the durable store has its own tests in `audit.test.ts`. */
const recorder: AuditRecorder = {
  async record(entry) {
    audited.push(entry);
  },
};

/** A server-side client exercises every procedure without opening a network port. */
function client(options: ClientOptions = {}) {
  return createRouterClient(rpcRouter, {
    context: {
      store,
      ...(options.principal ? { principal: options.principal } : {}),
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.reqHeaders ? { reqHeaders: options.reqHeaders } : {}),
      mayTargetRepository: () => options.allowRepository ?? false,
      audit: recorder,
    },
  });
}

/**
 * A client whose task store refuses to persist, so `tasks.create` rejects deterministically.
 *
 * The interesting failure is a run that dies after the record is durable, but reaching it here
 * would mean running a real agent against a checkout. This fails on the same call for the same
 * reason from the router's point of view — `createTask` rejected — which is the branch under test.
 */
function failingStoreClient(options: ClientOptions = {}) {
  return createRouterClient(rpcRouter, {
    context: {
      store: {
        get: () => Promise.resolve(undefined),
        list: () => Promise.resolve([]),
        save: () => Promise.reject(new Error('storage unavailable')),
      },
      ...(options.principal ? { principal: options.principal } : {}),
      mayTargetRepository: () => options.allowRepository ?? false,
      audit: recorder,
    },
  });
}

/** Deliberately omits the recorder: the audit trail is an optional capability, not a requirement. */
function unaudited(options: ClientOptions = {}) {
  return createRouterClient(rpcRouter, {
    context: {
      store,
      ...(options.principal ? { principal: options.principal } : {}),
      mayTargetRepository: () => options.allowRepository ?? false,
    },
  });
}

/**
 * Opens the request logger store the router's `authenticated` middleware reads through
 * `useLogger()`.
 *
 * A transport opens it through `EvlogHandlerPlugin`; a `createRouterClient` call has no transport,
 * so it opens one itself rather than the middleware silently tolerating an absent logger — that
 * tolerance is what would let the plugin be dropped from a handler without anything failing.
 */
function instrumented<T>(run: () => Promise<T>): Promise<T> {
  return requestLoggerStorage ? requestLoggerStorage.run(createRequestLogger(), run) : run();
}

function operator() {
  return client({
    principal: {
      name: 'release-manager',
      kind: 'token',
      modes: ['observe', 'suggest', 'fix', 'autonomous'],
    },
    allowRepository: true,
  });
}

/** A Better Auth instance stubbed down to the one endpoint the integration calls. */
function betterAuth(user: { email: string; role: string } | null): BetterAuthSessionApi {
  return {
    api: {
      getSession: () =>
        Promise.resolve(
          user === null ? null : { session: { id: 'sess_1' }, user: { id: 'usr_1', ...user } },
        ),
    },
  };
}

function awaiting(id: string): StoredTask {
  return {
    id,
    repository: 'acme/app',
    status: 'needs-human',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    events: [],
  };
}

beforeEach(() => {
  store = new MemoryTaskStore();
  audited = [];
});

describe('rpc router', () => {
  it('reports health without touching the store', async () => {
    await expect(client().health()).resolves.toMatchObject({
      status: 'ok',
      service: 'code-zero',
    });
  });

  it('reads task history through the injected store', async () => {
    await store.save(awaiting('cz_1'));
    await expect(client().tasks.list()).resolves.toMatchObject({
      tasks: [{ id: 'cz_1', status: 'needs-human' }],
    });
    await expect(client().tasks.get({ id: 'cz_1' })).resolves.toMatchObject({ id: 'cz_1' });
  });

  it('aggregates the dashboard overview from the same store', async () => {
    await store.save(awaiting('cz_1'));
    await expect(client().dashboard.overview()).resolves.toMatchObject({
      tasks: [{ id: 'cz_1' }],
      active: 0,
      queued: 0,
      awaitingApproval: 1,
    });
  });

  it('resolves an unknown task as absent rather than fabricating one', async () => {
    await expect(client().tasks.get({ id: 'cz_missing' })).resolves.toBeUndefined();
  });

  it('rejects an unknown mode at the procedure boundary', async () => {
    await expect(
      instrumented(() =>
        // @ts-expect-error the schema is the contract under test
        operator().tasks.create({ repository: '.', feedback: 'x', mode: 'yolo' }),
      ),
    ).rejects.toThrow(VALIDATION_ERROR);
  });

  it('rejects an unauthenticated task submission before any work is created', async () => {
    await expect(
      instrumented(() =>
        client().tasks.create({ repository: '.', feedback: 'x', mode: 'autonomous' }),
      ),
    ).rejects.toThrow(UNAUTHORIZED_ERROR);
    await expect(store.list()).resolves.toEqual([]);
  });

  it('refuses task creation for a repository outside the allow-list', async () => {
    await expect(
      instrumented(() =>
        client({
          principal: { name: 'release-manager', kind: 'token', modes: ['autonomous'] },
        }).tasks.create({
          repository: '/etc',
          feedback: 'x',
          mode: 'autonomous',
        }),
      ),
    ).rejects.toThrow(FORBIDDEN_ERROR);
    await expect(store.list()).resolves.toEqual([]);
  });

  it('refuses an execution mode outside the principal grant', async () => {
    const readOnly = client({
      principal: { name: 'ci', kind: 'token', modes: ['observe', 'suggest'] },
      allowRepository: true,
    });
    await expect(
      instrumented(() => readOnly.tasks.create({ repository: '.', feedback: 'x', mode: 'fix' })),
    ).rejects.toThrow(MODE_ERROR);
    await expect(
      instrumented(() =>
        readOnly.tasks.create({ repository: '.', feedback: 'x', mode: 'autonomous' }),
      ),
    ).rejects.toThrow(MODE_ERROR);
    await expect(store.list()).resolves.toEqual([]);
  });

  it('rejects an unauthenticated approval decision', async () => {
    await store.save(awaiting('cz_1'));
    await expect(
      instrumented(() => client().approvals.decide({ taskId: 'cz_1', decision: 'approved' })),
    ).rejects.toThrow(UNAUTHORIZED_ERROR);
    await expect(store.get('cz_1')).resolves.toMatchObject({ status: 'needs-human' });
  });

  it('records an approval attributed to the authenticated principal', async () => {
    await store.save(awaiting('cz_1'));
    await expect(
      instrumented(() => operator().approvals.decide({ taskId: 'cz_1', decision: 'approved' })),
    ).resolves.toMatchObject({ approval: { decision: 'approved', actor: 'release-manager' } });
  });

  it('ignores a wire-supplied actor in favour of the principal identity', async () => {
    await store.save(awaiting('cz_1'));
    await expect(
      instrumented(() =>
        operator().approvals.decide({
          taskId: 'cz_1',
          decision: 'approved',
          // @ts-expect-error the schema no longer accepts an actor from the wire
          actor: 'impostor',
        }),
      ),
    ).resolves.toMatchObject({ approval: { actor: 'release-manager' } });
  });

  it('refuses an approval for a task that is not awaiting review', async () => {
    await store.save({ ...awaiting('cz_1'), status: 'completed' });
    await expect(
      instrumented(() => operator().approvals.decide({ taskId: 'cz_1', decision: 'approved' })),
    ).rejects.toThrow(APPROVAL_ERROR);
  });

  it('authenticates a dashboard session when no operator token was presented', async () => {
    await store.save(awaiting('cz_1'));
    const session = client({
      auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
      reqHeaders: new Headers(),
      allowRepository: true,
    });
    await expect(
      instrumented(() => session.approvals.decide({ taskId: 'cz_1', decision: 'approved' })),
    ).resolves.toMatchObject({ approval: { actor: 'ops@example.test' } });
  });

  it('holds a non-administrator session to the non-writable execution modes', async () => {
    const session = client({
      auth: betterAuth({ email: 'dev@example.test', role: 'user' }),
      reqHeaders: new Headers(),
      allowRepository: true,
    });
    await expect(
      instrumented(() => session.tasks.create({ repository: '.', feedback: 'x', mode: 'fix' })),
    ).rejects.toThrow(MODE_ERROR);
    await expect(store.list()).resolves.toEqual([]);
  });

  it('rejects a request whose session lookup finds nobody', async () => {
    const anonymous = client({ auth: betterAuth(null), reqHeaders: new Headers() });
    await expect(
      instrumented(() =>
        anonymous.tasks.create({ repository: '.', feedback: 'x', mode: 'observe' }),
      ),
    ).rejects.toThrow(UNAUTHORIZED_ERROR);
  });
});

describe('rpc audit trail', () => {
  it('records a repository refusal against the principal that attempted it', async () => {
    await expect(
      instrumented(() =>
        client({ principal: { name: 'ci', kind: 'token', modes: ['autonomous'] } }).tasks.create({
          repository: '/etc',
          feedback: 'x',
          mode: 'autonomous',
        }),
      ),
    ).rejects.toThrow(FORBIDDEN_ERROR);

    expect(audited).toEqual([
      {
        actor: { kind: 'principal', name: 'ci' },
        action: 'task.create',
        outcome: 'denied',
        metadata: { repository: '/etc', reason: 'repository-not-allow-listed' },
      },
    ]);
  });

  it('records a mode refusal with the mode that was not granted', async () => {
    await expect(
      instrumented(() =>
        client({
          principal: { name: 'ci', kind: 'token', modes: ['observe'] },
          allowRepository: true,
        }).tasks.create({ repository: '.', feedback: 'x', mode: 'fix' }),
      ),
    ).rejects.toThrow(MODE_ERROR);

    expect(audited).toEqual([
      {
        actor: { kind: 'principal', name: 'ci' },
        action: 'task.create',
        outcome: 'denied',
        metadata: { repository: '.', mode: 'fix', reason: 'mode-not-granted' },
      },
    ]);
  });

  it('records an approval decision against the principal, never a wire-supplied actor', async () => {
    await store.save(awaiting('cz_1'));

    await instrumented(() =>
      operator().approvals.decide({
        taskId: 'cz_1',
        decision: 'approved',
        // @ts-expect-error the schema no longer accepts an actor from the wire
        actor: 'impostor',
      }),
    );

    expect(audited).toEqual([
      {
        actor: { kind: 'principal', name: 'release-manager' },
        action: 'approval.decided',
        outcome: 'success',
        subject: { type: 'task', id: 'cz_1' },
        metadata: { decision: 'approved', repository: 'acme/app' },
      },
    ]);
  });

  it('records nothing for a decision that never reached the record', async () => {
    await store.save({ ...awaiting('cz_1'), status: 'completed' });

    await expect(
      instrumented(() => operator().approvals.decide({ taskId: 'cz_1', decision: 'approved' })),
    ).rejects.toThrow(APPROVAL_ERROR);
    expect(audited).toEqual([]);
  });

  it('records a creation that failed after the request was authorised', async () => {
    await expect(
      instrumented(() =>
        failingStoreClient({
          principal: { name: 'release-manager', kind: 'token', modes: ['autonomous'] },
          allowRepository: true,
        }).tasks.create({ repository: '.', feedback: 'x', mode: 'autonomous' }),
      ),
    ).rejects.toThrow(STORAGE_ERROR);

    // Without this the trail would show the request being authorised and then nothing at all,
    // which reads as a task that was never attempted rather than one that broke.
    expect(audited).toEqual([
      {
        actor: { kind: 'principal', name: 'release-manager' },
        action: 'task.create',
        outcome: 'failure',
        metadata: { repository: '.', mode: 'autonomous', reason: 'storage unavailable' },
      },
    ]);
  });

  it('records a session caller as a user, never as a machine principal', async () => {
    await store.save(awaiting('cz_1'));
    const session = client({
      auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
      reqHeaders: new Headers(),
      allowRepository: true,
    });

    await instrumented(() => session.approvals.decide({ taskId: 'cz_1', decision: 'approved' }));

    // A person and an operator token are revoked through different channels, so a trail that
    // labelled both `principal` could not tell a reader which one to go turn off.
    expect(audited).toEqual([
      {
        actor: { kind: 'user', name: 'ops@example.test' },
        action: 'approval.decided',
        outcome: 'success',
        subject: { type: 'task', id: 'cz_1' },
        metadata: { decision: 'approved', repository: 'acme/app' },
      },
    ]);
  });

  it('serves callers that keep no audit trail at all', async () => {
    await store.save(awaiting('cz_1'));

    await expect(
      instrumented(() =>
        unaudited({
          principal: { name: 'release-manager', kind: 'token', modes: ['autonomous'] },
          allowRepository: true,
        }).approvals.decide({ taskId: 'cz_1', decision: 'approved' }),
      ),
    ).resolves.toMatchObject({ approval: { actor: 'release-manager' } });
  });
});
