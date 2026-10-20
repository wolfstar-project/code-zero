import { describe, expect, it } from 'vitest';

import { createForgeRegistry } from './registry.js';
import { forgeFixtures } from './test-support/forges/index.js';

describe('forge capabilities', () => {
  // The matrix docs/source-control-providers.md documents. A `forges` upgrade that changes it
  // fails here first, so the documentation is updated with the dependency.
  it('match the documented matrix for the six forges', () => {
    const registry = createForgeRegistry(forgeFixtures.map((fixture) => fixture.connection));
    const matrix = Object.fromEntries(
      registry.list().map(({ kind, capabilities }) => {
        const { forge: _forge, ...levels } = capabilities;
        return [kind, levels];
      }),
    );
    const everywhere = {
      webhooks: 'native',
      changeRequestReads: 'native',
      discovery: 'native',
      statusReporting: 'native',
      changeRequestComments: 'native',
      stableComments: 'emulated',
      commitFiles: 'unsupported',
      pullRequestCreation: 'native',
    };
    expect(matrix).toEqual({
      github: { ...everywhere, issueReads: 'native', issueComments: 'native' },
      gitlab: { ...everywhere, issueReads: 'native', issueComments: 'native' },
      gitea: { ...everywhere, issueReads: 'native', issueComments: 'native' },
      forgejo: { ...everywhere, issueReads: 'native', issueComments: 'native' },
      bitbucket: { ...everywhere, issueReads: 'unsupported', issueComments: 'unsupported' },
      'azure-devops': { ...everywhere, issueReads: 'native', issueComments: 'experimental' },
    });
  });

  it('report every write unsupported on a read-only connection', () => {
    const [fixture] = forgeFixtures;
    if (!fixture) throw new Error('missing fixture');
    const [entry] = createForgeRegistry([{ ...fixture.connection, readOnly: true }]).list();
    expect(entry?.capabilities).toMatchObject({
      changeRequestReads: 'native',
      statusReporting: 'unsupported',
      changeRequestComments: 'unsupported',
      pullRequestCreation: 'unsupported',
    });
  });
});
