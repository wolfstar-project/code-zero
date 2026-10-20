import { describe, expect, it } from 'vitest';

import { listOpenChangeRequests } from './discovery.js';
import { connectionsFromEnvironment } from './environment.js';
import { ForgeRequestError } from './errors.js';
import { createForgeRegistry, providerSecrets } from './registry.js';
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

// Shaped like nothing the shared redaction patterns know, and absent from `process.env`, so only
// the connection's own credential list can catch it.
const OPAQUE = 'opaque-credential-7f3a91c2';

describe('credentials of environment connections', () => {
  it('registers every credential a variable set carries for redaction', () => {
    const { connections } = connectionsFromEnvironment({
      FORGES_GITHUB_APP_ID: '42',
      FORGES_GITHUB_PRIVATE_KEY: 'line-one\\nline-two',
      FORGES_GITHUB_WEBHOOK_SECRET: `${OPAQUE}-hook`,
      FORGES_AZURE_DEVOPS_TOKEN_WORK: `${OPAQUE}-work`,
      FORGES_AZURE_DEVOPS_ORGANIZATION_WORK: 'acme',
    });
    expect(process.env.FORGES_AZURE_DEVOPS_TOKEN_WORK).toBeUndefined();
    const registry = createForgeRegistry(connections);
    expect(providerSecrets(registry.get('github')!)).toEqual(
      expect.arrayContaining(['line-one\\nline-two', 'line-one\nline-two', `${OPAQUE}-hook`]),
    );
    expect(providerSecrets(registry.get('azure-devops')!)).toEqual([`${OPAQUE}-work`]);
  });

  it('keeps a token a forge echoes back out of the raised error', async () => {
    const echo = async () =>
      new Response(JSON.stringify({ message: 'Not Found', request: OPAQUE }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    const { connections } = connectionsFromEnvironment(
      { FORGES_GITHUB_TOKEN: OPAQUE },
      { fetch: echo },
    );
    const registry = createForgeRegistry(connections);
    const failure = await listOpenChangeRequests(registry, {
      forge: 'github',
      instance: 'github.com',
      owner: 'acme',
      repo: 'app',
    }).catch((error: unknown) => error);
    if (!(failure instanceof ForgeRequestError)) throw new Error('expected a ForgeRequestError');
    expect(failure.message).not.toContain(OPAQUE);
  });
});
