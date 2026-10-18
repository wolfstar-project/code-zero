import { describe, expect, it } from 'vitest';

import { connectionsFromEnvironment } from './environment.js';
import { createForgeRegistry } from './registry.js';
import { SECRET, TOKEN } from './test-support/forge-fixture.js';

describe('connectionsFromEnvironment', () => {
  it('builds connections from FORGES_* variables, including suffixed instances', () => {
    const { connections, skipped } = connectionsFromEnvironment({
      FORGES_GITHUB_TOKEN: TOKEN,
      FORGES_GITHUB_WEBHOOK_SECRET: SECRET,
      FORGES_GITHUB_TOKEN_WORK: TOKEN,
      FORGES_GITHUB_BASE_URL_WORK: 'https://ghe.example.com/api/v3',
      FORGES_AZURE_DEVOPS_TOKEN: TOKEN,
      FORGES_AZURE_DEVOPS_ORGANIZATION: 'acme',
      FORGES_BITBUCKET_USERNAME: 'ops@acme.example',
      FORGES_BITBUCKET_PASSWORD: TOKEN,
      UNRELATED: 'ignored',
    });
    expect(skipped).toEqual([]);
    expect(connections.map((connection) => connection.kind).toSorted()).toEqual([
      'azure-devops',
      'bitbucket',
      'github',
      'github',
    ]);
    const registry = createForgeRegistry(connections);
    expect(registry.get('github', 'ghe.example.com')).toBeDefined();
    expect(registry.get('bitbucket')?.authKind).toBe('basic');
  });

  it('reports what it skipped, and why, without a credential', () => {
    const { connections, skipped } = connectionsFromEnvironment({
      FORGES_GITEE_TOKEN: TOKEN,
      FORGES_AZURE_DEVOPS_TOKEN: TOKEN,
    });
    expect(connections).toEqual([]);
    expect(skipped.map((entry) => entry.forge).toSorted()).toEqual(['azure-devops', 'gitee']);
    expect(skipped.find((entry) => entry.forge === 'gitee')?.reason).toBe(
      'Code Zero does not connect to this forge',
    );
    expect(JSON.stringify(skipped)).not.toContain(TOKEN);
  });
});
