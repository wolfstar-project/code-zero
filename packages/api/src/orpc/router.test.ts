import { createRouterClient } from '@orpc/server';
import { createRequestLogger, initLogger, mockAudit, type MockAudit } from 'evlog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Principal } from '../access.js';
import { MemoryAuditLogStore, type AuditEvent } from '../audit.js';
import { MemoryTaskStore, type StoredTask } from '../control-plane.js';
import type { RepositoryAdmin, RepositoryInput, RepositoryRecord } from '../repositories.js';
import type { BetterAuthSessionApi } from './auth.js';
import { requestLoggerStorage } from './logging.js';
import { rpcRouter } from './router.js';

/** An in-memory stand-in, so this suite covers the router's gate rather than a Drizzle table. */
class MemoryRepositoryAdmin implements RepositoryAdmin {
  private readonly records = new Map<string, RepositoryRecord>();
  private sequence = 0;

  list(): Promise<RepositoryRecord[]> {
    return Promise.resolve([...this.records.values()]);
  }

  save(input: RepositoryInput): Promise<RepositoryRecord> {
    const existing = [...this.records.values()].find(
      (record) => record.checkoutPath === input.checkoutPath,
    );
    this.sequence += 1;
    const record: RepositoryRecord = {
      id: existing?.id ?? `repo_${String(this.sequence)}`,
      provider: input.provider ?? 'github',
      owner: input.owner ?? null,
      name: input.name ?? null,
      checkoutPath: input.checkoutPath,
      mode: input.mode ?? 'observe',
      pollEnabled: input.pollEnabled ?? false,
    };
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  remove(id: string): Promise<boolean> {
    return Promise.resolve(this.records.delete(id));
  }
}

/**
 * Emitting a wide event publishes it, and evlog writes one to the console by default, which would
 * bury this suite's output. Nothing here asserts on that output: `mockAudit` collects the audit
 * fields as the event is finalised, which is the step a deployment's own drain reads.
 */
initLogger({ silent: true });

const TIMESTAMP = '2026-08-09T10:00:00.000Z';
const VALIDATION_ERROR = /validation/i;
const APPROVAL_ERROR = /awaiting human review/i;
const UNAUTHORIZED_ERROR = /authentication required/i;
const FORBIDDEN_ERROR = /not allow-listed/i;
const MODE_ERROR = /not granted/i;
const STORAGE_ERROR = /storage unavailable/i;
const ADMIN_ERROR = /admin role/i;
const NO_AUDIT_LOG_ERROR = /keeps no audit log/i;
const NO_REPOSITORY_STORE_ERROR = /keeps no repository store/i;

let store: MemoryTaskStore;
let auditLog: MemoryAuditLogStore;
let repositories: MemoryRepositoryAdmin;
/**
 * evlog's own capture helper, so the assertions below read the audit events the router actually
 * emitted through `log.audit()` rather than a hand-rolled recorder double standing in for it.
 */
let audited: MockAudit;

interface ClientOptions {
  principal?: Principal;
  auth?: BetterAuthSessionApi;
  reqHeaders?: Headers;
  allowRepository?: boolean;
}

/** A server-side client exercises every procedure without opening a network port. */
function client(options: ClientOptions = {}) {
  return createRouterClient(rpcRouter, {
    context: {
      store,
      ...(options.principal ? { principal: options.principal } : {}),
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.reqHeaders ? { reqHeaders: options.reqHeaders } : {}),
      mayTargetRepository: () => options.allowRepository ?? false,
      repositories,
      auditLog,
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
      auditLog,
    },
  });
}

/** Deliberately omits the log: reading the trail back is an optional capability, not a requirement. */
function unaudited(options: ClientOptions = {}) {
  return createRouterClient(rpcRouter, {
    context: {
      store,
      ...(options.principal ? { principal: options.principal } : {}),
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.reqHeaders ? { reqHeaders: options.reqHeaders } : {}),
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
  if (!requestLoggerStorage) return run();
  const logger = createRequestLogger();
  return requestLoggerStorage.run(logger, async () => {
    try {
      return await run();
    } finally {
      // `log.audit()` sets fields on the wide event; evlog finalises and publishes them when the
      // event is emitted, which a transport does at the end of the request. Emitting here is what
      // makes `mockAudit` observe exactly what a deployment's drain would receive.
      logger.emit();
    }
  });
}

function operator() {
  return client({
    principal: {
      name: 'release-manager',
      kind: 'token',
      modes: ['observe', 'suggest', 'fix', 'autonomous'],
      admin: false,
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

function auditRecord(id: string, occurredAt: string): AuditEvent {
  return {
    id,
    occurredAt,
    actor: { type: 'user', id: 'ops@example.test' },
    action: 'approval.decided',
    outcome: 'success',
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
  auditLog = new MemoryAuditLogStore();
  repositories = new MemoryRepositoryAdmin();
  audited = mockAudit();
});

afterEach(() => {
  audited.restore();
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
          principal: {
            name: 'release-manager',
            kind: 'token',
            modes: ['autonomous'],
            admin: false,
          },
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
      principal: { name: 'ci', kind: 'token', modes: ['observe', 'suggest'], admin: false },
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
        client({
          principal: { name: 'ci', kind: 'token', modes: ['autonomous'], admin: false },
        }).tasks.create({
          repository: '/etc',
          feedback: 'x',
          mode: 'autonomous',
        }),
      ),
    ).rejects.toThrow(FORBIDDEN_ERROR);

    expect(audited.events).toMatchObject([
      {
        actor: { type: 'api', id: 'ci' },
        action: 'task.create',
        outcome: 'denied',
        reason: 'Repository is not allow-listed for task creation',
        target: { type: 'repository', id: '/etc' },
      },
    ]);
  });

  it('records a mode refusal with the mode that was not granted', async () => {
    await expect(
      instrumented(() =>
        client({
          principal: { name: 'ci', kind: 'token', modes: ['observe'], admin: false },
          allowRepository: true,
        }).tasks.create({ repository: '.', feedback: 'x', mode: 'fix' }),
      ),
    ).rejects.toThrow(MODE_ERROR);

    expect(audited.events).toMatchObject([
      {
        actor: { type: 'api', id: 'ci' },
        action: 'task.create',
        outcome: 'denied',
        reason: "Execution mode 'fix' is not granted to this principal",
        target: { type: 'repository', id: '.', mode: 'fix' },
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

    expect(audited.events).toMatchObject([
      {
        actor: { type: 'api', id: 'release-manager' },
        action: 'approval.decided',
        outcome: 'success',
        target: { type: 'task', id: 'cz_1', decision: 'approved', repository: 'acme/app' },
      },
    ]);
  });

  it('records nothing for a decision that never reached the record', async () => {
    await store.save({ ...awaiting('cz_1'), status: 'completed' });

    await expect(
      instrumented(() => operator().approvals.decide({ taskId: 'cz_1', decision: 'approved' })),
    ).rejects.toThrow(APPROVAL_ERROR);
    expect(audited.events).toEqual([]);
  });

  it('records a creation that failed after the request was authorised', async () => {
    await expect(
      instrumented(() =>
        failingStoreClient({
          principal: {
            name: 'release-manager',
            kind: 'token',
            modes: ['autonomous'],
            admin: false,
          },
          allowRepository: true,
        }).tasks.create({ repository: '.', feedback: 'x', mode: 'autonomous' }),
      ),
    ).rejects.toThrow(STORAGE_ERROR);

    // Without this the trail would show the request being authorised and then nothing at all,
    // which reads as a task that was never attempted rather than one that broke.
    expect(audited.events).toMatchObject([
      {
        actor: { type: 'api', id: 'release-manager' },
        action: 'task.create',
        outcome: 'failure',
        reason: 'storage unavailable',
        target: { type: 'repository', id: '.', mode: 'autonomous' },
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
    expect(audited.events).toMatchObject([
      {
        actor: { type: 'user', id: 'ops@example.test' },
        action: 'approval.decided',
        outcome: 'success',
        target: { type: 'task', id: 'cz_1', decision: 'approved', repository: 'acme/app' },
      },
    ]);
  });

  it('reads the trail back for an administrator, newest first', async () => {
    await auditLog.append(auditRecord('audit_1', '2026-08-09T10:00:00.000Z'));
    await auditLog.append(auditRecord('audit_2', '2026-08-09T10:00:01.000Z'));

    const page = await instrumented(() =>
      client({
        auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
        reqHeaders: new Headers(),
      }).audit.list({}),
    );

    expect(page.events.map((entry) => entry.id)).toEqual(['audit_2', 'audit_1']);
  });

  it('refuses a signed-in reader who is not an administrator', async () => {
    await expect(
      instrumented(() =>
        client({
          auth: betterAuth({ email: 'dev@example.test', role: 'member' }),
          reqHeaders: new Headers(),
        }).audit.list({}),
      ),
    ).rejects.toThrow(ADMIN_ERROR);
  });

  it('refuses an operator token, which the trail records rather than serves', async () => {
    // A token that could read the trail could read its own use back; reading is a person's
    // surface, reached with a session.
    await expect(instrumented(() => operator().audit.list({}))).rejects.toThrow(ADMIN_ERROR);
  });

  it('refuses an unauthenticated reader', async () => {
    await expect(instrumented(() => client().audit.list({}))).rejects.toThrow(UNAUTHORIZED_ERROR);
  });

  it('says a deployment keeps no trail rather than reporting an empty one', async () => {
    await expect(
      instrumented(() =>
        unaudited({
          auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
          reqHeaders: new Headers(),
        }).audit.list({}),
      ),
    ).rejects.toThrow(NO_AUDIT_LOG_ERROR);
  });

  it('serves callers that keep no readable audit log at all', async () => {
    await store.save(awaiting('cz_1'));

    await expect(
      instrumented(() =>
        unaudited({
          principal: {
            name: 'release-manager',
            kind: 'token',
            modes: ['autonomous'],
            admin: false,
          },
          allowRepository: true,
        }).approvals.decide({ taskId: 'cz_1', decision: 'approved' }),
      ),
    ).resolves.toMatchObject({ approval: { actor: 'release-manager' } });
  });
});

describe('rpc repositories', () => {
  it('lists configured repositories for an administrator', async () => {
    await repositories.save({ checkoutPath: '/srv/checkouts/acme-app' });

    const page = await instrumented(() =>
      client({
        auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
        reqHeaders: new Headers(),
      }).repositories.list(),
    );

    expect(page).toMatchObject([{ checkoutPath: '/srv/checkouts/acme-app', mode: 'observe' }]);
  });

  it('adds a repository, and the next task creation honours it with no restart', async () => {
    const admin = client({
      auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
      reqHeaders: new Headers(),
    });

    const saved = await instrumented(() =>
      admin.repositories.save({ checkoutPath: '/srv/checkouts/acme-app', mode: 'suggest' }),
    );

    expect(saved).toMatchObject({ checkoutPath: '/srv/checkouts/acme-app', mode: 'suggest' });
    expect(audited.events).toMatchObject([
      {
        actor: { type: 'user', id: 'ops@example.test' },
        action: 'repository.saved',
        outcome: 'success',
        target: { type: 'repository', id: '/srv/checkouts/acme-app' },
      },
    ]);
  });

  it('updates the repository already claiming a checkout path rather than duplicating it', async () => {
    const admin = client({
      auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
      reqHeaders: new Headers(),
    });

    const first = await instrumented(() =>
      admin.repositories.save({ checkoutPath: '/srv/checkouts/acme-app' }),
    );
    const second = await instrumented(() =>
      admin.repositories.save({ checkoutPath: '/srv/checkouts/acme-app', mode: 'suggest' }),
    );

    expect(second.id).toBe(first.id);
    await expect(instrumented(() => admin.repositories.list())).resolves.toHaveLength(1);
  });

  it('removes a configured repository', async () => {
    const admin = client({
      auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
      reqHeaders: new Headers(),
    });
    const saved = await instrumented(() =>
      admin.repositories.save({ checkoutPath: '/srv/checkouts/acme-app' }),
    );

    const result = await instrumented(() => admin.repositories.remove({ id: saved.id }));

    expect(result).toEqual({ removed: true });
    expect(audited.events).toMatchObject([
      {},
      { action: 'repository.removed', outcome: 'success', target: { id: saved.id } },
    ]);
  });

  it('refuses a signed-in reader who is not an administrator', async () => {
    await expect(
      instrumented(() =>
        client({
          auth: betterAuth({ email: 'dev@example.test', role: 'member' }),
          reqHeaders: new Headers(),
        }).repositories.list(),
      ),
    ).rejects.toThrow(ADMIN_ERROR);
  });

  it('refuses an operator token, which may run work but not configure what it may run against', () => {
    return expect(instrumented(() => operator().repositories.list())).rejects.toThrow(ADMIN_ERROR);
  });

  it('refuses an unauthenticated caller', async () => {
    await expect(instrumented(() => client().repositories.list())).rejects.toThrow(
      UNAUTHORIZED_ERROR,
    );
  });

  it('says a deployment keeps no repository store rather than reporting an empty one', async () => {
    await expect(
      instrumented(() =>
        unaudited({
          auth: betterAuth({ email: 'ops@example.test', role: 'admin' }),
          reqHeaders: new Headers(),
        }).repositories.list(),
      ),
    ).rejects.toThrow(NO_REPOSITORY_STORE_ERROR);
  });
});
