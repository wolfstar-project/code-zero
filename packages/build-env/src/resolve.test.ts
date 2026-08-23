import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { packageVersion, resolveBuildInfo } from './resolve.js';

/** A directory that is not a checkout, so nothing here can read the repository it runs in. */
let rootDirectory: string;

beforeAll(async () => {
  rootDirectory = await mkdtemp(join(tmpdir(), 'agent-zero-build-env-'));
  await writeFile(join(rootDirectory, 'package.json'), JSON.stringify({ version: '1.2.3' }));
});

describe('packageVersion', () => {
  it('reads the version of the package being built', async () => {
    await expect(packageVersion(rootDirectory)).resolves.toBe('1.2.3');
  });

  it('falls back rather than failing a build that has no readable manifest', async () => {
    await expect(packageVersion(join(rootDirectory, 'missing'))).resolves.toBe('0.0.0');
  });
});

describe('resolveBuildInfo', () => {
  it('resolves a Vercel production build entirely from the environment', async () => {
    await expect(
      resolveBuildInfo({
        rootDirectory,
        isDevelopment: false,
        now: 1_700_000_000_000,
        environment: {
          VERCEL: '1',
          VERCEL_ENV: 'production',
          VERCEL_GIT_COMMIT_REF: 'main',
          VERCEL_GIT_COMMIT_SHA: '1234567890abcdef',
          VERCEL_PROJECT_PRODUCTION_URL: 'agent-zero.dev',
        },
      }),
    ).resolves.toStrictEqual({
      version: '1.2.3',
      commit: '1234567890abcdef',
      branch: 'main',
      env: 'release',
      time: 1_700_000_000_000,
      prNumber: null,
      previewUrl: null,
      productionUrl: 'https://agent-zero.dev',
    });
  });

  it('leaves what it could not resolve as null, rather than guessing', async () => {
    await expect(
      resolveBuildInfo({
        rootDirectory,
        isDevelopment: false,
        now: 1_700_000_000_000,
        // Names the branch but not the commit, so only the commit is left for the run-time pass.
        environment: { AGENT_ZERO_BUILD_BRANCH: 'main' },
        readGitMetadata: () => Promise.resolve({ branch: null, commit: null }),
      }),
    ).resolves.toMatchObject({
      branch: 'main',
      commit: null,
      env: 'release',
    });
  });

  it('classifies a development build as dev even with a production environment in scope', async () => {
    await expect(
      resolveBuildInfo({
        rootDirectory,
        isDevelopment: true,
        now: 0,
        environment: { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: '1234567890abcdef' },
      }),
    ).resolves.toMatchObject({ env: 'dev' });
  });
});
