import { createRouterClient } from '@orpc/server';
import { createRequestLogger } from 'evlog';
import { describe, expect, it } from 'vitest';

import type { Principal } from '../access.js';
import { MemoryTaskStore } from '../control-plane.js';
import {
  createInstallationState,
  InstallationVerificationError,
  type InstallationProvider,
  type InstallationService,
  type InstallationStore,
  type InstallationView,
  type SelectedRepositoryView,
  type VisibleRepository,
} from '../installations.js';
import type { OrganizationMembership } from '../settings.js';
import { requestLoggerStorage } from './logging.js';
import { rpcRouter } from './router.js';

const OWNER: OrganizationMembership = { role: 'owner', managesPolicy: true };
const MEMBER: OrganizationMembership = { role: 'member', managesPolicy: false };
const FORBIDDEN = /FORBIDDEN|not a member|requires|session|not issued|could not be verified/i;
const NOT_FOUND = /NOT_FOUND|not attached/i;
const NOT_A_MEMBER = /not a member/;
const NO_SERVICE = /NOT_IMPLEMENTED|no installation/i;
const CONFLICT = /CONFLICT|already/i;
const NOT_VISIBLE = /not visible|cannot see/i;
const INVALID_INPUT = /validation|invalid/i;
const SECRET = 'a-secret-that-is-long-enough-for-hmac-signing';

const VISIBLE: VisibleRepository[] = [
  { externalId: '501', owner: 'acme', name: 'api', private: true, archived: false },
  { externalId: '502', owner: 'acme', name: 'web', private: false, archived: false },
];

function instrumented<T>(run: () => Promise<T>): Promise<T> {
  if (!requestLoggerStorage) return run();
  const logger = createRequestLogger();
  return requestLoggerStorage.run(logger, async () => {
    try {
      return await run();
    } finally {
      logger.emit();
    }
  });
}

function session(userId = 'usr_1'): Principal {
  return {
    name: `${userId}@example.test`,
    kind: 'session',
    modes: ['observe', 'suggest'],
    admin: false,
    account: { userId, activeOrganizationId: null },
  };
}

const operatorToken: Principal = {
  name: 'service-ops',
  kind: 'token',
  modes: ['observe', 'suggest'],
  admin: false,
};

/** A provider that knows which `userCode` proves which installation, like the real one would. */
function fakeProvider(proofs = new Map([['good-code', '1001']])): InstallationProvider {
  return {
    installUrl: (state) => `https://github.example/apps/code-zero/installations/new?state=${state}`,
    verify: ({ installationId, userCode }) => {
      if (proofs.get(userCode) !== installationId) {
        return Promise.reject(new InstallationVerificationError());
      }
      return Promise.resolve({ login: 'acme', type: 'Organization' });
    },
    repositories: () => Promise.resolve(VISIBLE),
  };
}

/** Memberships and rows in memory, with the one-organization-per-installation rule enforced. */
function memoryStore(members: Map<string, Map<string, OrganizationMembership>>) {
  const installations: (InstallationView & { organizationId: string })[] = [];
  const repositories: (SelectedRepositoryView & { organizationId: string })[] = [];
  const store: InstallationStore = {
    membership: (organizationId, userId) =>
      Promise.resolve(members.get(organizationId)?.get(userId) ?? null),
    attach: (input) => {
      const held = installations.find((row) => row.externalId === input.externalId);
      if (held && held.organizationId !== input.organizationId) {
        return Promise.resolve({ ok: false as const, reason: 'taken' as const });
      }
      const row = held ?? {
        id: `inst-${installations.length + 1}`,
        organizationId: input.organizationId,
        provider: 'github',
        externalId: input.externalId,
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        suspended: false,
      };
      if (!held) installations.push(row);
      return Promise.resolve({ ok: true as const, installation: row });
    },
    list: (organizationId) =>
      Promise.resolve(installations.filter((row) => row.organizationId === organizationId)),
    find: (organizationId, installationId) =>
      Promise.resolve(
        installations.find(
          (row) => row.organizationId === organizationId && row.id === installationId,
        ) ?? null,
      ),
    select: ({ organizationId, installationId, repositories: chosen }) => {
      const saved = chosen.map((repository) => {
        const row = {
          id: `repo-${repositories.length + 1}`,
          organizationId,
          installationId,
          provider: 'github',
          owner: repository.owner,
          name: repository.name,
          mode: repository.mode ?? ('observe' as const),
        };
        repositories.push(row);
        return row;
      });
      return Promise.resolve(saved);
    },
    listRepositories: (organizationId) =>
      Promise.resolve(repositories.filter((row) => row.organizationId === organizationId)),
    removeRepository: (organizationId, id) => {
      const index = repositories.findIndex(
        (row) => row.id === id && row.organizationId === organizationId,
      );
      if (index === -1) return Promise.resolve(false);
      repositories.splice(index, 1);
      return Promise.resolve(true);
    },
  };
  return { store, installations, repositories };
}

function routerClient(principal: Principal, service: InstallationService | null) {
  return createRouterClient(rpcRouter, {
    context: {
      store: new MemoryTaskStore(),
      principal,
      mayTargetRepository: () => true,
      ...(service ? { installations: service } : {}),
    },
  });
}

function setup(options: { proofs?: Map<string, string> } = {}) {
  const members = new Map([
    [
      'org-a',
      new Map([
        ['usr_1', OWNER],
        ['usr_member', MEMBER],
      ]),
    ],
    ['org-b', new Map([['usr_other', OWNER]])],
  ]);
  const memory = memoryStore(members);
  const state = createInstallationState(SECRET);
  const installations: InstallationService = {
    provider: fakeProvider(options.proofs),
    store: memory.store,
    state,
  };
  const client = (principal: Principal, service: InstallationService | null = installations) =>
    routerClient(principal, service);
  return { client, memory, state, installations };
}

async function attached(setupResult: ReturnType<typeof setup>, code = 'good-code') {
  const token = await setupResult.state.sign({ userId: 'usr_1', organizationId: 'org-a' });
  return instrumented(() =>
    setupResult.client(session()).installations.complete({
      state: token,
      installationId: '1001',
      code,
    }),
  );
}

describe('installations.start', () => {
  it('sends an organization owner to the install page with a state bound to them', async () => {
    const { client, state } = setup();

    const { url } = await instrumented(() =>
      client(session()).installations.start({ organizationId: 'org-a' }),
    );

    const token = new URL(url).searchParams.get('state') ?? '';
    await expect(state.verify(token)).resolves.toEqual({
      userId: 'usr_1',
      organizationId: 'org-a',
    });
  });

  it('refuses a member who may not manage the organization', async () => {
    await expect(
      instrumented(() =>
        setup().client(session('usr_member')).installations.start({ organizationId: 'org-a' }),
      ),
    ).rejects.toThrow(FORBIDDEN);
  });

  it('refuses someone who is not in the organization, as it refuses a missing one', async () => {
    const { client } = setup();

    const outsider = instrumented(() =>
      client(session('usr_other')).installations.start({ organizationId: 'org-a' }),
    );
    const missing = instrumented(() =>
      client(session()).installations.start({ organizationId: 'org-missing' }),
    );

    await expect(outsider).rejects.toThrow(NOT_A_MEMBER);
    await expect(missing).rejects.toThrow(NOT_A_MEMBER);
  });

  it('refuses an operator token', async () => {
    await expect(
      instrumented(() =>
        setup().client(operatorToken).installations.start({ organizationId: 'org-a' }),
      ),
    ).rejects.toThrow(FORBIDDEN);
  });

  it('says so when the deployment has no installation service', async () => {
    await expect(
      instrumented(() =>
        setup().client(session(), null).installations.start({ organizationId: 'org-a' }),
      ),
    ).rejects.toThrow(NO_SERVICE);
  });
});

describe('installations.complete', () => {
  it('attaches the installation the person proved they control', async () => {
    const result = setup();

    await expect(attached(result)).resolves.toMatchObject({
      externalId: '1001',
      accountLogin: 'acme',
    });
    expect(result.memory.installations).toHaveLength(1);
  });

  it('attaches nothing when the provider cannot confirm the claim', async () => {
    const result = setup();

    await expect(attached(result, 'a-code-for-another-installation')).rejects.toThrow(FORBIDDEN);
    expect(result.memory.installations).toEqual([]);
  });

  it('refuses a state issued to someone else', async () => {
    const result = setup();
    const token = await result.state.sign({ userId: 'usr_other', organizationId: 'org-b' });

    await expect(
      instrumented(() =>
        result.client(session()).installations.complete({
          state: token,
          installationId: '1001',
          code: 'good-code',
        }),
      ),
    ).rejects.toThrow(FORBIDDEN);
    expect(result.memory.installations).toEqual([]);
  });

  it('refuses a state that was not signed by this deployment', async () => {
    const result = setup();
    const forged = await createInstallationState('another-secret-entirely-different').sign({
      userId: 'usr_1',
      organizationId: 'org-a',
    });

    await expect(
      instrumented(() =>
        result.client(session()).installations.complete({
          state: forged,
          installationId: '1001',
          code: 'good-code',
        }),
      ),
    ).rejects.toThrow(FORBIDDEN);
  });

  it('refuses an installation another organization already holds', async () => {
    const result = setup();
    await attached(result);
    const token = await result.state.sign({ userId: 'usr_other', organizationId: 'org-b' });

    await expect(
      instrumented(() =>
        result.client(session('usr_other')).installations.complete({
          state: token,
          installationId: '1001',
          code: 'good-code',
        }),
      ),
    ).rejects.toThrow(CONFLICT);
  });

  it('is a no-op when the same organization completes it twice', async () => {
    const result = setup();

    await attached(result);
    await attached(result);

    expect(result.memory.installations).toHaveLength(1);
  });

  it('refuses a person who stopped managing the organization after starting', async () => {
    const result = setup();
    const token = await result.state.sign({ userId: 'usr_member', organizationId: 'org-a' });

    await expect(
      instrumented(() =>
        result.client(session('usr_member')).installations.complete({
          state: token,
          installationId: '1001',
          code: 'good-code',
        }),
      ),
    ).rejects.toThrow(FORBIDDEN);
  });
});

describe('installations.list', () => {
  it('shows a member the organization installations, and no one else', async () => {
    const result = setup();
    await attached(result);

    await expect(
      instrumented(() =>
        result.client(session('usr_member')).installations.list({ organizationId: 'org-a' }),
      ),
    ).resolves.toHaveLength(1);
    await expect(
      instrumented(() =>
        result.client(session('usr_other')).installations.list({ organizationId: 'org-a' }),
      ),
    ).rejects.toThrow(NOT_A_MEMBER);
  });
});

describe('installations.repositories', () => {
  it('lists what the installation can see', async () => {
    const result = setup();
    const installation = await attached(result);

    await expect(
      instrumented(() =>
        result.client(session()).installations.repositories({
          organizationId: 'org-a',
          installationId: installation.id,
        }),
      ),
    ).resolves.toEqual(VISIBLE);
  });

  it("does not reach another organization's installation", async () => {
    const result = setup();
    const installation = await attached(result);

    await expect(
      instrumented(() =>
        result.client(session('usr_other')).installations.repositories({
          organizationId: 'org-b',
          installationId: installation.id,
        }),
      ),
    ).rejects.toThrow(NOT_FOUND);
  });
});

describe('organizationRepositories', () => {
  it('selects repositories by id and takes their coordinates from the provider', async () => {
    const result = setup();
    const installation = await attached(result);

    const saved = await instrumented(() =>
      result.client(session()).organizationRepositories.select({
        organizationId: 'org-a',
        installationId: installation.id,
        repositories: [{ externalId: '501' }, { externalId: '502', mode: 'suggest' }],
      }),
    );

    expect(saved.map((row) => `${row.owner}/${row.name}:${row.mode}`)).toEqual([
      'acme/api:observe',
      'acme/web:suggest',
    ]);
  });

  it('refuses a repository the installation cannot see', async () => {
    const result = setup();
    const installation = await attached(result);

    await expect(
      instrumented(() =>
        result.client(session()).organizationRepositories.select({
          organizationId: 'org-a',
          installationId: installation.id,
          repositories: [{ externalId: '999' }],
        }),
      ),
    ).rejects.toThrow(NOT_VISIBLE);
    expect(result.memory.repositories).toEqual([]);
  });

  it('refuses a writable mode at the wire', async () => {
    const result = setup();
    const installation = await attached(result);

    await expect(
      instrumented(() =>
        result.client(session()).organizationRepositories.select({
          organizationId: 'org-a',
          installationId: installation.id,
          // oxlint-disable-next-line no-unsafe-type-assertion -- deliberately invalid input under test
          repositories: [{ externalId: '501', mode: 'fix' as 'observe' }],
        }),
      ),
    ).rejects.toThrow(INVALID_INPUT);
  });

  it('lets a member read the selection but not change it', async () => {
    const result = setup();
    const installation = await attached(result);
    await instrumented(() =>
      result.client(session()).organizationRepositories.select({
        organizationId: 'org-a',
        installationId: installation.id,
        repositories: [{ externalId: '501' }],
      }),
    );

    const member = result.client(session('usr_member'));
    await expect(
      instrumented(() => member.organizationRepositories.list({ organizationId: 'org-a' })),
    ).resolves.toHaveLength(1);
    await expect(
      instrumented(() =>
        member.organizationRepositories.remove({ organizationId: 'org-a', id: 'repo-1' }),
      ),
    ).rejects.toThrow(FORBIDDEN);
  });

  it('removes a repository from its own organization only', async () => {
    const result = setup();
    const installation = await attached(result);
    await instrumented(() =>
      result.client(session()).organizationRepositories.select({
        organizationId: 'org-a',
        installationId: installation.id,
        repositories: [{ externalId: '501' }],
      }),
    );

    await expect(
      instrumented(() =>
        result.client(session('usr_other')).organizationRepositories.remove({
          organizationId: 'org-b',
          id: 'repo-1',
        }),
      ),
    ).resolves.toEqual({ removed: false });
    await expect(
      instrumented(() =>
        result.client(session()).organizationRepositories.remove({
          organizationId: 'org-a',
          id: 'repo-1',
        }),
      ),
    ).resolves.toEqual({ removed: true });
  });
});
