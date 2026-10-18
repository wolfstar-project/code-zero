import { github } from 'forges/github';
import { describe, expect, it } from 'vitest';

import type { ForgeConnection } from './connections.js';
import { createForgeRegistry } from './registry.js';
import { SECRET, TOKEN } from './test-support/forge-fixture.js';
import { forgeFixtures } from './test-support/forges/index.js';

const connections = forgeFixtures.map((fixture) => fixture.connection);

describe('createForgeRegistry', () => {
  it('registers one provider per connection and routes by forge and instance', () => {
    const registry = createForgeRegistry(connections);
    expect(registry.list().map((entry) => entry.kind)).toEqual([
      'github',
      'gitlab',
      'gitea',
      'forgejo',
      'bitbucket',
      'azure-devops',
    ]);
    expect(registry.get('gitea', 'gitea.example.com')?.baseUrl).toBe(
      'https://gitea.example.com/api/v1',
    );
    expect(registry.get('github', 'ghe.example.com')).toBeUndefined();
  });

  it('lists connections without their credentials', () => {
    const listed = JSON.stringify(createForgeRegistry(connections).list());
    expect(listed).not.toContain(TOKEN);
    expect(listed).not.toContain(SECRET);
    expect(listed).toContain('"authKind":"basic"');
  });

  it('keeps a self-hosted instance apart from the public one', () => {
    const registry = createForgeRegistry([
      { kind: 'github', instance: 'github.com', auth: { type: 'token', token: TOKEN } },
      {
        kind: 'github',
        instance: 'ghe.example.com',
        baseUrl: 'https://ghe.example.com/api/v3',
        auth: { type: 'token', token: TOKEN },
      },
    ]);
    expect(registry.get('github', 'ghe.example.com')?.baseUrl).toBe(
      'https://ghe.example.com/api/v3',
    );
    expect(registry.get('github', 'github.com')?.baseUrl).toBe('https://api.github.com');
  });

  it('refuses two connections to the same instance', () => {
    expect(() =>
      createForgeRegistry([
        { kind: 'gitlab', instance: 'gitlab.com', auth: { type: 'token', token: TOKEN } },
        { kind: 'gitlab', instance: 'gitlab.com', auth: { type: 'token', token: `${TOKEN}2` } },
      ]),
    ).toThrow('Two providers are registered for gitlab on gitlab.com');
  });

  it('refuses malformed connections without echoing a credential', () => {
    // Rows from a database arrive as untyped JSON; the registry checks them again at runtime.
    const malformed: ForgeConnection[] = JSON.parse(
      JSON.stringify([
        { kind: 'gitee', instance: 'gitee.com', auth: { type: 'token', token: TOKEN } },
        { kind: 'gitlab', instance: ' ', auth: { type: 'token', token: TOKEN } },
        { kind: 'gitlab', instance: 'gitlab.com', auth: { type: 'token', token: '' } },
        {
          kind: 'gitlab',
          instance: 'gitlab.com',
          auth: { type: 'basic', username: 'u', password: TOKEN },
        },
        {
          kind: 'azure-devops',
          instance: 'dev.azure.com',
          organization: '',
          auth: { type: 'token', token: TOKEN },
        },
      ]),
    );
    for (const connection of malformed) {
      let message = '';
      try {
        createForgeRegistry([connection]);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(TOKEN);
    }
  });

  it('accepts a prepared factory only for the forge it builds', () => {
    const factory = github({ auth: { type: 'token', token: TOKEN } });
    expect(createForgeRegistry([{ kind: 'github', factory, secrets: [] }]).list()).toHaveLength(1);
    expect(() => createForgeRegistry([{ kind: 'gitlab', factory, secrets: [] }])).toThrow(
      'builds a github provider',
    );
  });
});
