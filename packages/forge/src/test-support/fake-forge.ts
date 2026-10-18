import type { ForgeProvider, ForgeProviderFactory } from 'forges';
import { fake, type FakeForgeFactory, type FakeOptions } from 'forges/fake';

import type { CommitFilesInput } from '../commit-files.js';
import type { ChangeRequestRef } from '../contracts.js';
import { createForgeRegistry, type ForgeRegistry } from '../registry.js';
import { HEAD, type ForgeFixture } from './forge-fixture.js';

/**
 * An in-memory forge that behaves like the fixture's real one.
 *
 * It copies the capabilities a real provider for the same connection declares, so every fallback
 * path a forge forces on Code Zero runs here too. `acme/app` holds change request 7 and issue 9.
 */
export function fakeForge(
  fixture: ForgeFixture,
  options: Pick<FakeOptions, 'support' | 'readOnly'> = {},
): FakeForgeFactory {
  const real = createForgeRegistry([fixture.connection]).get(fixture.kind, fixture.instance);
  if (!real) throw new Error(`no provider for ${fixture.kind}`);
  return fake({
    forge: fixture.kind,
    instance: fixture.instance,
    capabilities: real.capabilities,
    ...options,
    seed: {
      repos: [{ repo: 'acme/app', defaultBranch: 'main' }],
      threads: [
        { repo: 'acme/app', kind: 'pull_request', number: 7, title: 'Fix the loader' },
        { repo: 'acme/app', kind: 'issue', number: 9, title: 'The loader crashes' },
      ],
    },
  });
}

export function fakeRegistry(
  factory: ForgeProviderFactory,
  kind: ForgeFixture['kind'],
): ForgeRegistry {
  return createForgeRegistry([{ kind, factory }]);
}

/** The fake's change request 7, as a run would name it. */
export function fakeChangeRequest(fixture: ForgeFixture): ChangeRequestRef {
  return {
    forge: fixture.kind,
    instance: fixture.instance,
    owner: 'acme',
    repo: 'app',
    number: 7,
    headSha: HEAD,
  };
}

/**
 * The provider with `contents.commitFiles()` as forges.link documents it, which the 0.1 release
 * does not ship yet, so the supported publication path can be exercised before it does.
 */
export function withCommitFiles(factory: ForgeProviderFactory): {
  factory: ForgeProviderFactory;
  commits: CommitFilesInput[];
} {
  const commits: CommitFilesInput[] = [];
  return {
    commits,
    factory: {
      forge: factory.forge,
      create: (): ForgeProvider => {
        const provider = factory.create();
        // Built apart from the provider literal: the 0.1 types know no `commitFiles` member.
        const declared = { ...provider.capabilities.contents, commitFiles: true };
        const contents = {
          ...provider.contents,
          commitFiles: async (_repo: unknown, input: CommitFilesInput) => {
            commits.push(input);
            return { sha: 'e'.repeat(40) };
          },
        };
        return {
          ...provider,
          capabilities: { ...provider.capabilities, contents: declared },
          contents,
        };
      },
    },
  };
}
