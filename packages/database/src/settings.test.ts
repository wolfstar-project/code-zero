import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { member, organization, schema, user } from './schema/index.js';
import {
  organizationMemberRole,
  readDeploymentSettings,
  readOrganizationSettings,
  saveDeploymentSettings,
  saveOrganizationSettings,
} from './settings.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const SINGLETON_VIOLATION = /deployment_setting_singleton/;

/**
 * An in-memory Postgres (PGlite) migrated with the checked-in migrations, so these tests read and
 * write through the same SQL a deployment runs, constraints included. PGlite reaches this package
 * as a peer `drizzle-orm` already resolved; nothing here opens a socket.
 */
const database = drizzle({ schema });

beforeAll(async () => {
  await migrate(database, { migrationsFolder: MIGRATIONS });
  await database.insert(user).values([
    { id: 'u-owner', name: 'Owner', email: 'owner@example.test' },
    { id: 'u-outsider', name: 'Outsider', email: 'outsider@example.test' },
  ]);
  await database.insert(organization).values([
    { id: 'org-a', name: 'A', slug: 'a' },
    { id: 'org-b', name: 'B', slug: 'b' },
  ]);
  await database.insert(member).values({
    id: 'm-1',
    organizationId: 'org-a',
    userId: 'u-owner',
    role: 'owner',
  });
}, 60_000);

afterAll(async () => {
  await database.$client.close();
});

describe('deployment settings', () => {
  it('reads nothing before the dashboard has saved anything', async () => {
    await expect(readDeploymentSettings(database)).resolves.toBeNull();
  });

  it('keeps the latest saved document and who saved it', async () => {
    await saveDeploymentSettings(
      database,
      { execution: { max_concurrent_tasks: 2 } },
      'ops@example.test',
    );
    await saveDeploymentSettings(
      database,
      { execution: { max_concurrent_tasks: 3 } },
      'admin@example.test',
    );

    await expect(readDeploymentSettings(database)).resolves.toMatchObject({
      document: { execution: { max_concurrent_tasks: 3 } },
      updatedBy: 'admin@example.test',
    });
  });

  it('refuses a second settings row at the database, not only in this package', async () => {
    await expect(
      database.$client.query(
        `insert into deployment_setting (id, document, updated_by) values ('other', '{}', 'x')`,
      ),
    ).rejects.toThrow(SINGLETON_VIOLATION);
  });
});

describe('organization settings', () => {
  it('keeps each organization to its own row', async () => {
    await saveOrganizationSettings(
      database,
      'org-a',
      { max_concurrent_tasks: 1 },
      'owner@example.test',
    );

    await expect(readOrganizationSettings(database, 'org-a')).resolves.toMatchObject({
      document: { max_concurrent_tasks: 1 },
    });
    await expect(readOrganizationSettings(database, 'org-b')).resolves.toBeNull();
  });

  it('removes the limits with the organization', async () => {
    await saveOrganizationSettings(database, 'org-b', { max_run_minutes: 5 }, 'owner@example.test');
    await database.$client.query(`delete from organization where id = 'org-b'`);

    await expect(readOrganizationSettings(database, 'org-b')).resolves.toBeNull();
  });
});

describe('organizationMemberRole', () => {
  it('answers with the role a member holds', async () => {
    await expect(organizationMemberRole(database, 'org-a', 'u-owner')).resolves.toBe('owner');
  });

  it('answers null for an account outside the organization', async () => {
    await expect(organizationMemberRole(database, 'org-a', 'u-outsider')).resolves.toBeNull();
  });
});
