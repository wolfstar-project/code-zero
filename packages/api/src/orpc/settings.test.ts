import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultDeploymentSettings, type DeploymentSettings } from '@code-zero/config';
import { createRouterClient } from '@orpc/server';
import { createRequestLogger, initLogger, mockAudit, type MockAudit } from 'evlog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Principal } from '../access.js';
import { MemoryTaskStore } from '../control-plane.js';
import type {
  DashboardSettingsAuthority,
  DeploymentSettingsAuthority,
  FileSettingsAuthority,
  OrganizationMembership,
  SettingsState,
} from '../settings.js';
import { requestLoggerStorage } from './logging.js';
import { rpcRouter } from './router.js';

initLogger({ silent: true });

const NO_ORGANIZATION_ERROR = /Select the organization/;
const ADMIN_ERROR = /admin role/;
const FILE_SOURCE_ERROR = /deployment file/;
const ISOLATION_ERROR = /isolated sandbox/;
const CLOUD_ONLY_ERROR = /managed cloud/;
const CLOUD_LOCKED_ERROR = /managed service/;
const NOT_A_MEMBER_ERROR = /not a member/;
const MODE_REFUSED_ERROR = /not allowed by the deployment settings/;
const POLICY_ROLE_ERROR = /owner or admin/;
const SETTINGS_INVALID_ERROR = /settings are invalid/;
const SESSION_ONLY_ERROR = /token or an API key/;

const FORBIDDEN = /FORBIDDEN|not allowed|requires|not a member|Select the organization|session/i;
const INVALID = /invalid/i;
const OWNER: OrganizationMembership = { role: 'owner', managesPolicy: true };
const MEMBER: OrganizationMembership = { role: 'member', managesPolicy: false };

const SERVICE_SETTINGS: DeploymentSettings = {
  execution: {
    maxConcurrentTasks: 10,
    commandTimeoutMinutes: 60,
    allowedModes: ['observe', 'suggest'],
    maxNetwork: 'restricted',
  },
  model: { provider: 'anthropic', name: 'service-model-name' },
  runner: { isolation: 'container', engine: 'docker', image: 'ghcr.io/service/runner:7' },
};

let store: MemoryTaskStore;
let audited: MockAudit;
let checkout: string;

beforeEach(async () => {
  store = new MemoryTaskStore();
  audited = mockAudit();
  checkout = await mkdtemp(join(tmpdir(), 'code-zero-settings-'));
  await writeFile(join(checkout, 'package.json'), JSON.stringify({ scripts: {} }), 'utf8');
});

afterEach(() => {
  audited.restore();
});

/** Opens the request logger the router audits through, as a transport would. */
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

function session(
  options: { admin?: boolean; userId?: string; activeOrganizationId?: string | null } = {},
): Principal {
  return {
    name: `${options.userId ?? 'usr_1'}@example.test`,
    kind: 'session',
    modes: options.admin ? ['observe', 'suggest', 'fix', 'autonomous'] : ['observe', 'suggest'],
    admin: options.admin ?? false,
    account: {
      userId: options.userId ?? 'usr_1',
      activeOrganizationId: options.activeOrganizationId ?? null,
    },
  };
}

const operatorToken: Principal = {
  name: 'service-ops',
  kind: 'token',
  modes: ['observe', 'suggest'],
  admin: false,
};

function apiKey(organizationId: string): Principal {
  return {
    name: `api-key:key_1@${organizationId}`,
    kind: 'apiKey',
    modes: ['observe', 'suggest'],
    admin: false,
    organizationId,
  };
}

/** Counts reads, so a test can show a refusal came before the source was touched. */
interface Counted {
  reads: number;
}

function fileAuthority(
  state: SettingsState = ready(defaultDeploymentSettings),
): FileSettingsAuthority & Counted {
  const authority: FileSettingsAuthority & Counted = {
    edition: 'self-hosted',
    source: 'file',
    filePath: '/srv/code-zero/config.yml',
    reads: 0,
    read: () => {
      authority.reads += 1;
      return Promise.resolve(state);
    },
    services: () =>
      Promise.resolve([
        { service: 'model', configured: false },
        { service: 'database', configured: true },
      ]),
  };
  return authority;
}

function dashboardAuthority(): DashboardSettingsAuthority & { saved: DeploymentSettings[] } {
  let current = defaultDeploymentSettings;
  const authority: DashboardSettingsAuthority & { saved: DeploymentSettings[] } = {
    edition: 'self-hosted',
    source: 'dashboard',
    saved: [],
    read: () => Promise.resolve(ready(current)),
    save: (settings) => {
      current = settings;
      authority.saved.push(settings);
      return Promise.resolve();
    },
    services: () => Promise.resolve([]),
  };
  return authority;
}

/**
 * A managed-cloud deployment whose memberships and stored organization limits live in memory.
 *
 * `members` maps an organization to the accounts in it; changing it between calls is how a test
 * removes someone from an organization while their session still names it.
 */
function cloudAuthority(
  members: Map<string, Map<string, OrganizationMembership>>,
  limits = new Map<string, Record<string, unknown>>(),
  settings: DeploymentSettings = SERVICE_SETTINGS,
): FileSettingsAuthority & { savedLimits: Map<string, Record<string, unknown>> } {
  return {
    edition: 'cloud',
    source: 'file',
    filePath: '/srv/service/config.yml',
    savedLimits: limits,
    read: () => Promise.resolve(ready(settings)),
    services: () =>
      Promise.resolve([
        { service: 'model', configured: true },
        { service: 'sandbox', configured: true },
        { service: 'database', configured: true },
        { service: 'mail', configured: true },
      ]),
    organizations: {
      membership: (organizationId, userId) =>
        Promise.resolve(members.get(organizationId)?.get(userId) ?? null),
      read: (organizationId) => Promise.resolve(limits.get(organizationId) ?? null),
      save: (organizationId, document) => {
        limits.set(organizationId, document);
        return Promise.resolve();
      },
    },
  };
}

function ready(settings: DeploymentSettings): SettingsState {
  return { ok: true, settings, saved: null, warnings: [] };
}

function client(principal: Principal, settings: DeploymentSettingsAuthority) {
  return createRouterClient(rpcRouter, {
    context: { store, principal, settings, mayTargetRepository: () => true },
  });
}

describe('settings.get', () => {
  it('refuses a self-hosted member who is not an administrator before reading the source', async () => {
    const authority = fileAuthority();

    await expect(instrumented(() => client(session(), authority).settings.get())).rejects.toThrow(
      ADMIN_ERROR,
    );
    expect(authority.reads).toBe(0);
  });

  it('refuses an operator token and an organization API key', async () => {
    const authority = fileAuthority();

    await expect(
      instrumented(() => client(operatorToken, authority).settings.get()),
    ).rejects.toThrow(FORBIDDEN);
    await expect(
      instrumented(() => client(apiKey('org-a'), authority).settings.get()),
    ).rejects.toThrow(FORBIDDEN);
  });

  it('shows a self-hosted administrator the file as a read-only source', async () => {
    const view = await instrumented(() =>
      client(session({ admin: true }), fileAuthority()).settings.get(),
    );

    expect(view).toMatchObject({
      edition: 'self-hosted',
      source: 'file',
      editable: false,
      filePath: '/srv/code-zero/config.yml',
    });
  });

  it('shows a cloud customer whether services work, never how the service configured them', async () => {
    const members = new Map([['org-a', new Map([['usr_1', MEMBER]])]]);
    const view = await instrumented(() =>
      client(session({ activeOrganizationId: 'org-a' }), cloudAuthority(members)).settings.get(),
    );
    const published = JSON.stringify(view);

    expect(view).toMatchObject({
      edition: 'cloud',
      organization: { id: 'org-a', editable: false },
    });
    expect(published).not.toContain('service-model-name');
    expect(published).not.toContain('ghcr.io/service/runner');
    expect(published).not.toContain('/srv/service/config.yml');
  });
});

describe('settings.update', () => {
  const input = {
    execution: {
      maxConcurrentTasks: 2,
      commandTimeoutMinutes: 15,
      allowedModes: ['observe'],
      maxNetwork: 'none',
    },
    model: null,
    runner: null,
  };

  it('saves the settings when the dashboard is their source', async () => {
    const authority = dashboardAuthority();

    await instrumented(() => client(session({ admin: true }), authority).settings.update(input));

    expect(authority.saved).toEqual([
      {
        execution: {
          maxConcurrentTasks: 2,
          commandTimeoutMinutes: 15,
          allowedModes: ['observe'],
          maxNetwork: 'none',
        },
        model: null,
        runner: null,
      },
    ]);
    expect(audited.events).toMatchObject([{ action: 'settings.updated', outcome: 'success' }]);
  });

  it('refuses an invalid document whole and saves nothing', async () => {
    const authority = dashboardAuthority();

    await expect(
      instrumented(() =>
        client(session({ admin: true }), authority).settings.update({
          ...input,
          execution: { ...input.execution, maxConcurrentTasks: 0 },
        }),
      ),
    ).rejects.toThrow(INVALID);
    expect(authority.saved).toEqual([]);
  });

  it('refuses edits while the file is the source, even from an administrator', async () => {
    await expect(
      instrumented(() => client(session({ admin: true }), fileAuthority()).settings.update(input)),
    ).rejects.toThrow(FILE_SOURCE_ERROR);
    expect(audited.events).toMatchObject([{ action: 'settings.update', outcome: 'denied' }]);
  });

  it('refuses every edit on the managed cloud, even from an administrator', async () => {
    const members = new Map([['org-a', new Map([['usr_1', OWNER]])]]);

    await expect(
      instrumented(() =>
        client(
          session({ admin: true, activeOrganizationId: 'org-a' }),
          cloudAuthority(members),
        ).settings.update(input),
      ),
    ).rejects.toThrow(CLOUD_LOCKED_ERROR);
    expect(audited.events).toMatchObject([{ action: 'settings.update', outcome: 'denied' }]);
  });

  it('refuses an organization API key, whatever it is allowed to run', async () => {
    const authority = dashboardAuthority();

    await expect(
      instrumented(() => client(apiKey('org-a'), authority).settings.update(input)),
    ).rejects.toThrow(SESSION_ONLY_ERROR);
    expect(authority.saved).toEqual([]);
    expect(audited.events).toMatchObject([
      { actor: { type: 'api' }, action: 'settings.update', outcome: 'denied' },
    ]);
  });

  it('refuses a signed-in member who is not an administrator', async () => {
    const authority = dashboardAuthority();

    await expect(
      instrumented(() => client(session(), authority).settings.update(input)),
    ).rejects.toThrow(ADMIN_ERROR);
    expect(authority.saved).toEqual([]);
  });
});

describe('settings.export', () => {
  it('exports YAML that carries no credential from the environment', async () => {
    const secret = 'gateway-secret-0123456789';
    const original = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = secret;
    try {
      const { yaml } = await instrumented(() =>
        client(
          session({ admin: true }),
          fileAuthority(
            ready({
              ...defaultDeploymentSettings,
              model: { provider: 'ai-gateway', name: `${secret}-model` },
            }),
          ),
        ).settings.export(),
      );

      expect(yaml).toContain('provider: ai-gateway');
      expect(yaml).not.toContain(secret);
    } finally {
      if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = original;
    }
  });

  it('refuses to export the managed service settings to a customer', async () => {
    await expect(
      instrumented(() =>
        client(session({ admin: true }), cloudAuthority(new Map())).settings.export(),
      ),
    ).rejects.toThrow(CLOUD_LOCKED_ERROR);
  });
});

describe('settings.organization', () => {
  const lower = {
    organizationId: 'org-a',
    limits: { maxConcurrentTasks: 2, commandTimeoutMinutes: null, allowedModes: ['observe'] },
  };

  it('lets an owner lower the limits below the plan', async () => {
    const members = new Map([['org-a', new Map([['usr_1', OWNER]])]]);

    const view = await instrumented(() =>
      client(
        session({ activeOrganizationId: 'org-a' }),
        cloudAuthority(members),
      ).settings.organization.update(lower),
    );

    expect(view.effective).toMatchObject({
      maxConcurrentTasks: 2,
      commandTimeoutMinutes: 60,
      allowedModes: ['observe'],
    });
    expect(audited.events).toMatchObject([
      { action: 'organization.settings.updated', target: { type: 'organization', id: 'org-a' } },
    ]);
  });

  it('refuses limits above the plan, naming each one', async () => {
    const members = new Map([['org-a', new Map([['usr_1', OWNER]])]]);
    const authority = cloudAuthority(members);

    await expect(
      instrumented(() =>
        client(session(), authority).settings.organization.update({
          organizationId: 'org-a',
          limits: { maxConcurrentTasks: 11, commandTimeoutMinutes: 61, allowedModes: null },
        }),
      ),
    ).rejects.toThrow(INVALID);
    expect(authority.savedLimits.size).toBe(0);
  });

  it('refuses a member whose role does not manage the policy', async () => {
    const members = new Map([['org-a', new Map([['usr_1', MEMBER]])]]);
    const authority = cloudAuthority(members);

    await expect(
      instrumented(() => client(session(), authority).settings.organization.update(lower)),
    ).rejects.toThrow(POLICY_ROLE_ERROR);
    expect(authority.savedLimits.size).toBe(0);
    expect(audited.events).toMatchObject([
      { action: 'organization.settings.update', outcome: 'denied' },
    ]);
  });

  it("refuses to read or change another organization's limits", async () => {
    const members = new Map([
      ['org-a', new Map([['usr_1', OWNER]])],
      ['org-b', new Map([['usr_2', OWNER]])],
    ]);
    const authority = cloudAuthority(members);
    const intruder = client(session({ activeOrganizationId: 'org-a' }), authority);

    await expect(
      instrumented(() => intruder.settings.organization.get({ organizationId: 'org-b' })),
    ).rejects.toThrow(NOT_A_MEMBER_ERROR);
    await expect(
      instrumented(() =>
        intruder.settings.organization.update({ ...lower, organizationId: 'org-b' }),
      ),
    ).rejects.toThrow(NOT_A_MEMBER_ERROR);
    expect(authority.savedLimits.size).toBe(0);
  });

  it('does not exist on a self-hosted deployment', async () => {
    await expect(
      instrumented(() =>
        client(session({ admin: true }), dashboardAuthority()).settings.organization.update(lower),
      ),
    ).rejects.toThrow(CLOUD_ONLY_ERROR);
  });
});

describe('tasks.create under the deployment settings', () => {
  it('refuses every task while the settings are invalid', async () => {
    const authority = fileAuthority({
      ok: false,
      issues: [{ path: '$.execution.max_concurrent_tasks', message: 'Expected an integer.' }],
    });

    await expect(
      instrumented(() =>
        client(session({ admin: true }), authority).tasks.create({
          repository: checkout,
          feedback: 'x',
          mode: 'observe',
        }),
      ),
    ).rejects.toThrow(SETTINGS_INVALID_ERROR);
    await expect(store.list()).resolves.toEqual([]);
  });

  it('refuses a mode the settings no longer allow, even to an administrator', async () => {
    const authority = fileAuthority(
      ready({
        ...defaultDeploymentSettings,
        execution: { ...defaultDeploymentSettings.execution, allowedModes: ['observe'] },
      }),
    );

    await expect(
      instrumented(() =>
        client(session({ admin: true }), authority).tasks.create({
          repository: checkout,
          feedback: 'x',
          mode: 'fix',
        }),
      ),
    ).rejects.toThrow(MODE_REFUSED_ERROR);
    await expect(store.list()).resolves.toEqual([]);
  });

  describe('on the managed cloud', () => {
    const members = () =>
      new Map([
        ['org-a', new Map([['usr_1', MEMBER]])],
        ['org-b', new Map([['usr_2', MEMBER]])],
      ]);

    it('refuses a session that selected no organization', async () => {
      await expect(
        instrumented(() =>
          client(session(), cloudAuthority(members())).tasks.create({
            repository: checkout,
            feedback: 'x',
            mode: 'observe',
          }),
        ),
      ).rejects.toThrow(NO_ORGANIZATION_ERROR);
      await expect(store.list()).resolves.toEqual([]);
    });

    it('refuses a session whose membership in its selected organization was removed', async () => {
      const current = members();
      current.get('org-a')?.delete('usr_1');

      await expect(
        instrumented(() =>
          client(session({ activeOrganizationId: 'org-a' }), cloudAuthority(current)).tasks.create({
            repository: checkout,
            feedback: 'x',
            mode: 'observe',
          }),
        ),
      ).rejects.toThrow(NOT_A_MEMBER_ERROR);
      await expect(store.list()).resolves.toEqual([]);
    });

    it("refuses a session that selected another customer's organization", async () => {
      await expect(
        instrumented(() =>
          client(
            session({ activeOrganizationId: 'org-b' }),
            cloudAuthority(members()),
          ).tasks.create({ repository: checkout, feedback: 'x', mode: 'observe' }),
        ),
      ).rejects.toThrow(NOT_A_MEMBER_ERROR);
      await expect(store.list()).resolves.toEqual([]);
    });

    it("holds an organization API key to its own organization's narrower modes", async () => {
      const limits = new Map([['org-a', { allowed_modes: ['observe'] }]]);

      await expect(
        instrumented(() =>
          client(apiKey('org-a'), cloudAuthority(members(), limits)).tasks.create({
            repository: checkout,
            feedback: 'x',
            mode: 'suggest',
          }),
        ),
      ).rejects.toThrow(MODE_REFUSED_ERROR);
      await expect(store.list()).resolves.toEqual([]);
    });

    it('records the organization a task was created for, whatever the session selects later', async () => {
      const current = members();
      current.get('org-b')?.set('usr_1', MEMBER);
      const authority = cloudAuthority(current);

      const first = await instrumented(() =>
        client(session({ activeOrganizationId: 'org-a' }), authority).tasks.create({
          repository: checkout,
          feedback: 'x',
          mode: 'observe',
        }),
      );
      const second = await instrumented(() =>
        client(session({ activeOrganizationId: 'org-b' }), authority).tasks.create({
          repository: checkout,
          feedback: 'x',
          mode: 'observe',
        }),
      );

      await expect(store.get(first.id)).resolves.toMatchObject({ organizationId: 'org-a' });
      await expect(store.get(second.id)).resolves.toMatchObject({ organizationId: 'org-b' });
    });

    it('runs an operator token for the service under the plan, bound to no organization', async () => {
      const task = await instrumented(() =>
        client(operatorToken, cloudAuthority(members())).tasks.create({
          repository: checkout,
          feedback: 'x',
          mode: 'observe',
        }),
      );

      const record = await store.get(task.id);
      expect(record).toBeDefined();
      expect(record?.organizationId).toBeUndefined();
    });

    it('refuses a customer task when the service configured no sandbox to run it in', async () => {
      const onlyOrgA = new Map([['org-a', new Map([['usr_1', MEMBER]])]]);

      await expect(
        instrumented(() =>
          client(
            session({ activeOrganizationId: 'org-a' }),
            cloudAuthority(onlyOrgA, new Map(), { ...SERVICE_SETTINGS, runner: null }),
          ).tasks.create({ repository: checkout, feedback: 'x', mode: 'observe' }),
        ),
      ).rejects.toThrow(ISOLATION_ERROR);
      await expect(store.list()).resolves.toEqual([]);
    });
  });
});
