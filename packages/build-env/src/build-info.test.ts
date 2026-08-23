import { describe, expect, it } from 'vitest';

import { normalizeBuildInfo, runtimeBuildInfo, shortenCommit } from './build-info.js';
import type { BuildInfo } from './types.js';

/** What a build that resolved nothing publishes: every revision field is `null`. */
const unresolvedBuild: BuildInfo = {
  version: '0.4.0',
  commit: null,
  branch: null,
  env: 'release',
  time: 1_700_000_000_000,
  prNumber: null,
  previewUrl: null,
  productionUrl: null,
};

/** What a Vercel build publishes: everything resolved while the build ran. */
const resolvedBuild: BuildInfo = {
  ...unresolvedBuild,
  commit: '1234567890abcdef',
  branch: 'main',
};

describe('shortenCommit', () => {
  it('abbreviates to the seven characters every provider UI shows', () => {
    expect(shortenCommit('1234567890abcdef')).toBe('1234567');
  });

  it('passes null through rather than throwing on it', () => {
    expect(shortenCommit(null)).toBeNull();
  });
});

describe('runtimeBuildInfo', () => {
  it('completes a container image from the environment its host starts it with', () => {
    expect(
      runtimeBuildInfo(unresolvedBuild, {
        AGENT_ZERO_BUILD_COMMIT: 'fedcba0987654321',
        AGENT_ZERO_BUILD_BRANCH: 'main',
      }),
    ).toMatchObject({ commit: 'fedcba0987654321', branch: 'main' });
  });

  it('never rewrites a field the build resolved, since the commit is a property of the bundle', () => {
    expect(
      runtimeBuildInfo(resolvedBuild, {
        AGENT_ZERO_BUILD_COMMIT: 'fedcba0987654321',
        AGENT_ZERO_BUILD_BRANCH: 'somewhere-else',
      }),
    ).toMatchObject({ commit: '1234567890abcdef', branch: 'main' });
  });

  it('is a no-op on Vercel, where the build already read the same variables', () => {
    const vercelEnvironment = {
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_GIT_COMMIT_SHA: '1234567890abcdef',
    };
    expect(runtimeBuildInfo(resolvedBuild, vercelEnvironment)).toStrictEqual(resolvedBuild);
  });

  it('lets a host that knows it is serving a preview reclassify a bundle built elsewhere', () => {
    expect(
      runtimeBuildInfo(
        { ...resolvedBuild, branch: 'feat/env' },
        {
          VERCEL_ENV: 'preview',
          VERCEL_GIT_COMMIT_REF: 'feat/env',
          VERCEL_URL: 'agent-zero-abc123.vercel.app',
        },
      ).env,
    ).toBe('preview');
  });

  it('classifies the default branch on a preview channel as the canary', () => {
    expect(
      runtimeBuildInfo(resolvedBuild, {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'main',
      }).env,
    ).toBe('canary');
  });

  it('leaves the classification alone when the host reports no context at all', () => {
    expect(runtimeBuildInfo(resolvedBuild, {}).env).toBe('release');
  });

  it('never revises a development build, whatever variables are in the shell', () => {
    expect(
      runtimeBuildInfo({ ...resolvedBuild, env: 'dev' }, { VERCEL_ENV: 'production' }).env,
    ).toBe('dev');
  });

  it('honours an operator that states outright what the deployment is', () => {
    expect(runtimeBuildInfo(resolvedBuild, { AGENT_ZERO_BUILD_ENV: 'preview' }).env).toBe(
      'preview',
    );
  });

  it('fills the deploy URLs a build off the host could not know', () => {
    expect(
      runtimeBuildInfo(resolvedBuild, {
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'feat/env',
        VERCEL_URL: 'agent-zero-abc123.vercel.app',
      }),
    ).toMatchObject({ previewUrl: 'https://agent-zero-abc123.vercel.app', productionUrl: null });
  });

  it('clears a build-time pull-request number once the host reports this process as production', () => {
    // A container image built for review app #42's preview, later promoted to serve production
    // traffic, must not still claim to be preview #42 once the host says otherwise.
    expect(
      runtimeBuildInfo(
        { ...resolvedBuild, prNumber: '42' },
        { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' },
      ).prNumber,
    ).toBeNull();
  });

  it('keeps a build-time pull-request number when the host reports no production context', () => {
    expect(runtimeBuildInfo({ ...resolvedBuild, prNumber: '42' }, {}).prNumber).toBe('42');
  });

  it('treats the empty strings Nuxt serialises null runtime-config values as, as unresolved', () => {
    // A build published through `runtimeConfig.public` sees its own `null` fields arrive as `''`,
    // not `null`, so the run-time pass must normalize them back before completing anything.
    expect(
      runtimeBuildInfo(
        {
          ...resolvedBuild,
          commit: '',
          branch: '',
          prNumber: '',
          previewUrl: '',
          productionUrl: '',
        },
        {
          AGENT_ZERO_BUILD_COMMIT: 'fedcba0987654321',
          AGENT_ZERO_BUILD_BRANCH: 'feat/env',
          AGENT_ZERO_BUILD_PR_NUMBER: '7',
          AGENT_ZERO_BUILD_ENV: 'preview',
          AGENT_ZERO_BUILD_URL: 'preview.example.com',
        },
      ),
    ).toMatchObject({
      commit: 'fedcba0987654321',
      branch: 'feat/env',
      prNumber: '7',
      previewUrl: 'https://preview.example.com',
    });
  });

  it('clears a stale preview URL once the host reclassifies the deploy as release', () => {
    expect(
      runtimeBuildInfo(
        { ...resolvedBuild, env: 'preview', previewUrl: 'https://old-preview.example.com' },
        { AGENT_ZERO_BUILD_ENV: 'release' },
      ),
    ).toMatchObject({ env: 'release', previewUrl: null });
  });

  it('clears a stale production URL once the host reclassifies the deploy as preview', () => {
    expect(
      runtimeBuildInfo(
        {
          ...resolvedBuild,
          env: 'release',
          productionUrl: 'https://agent-zero.example.com',
        },
        { AGENT_ZERO_BUILD_ENV: 'preview' },
      ),
    ).toMatchObject({ env: 'preview', productionUrl: null });
  });
});

describe('normalizeBuildInfo', () => {
  it('turns every blank nullable field back into null', () => {
    expect(
      normalizeBuildInfo({
        ...resolvedBuild,
        commit: '',
        branch: '',
        prNumber: '',
        previewUrl: '',
        productionUrl: '',
      }),
    ).toMatchObject({
      commit: null,
      branch: null,
      prNumber: null,
      previewUrl: null,
      productionUrl: null,
    });
  });

  it('leaves a resolved build untouched', () => {
    expect(normalizeBuildInfo(resolvedBuild)).toStrictEqual(resolvedBuild);
  });
});
