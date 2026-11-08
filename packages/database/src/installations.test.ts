import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  attachInstallation,
  InstallationAlreadyAttachedError,
  InstallationNotFoundError,
  listInstallations,
  listOrganizationRepositories,
  removeOrganizationRepository,
  selectRepositories,
  setInstallationSuspended,
} from './installations.js';
import { organization, schema, user } from './schema/index.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const UNSUPPORTED_MODE = /mode/;

/** The same in-memory Postgres, migrated with the checked-in migrations, as `settings.test.ts`. */
const database = drizzle({ schema });

const acme = {
  organizationId: 'org-a',
  externalId: '1001',
  accountLogin: 'acme',
  accountType: 'Organization',
  createdByUserId: 'u-owner',
};

beforeAll(async () => {
  await migrate(database, { migrationsFolder: MIGRATIONS });
  await database.insert(user).values({ id: 'u-owner', name: 'Owner', email: 'owner@example.test' });
  await database.insert(organization).values([
    { id: 'org-a', name: 'A', slug: 'a' },
    { id: 'org-b', name: 'B', slug: 'b' },
  ]);
}, 60_000);

afterAll(async () => {
  await database.$client.close();
});

describe('attachInstallation', () => {
  it('attaches an installation to an organization', async () => {
    const installation = await attachInstallation(database, acme);

    expect(installation).toMatchObject({
      organizationId: 'org-a',
      provider: 'github',
      externalId: '1001',
      accountLogin: 'acme',
      suspended: false,
    });
    await expect(listInstallations(database, 'org-a')).resolves.toHaveLength(1);
  });

  it('is idempotent for the organization that already holds it', async () => {
    const first = await attachInstallation(database, acme);
    const again = await attachInstallation(database, { ...acme, accountLogin: 'acme-renamed' });

    expect(again.id).toBe(first.id);
    expect(again.accountLogin).toBe('acme-renamed');
    await expect(listInstallations(database, 'org-a')).resolves.toHaveLength(1);
  });

  it('refuses an installation another organization already holds', async () => {
    await expect(
      attachInstallation(database, { ...acme, organizationId: 'org-b' }),
    ).rejects.toBeInstanceOf(InstallationAlreadyAttachedError);
    await expect(listInstallations(database, 'org-b')).resolves.toEqual([]);
  });

  it('keeps the same external id apart across providers', async () => {
    const other = await attachInstallation(database, {
      ...acme,
      organizationId: 'org-b',
      provider: 'gitlab',
    });

    expect(other.provider).toBe('gitlab');
  });
});

describe('setInstallationSuspended', () => {
  it('records and clears a suspension', async () => {
    await setInstallationSuspended(database, 'github', '1001', true);
    await expect(listInstallations(database, 'org-a')).resolves.toMatchObject([
      { suspended: true },
    ]);

    await setInstallationSuspended(database, 'github', '1001', false);
    await expect(listInstallations(database, 'org-a')).resolves.toMatchObject([
      { suspended: false },
    ]);
  });

  it('ignores an installation it does not know', async () => {
    await expect(setInstallationSuspended(database, 'github', 'nope', true)).resolves.toBe(false);
  });
});

describe('selectRepositories', () => {
  const [first, second] = [
    { externalId: '501', owner: 'acme', name: 'api' },
    { externalId: '502', owner: 'acme', name: 'web' },
  ];

  it('selects the chosen repositories in observe mode by default', async () => {
    const [installation] = await listInstallations(database, 'org-a');
    if (!installation) throw new Error('fixture installation missing');

    const saved = await selectRepositories(database, {
      organizationId: 'org-a',
      installationId: installation.id,
      repositories: [first, second],
    });

    expect(saved.map((r) => `${r.owner}/${r.name}:${r.mode}`)).toEqual([
      'acme/api:observe',
      'acme/web:observe',
    ]);
  });

  it('updates the mode of a repository that is already selected, without duplicating it', async () => {
    const [installation] = await listInstallations(database, 'org-a');
    if (!installation) throw new Error('fixture installation missing');

    await selectRepositories(database, {
      organizationId: 'org-a',
      installationId: installation.id,
      repositories: [{ ...first, mode: 'suggest' }],
    });

    const repositories = await listOrganizationRepositories(database, 'org-a');
    expect(repositories).toHaveLength(2);
    expect(repositories.find((r) => r.name === 'api')?.mode).toBe('suggest');
  });

  it('refuses a writable mode', async () => {
    const [installation] = await listInstallations(database, 'org-a');
    if (!installation) throw new Error('fixture installation missing');

    await expect(
      selectRepositories(database, {
        organizationId: 'org-a',
        installationId: installation.id,
        // oxlint-disable-next-line no-unsafe-type-assertion -- deliberately invalid input under test
        repositories: [{ ...first, mode: 'fix' as 'observe' }],
      }),
    ).rejects.toThrow(UNSUPPORTED_MODE);
  });

  it("refuses an installation that belongs to another organization's account", async () => {
    const [installation] = await listInstallations(database, 'org-a');
    if (!installation) throw new Error('fixture installation missing');

    await expect(
      selectRepositories(database, {
        organizationId: 'org-b',
        installationId: installation.id,
        repositories: [first],
      }),
    ).rejects.toBeInstanceOf(InstallationNotFoundError);
    await expect(listOrganizationRepositories(database, 'org-b')).resolves.toEqual([]);
  });
});

describe('removeOrganizationRepository', () => {
  it('removes a repository only from its own organization', async () => {
    const [repository] = await listOrganizationRepositories(database, 'org-a');
    if (!repository) throw new Error('fixture repository missing');

    await expect(removeOrganizationRepository(database, 'org-b', repository.id)).resolves.toBe(
      false,
    );
    await expect(removeOrganizationRepository(database, 'org-a', repository.id)).resolves.toBe(
      true,
    );
    await expect(listOrganizationRepositories(database, 'org-a')).resolves.toHaveLength(1);
  });
});
