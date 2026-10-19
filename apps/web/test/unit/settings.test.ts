import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OrganizationSettingsStore } from '@code-zero/api';
import { defaultDeploymentSettings, parseDeploymentFile } from '@code-zero/config';
import type { StoredSettings } from '@code-zero/database';
import { describe, expect, it } from 'vitest';

import {
  deploymentIdentity,
  readDeploymentFile,
  type LoadedDeploymentFile,
} from '../../server/utils/deployment.js';
import {
  createSettingsAuthority,
  managesOrganizationPolicy,
  type StoredSettingsSource,
} from '../../server/utils/settings.js';

const FILE_WITH_SETTINGS = 'execution:\n  max_concurrent_tasks: 2\n';

function file(text: string, overrides: Partial<LoadedDeploymentFile> = {}): LoadedDeploymentFile {
  return {
    ...parseDeploymentFile(text),
    path: '/srv/code-zero/config.yml',
    legacy: false,
    ...overrides,
  };
}

function memoryStore(initial: StoredSettings | null = null) {
  let current = initial;
  const writes: Record<string, unknown>[] = [];
  const store: StoredSettingsSource = {
    read: () => Promise.resolve(current),
    save: (document, actor) => {
      writes.push(document);
      current = { document, updatedBy: actor, updatedAt: new Date('2026-10-18T10:00:00Z') };
      return Promise.resolve();
    },
  };
  return { store, writes };
}

const noOrganizations: OrganizationSettingsStore = {
  membership: () => Promise.resolve(null),
  read: () => Promise.resolve(null),
  save: () => Promise.resolve(),
};

function authority(
  environment: Record<string, string>,
  loaded: LoadedDeploymentFile,
  stored = memoryStore().store,
) {
  return createSettingsAuthority({
    identity: deploymentIdentity(environment),
    file: loaded,
    stored,
    organizations: noOrganizations,
    connections: { database: true, mail: false, hostedSandbox: false },
    environment,
  });
}

describe('createSettingsAuthority', () => {
  it('reads the settings from the file while the file is the source', async () => {
    const settings = authority({}, file(FILE_WITH_SETTINGS));

    expect(settings.source).toBe('file');
    await expect(settings.read()).resolves.toMatchObject({
      ok: true,
      settings: { execution: { maxConcurrentTasks: 2 } },
    });
  });

  it('reads only the store while the dashboard is the source, and says the file is ignored', async () => {
    const settings = authority(
      { CODE_ZERO_SETTINGS_SOURCE: 'dashboard' },
      file(FILE_WITH_SETTINGS),
    );

    const state = await settings.read();

    expect(state).toMatchObject({ ok: true, settings: defaultDeploymentSettings });
    expect(state.ok && state.warnings).toHaveLength(1);
  });

  it('saves the document the file source would read back', async () => {
    const { store, writes } = memoryStore();
    const settings = authority({ CODE_ZERO_SETTINGS_SOURCE: 'dashboard' }, file(''), store);
    if (settings.source !== 'dashboard') throw new Error('expected the dashboard source');

    await settings.save(
      {
        ...defaultDeploymentSettings,
        execution: { ...defaultDeploymentSettings.execution, maxConcurrentTasks: 3 },
      },
      'admin@example.test',
    );

    expect(writes).toEqual([
      {
        execution: {
          max_concurrent_tasks: 3,
          command_timeout_minutes: 30,
          allowed_modes: ['observe', 'suggest', 'fix', 'autonomous'],
          max_network: 'full',
        },
      },
    ]);
    await expect(settings.read()).resolves.toMatchObject({
      ok: true,
      settings: { execution: { maxConcurrentTasks: 3 } },
      saved: { by: 'admin@example.test' },
    });
  });

  it('refuses a stored document that no longer parses instead of running on the defaults', async () => {
    const settings = authority(
      { CODE_ZERO_SETTINGS_SOURCE: 'dashboard' },
      file(''),
      memoryStore({
        document: { execution: { max_concurrent_tasks: 'all' } },
        updatedBy: 'someone',
        updatedAt: new Date(),
      }).store,
    );

    await expect(settings.read()).resolves.toMatchObject({ ok: false });
  });

  it('locks a deployment whose edition variable it cannot read, and refuses its settings', async () => {
    const settings = authority({ CODE_ZERO_EDITION: 'clod' }, file(''));

    expect(settings.edition).toBe('cloud');
    await expect(settings.read()).resolves.toMatchObject({ ok: false });
  });

  it('asks the operator to rename a file still using the old name', async () => {
    const settings = authority({}, file('', { legacy: true }));

    const state = await settings.read();

    expect(state.ok && state.warnings).toHaveLength(1);
  });
});

describe('readDeploymentFile', () => {
  it('reads neither file when config.yml and the old name both exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'code-zero-instance-'));
    await writeFile(join(directory, 'config.yml'), FILE_WITH_SETTINGS, 'utf8');
    await writeFile(
      join(directory, 'code-zero.deployment.yml'),
      'control_plane:\n  origins: [https://ops.example.com]\n',
      'utf8',
    );

    const loaded = await readDeploymentFile({}, directory, 'self-hosted');

    expect(loaded.settings.ok).toBe(false);
    expect(loaded.config.controlPlane.origins).toEqual([]);
  });

  it('reads the file CODE_ZERO_CONFIG names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'code-zero-instance-'));
    await writeFile(join(directory, 'instance.yml'), FILE_WITH_SETTINGS, 'utf8');

    const loaded = await readDeploymentFile(
      { CODE_ZERO_CONFIG: 'instance.yml' },
      directory,
      'self-hosted',
    );

    expect(loaded.settings).toMatchObject({
      ok: true,
      value: { execution: { maxConcurrentTasks: 2 } },
    });
  });
});

describe('managesOrganizationPolicy', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
    ['member, admin', true],
    ['billing', false],
  ])('answers %j with %j from the organization role definitions', (role, expected) => {
    expect(managesOrganizationPolicy(role)).toBe(expected);
  });
});
