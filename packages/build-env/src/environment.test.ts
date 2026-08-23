import { describe, expect, it } from 'vitest';

import {
  deploymentMetadataFromEnvironment,
  envTypeFromMetadata,
  envTypeOverrideFromEnvironment,
  previewUrlFromMetadata,
  productionUrlFromMetadata,
} from './environment.js';

describe('deploymentMetadataFromEnvironment', () => {
  it('reads a Vercel production deploy, adding the scheme its host variables omit', () => {
    expect(
      deploymentMetadataFromEnvironment({
        VERCEL: '1',
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_REF: 'main',
        VERCEL_GIT_COMMIT_SHA: '1234567890abcdef',
        VERCEL_PROJECT_PRODUCTION_URL: 'agent-zero.dev',
        VERCEL_URL: 'agent-zero-abc123.vercel.app',
      }),
    ).toStrictEqual({
      provider: 'vercel',
      branch: 'main',
      commit: '1234567890abcdef',
      prNumber: null,
      deployUrl: 'https://agent-zero-abc123.vercel.app',
      productionUrl: 'https://agent-zero.dev',
      context: 'production',
    });
  });

  it('reads a Netlify pull-request deploy', () => {
    expect(
      deploymentMetadataFromEnvironment({
        NETLIFY: 'true',
        CONTEXT: 'deploy-preview',
        BRANCH: 'feat/env',
        COMMIT_REF: 'abcdef1234567890',
        REVIEW_ID: '42',
        DEPLOY_PRIME_URL: 'https://deploy-preview-42--agent-zero.netlify.app',
        URL: 'https://agent-zero.netlify.app',
      }),
    ).toMatchObject({
      provider: 'netlify',
      branch: 'feat/env',
      prNumber: '42',
      deployUrl: 'https://deploy-preview-42--agent-zero.netlify.app',
      context: 'preview',
    });
  });

  it('reads a Cloudflare Pages branch deploy', () => {
    expect(
      deploymentMetadataFromEnvironment({
        CF_PAGES: '1',
        CF_PAGES_BRANCH: 'feat/env',
        CF_PAGES_COMMIT_SHA: 'fedcba0987654321',
        CF_PAGES_URL: 'https://abc123.agent-zero.pages.dev',
      }),
    ).toMatchObject({
      provider: 'cloudflare-pages',
      branch: 'feat/env',
      commit: 'fedcba0987654321',
      context: 'preview',
    });
  });

  it('classifies a Cloudflare Pages deploy on the caller-configured default branch as production', () => {
    expect(
      deploymentMetadataFromEnvironment(
        { CF_PAGES: '1', CF_PAGES_BRANCH: 'trunk', CF_PAGES_COMMIT_SHA: 'fedcba0987654321' },
        'trunk',
      ),
    ).toMatchObject({ context: 'production' });

    // The module default (`main`) must not leak in once a caller configures a different one: the
    // real production branch would otherwise still read as a preview.
    expect(
      deploymentMetadataFromEnvironment(
        { CF_PAGES: '1', CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: 'fedcba0987654321' },
        'trunk',
      ),
    ).toMatchObject({ context: 'preview' });
  });

  it('recovers the pull-request number a GitHub Actions run only carries in its ref', () => {
    expect(
      deploymentMetadataFromEnvironment({
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: 'refs/pull/17/merge',
        GITHUB_REF_NAME: '17/merge',
        GITHUB_SHA: '0f0f0f0f0f0f0f0f',
      }),
    ).toMatchObject({ provider: 'github-actions', prNumber: '17', commit: '0f0f0f0f0f0f0f0f' });
  });

  it('prefers GITHUB_HEAD_REF over GITHUB_REF_NAME, since the latter is "<pr>/merge" on a pull_request event', () => {
    expect(
      deploymentMetadataFromEnvironment({
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: 'refs/pull/17/merge',
        GITHUB_REF_NAME: '17/merge',
        GITHUB_HEAD_REF: 'feat/env',
        GITHUB_SHA: '0f0f0f0f0f0f0f0f',
      }),
    ).toMatchObject({ branch: 'feat/env' });
  });

  it('falls back to GITHUB_REF_NAME on a push, where GITHUB_HEAD_REF is unset', () => {
    expect(
      deploymentMetadataFromEnvironment({
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: '0f0f0f0f0f0f0f0f',
      }),
    ).toMatchObject({ branch: 'main' });
  });

  it('lets an explicit self-hosted deployment override a provider that would be auto-detected', () => {
    expect(
      deploymentMetadataFromEnvironment({
        VERCEL: '1',
        VERCEL_GIT_COMMIT_SHA: 'from-vercel',
        AGENT_ZERO_BUILD_COMMIT: 'from-operator',
      }),
    ).toMatchObject({ provider: 'self-hosted', commit: 'from-operator' });
  });

  it('detects the self-hosted provider from the production URL alone, so it is not silently discarded', () => {
    expect(
      deploymentMetadataFromEnvironment({
        AGENT_ZERO_BUILD_PRODUCTION_URL: 'agent-zero.example.com',
      }),
    ).toMatchObject({ provider: 'self-hosted', productionUrl: 'https://agent-zero.example.com' });
  });

  it('preserves an explicit http scheme rather than upgrading a deliberately TLS-less deploy', () => {
    expect(
      deploymentMetadataFromEnvironment({ AGENT_ZERO_BUILD_URL: 'http://internal.example.com' }),
    ).toMatchObject({ deployUrl: 'http://internal.example.com' });
  });

  it('treats a variable that is set but blank as absent, so it never wins precedence', () => {
    expect(deploymentMetadataFromEnvironment({ AGENT_ZERO_BUILD_COMMIT: '   ' })).toMatchObject({
      provider: 'none',
    });
  });

  it('reports nothing when no provider recognises the environment', () => {
    expect(deploymentMetadataFromEnvironment({})).toMatchObject({
      provider: 'none',
      branch: null,
      commit: null,
      context: null,
    });
  });
});

describe('envTypeFromMetadata', () => {
  const metadata = deploymentMetadataFromEnvironment({});

  it('classifies a developer machine as dev whatever the environment says', () => {
    expect(
      envTypeFromMetadata(deploymentMetadataFromEnvironment({ VERCEL_ENV: 'production' }), {
        isDevelopment: true,
      }),
    ).toBe('dev');
  });

  it('classifies a pull-request deploy as preview whatever branch it is on', () => {
    expect(
      envTypeFromMetadata(
        deploymentMetadataFromEnvironment({
          VERCEL_ENV: 'production',
          VERCEL_GIT_COMMIT_REF: 'main',
          VERCEL_GIT_PULL_REQUEST_ID: '9',
        }),
        { isDevelopment: false },
      ),
    ).toBe('preview');
  });

  it('classifies the default branch outside a pull request as the canary', () => {
    expect(
      envTypeFromMetadata(
        deploymentMetadataFromEnvironment({
          VERCEL_ENV: 'preview',
          VERCEL_GIT_COMMIT_REF: 'main',
        }),
        { isDevelopment: false },
      ),
    ).toBe('canary');
  });

  it('honours a project whose default branch is not main', () => {
    expect(
      envTypeFromMetadata(
        deploymentMetadataFromEnvironment({
          VERCEL_ENV: 'preview',
          VERCEL_GIT_COMMIT_REF: 'trunk',
        }),
        { isDevelopment: false, defaultBranch: 'trunk' },
      ),
    ).toBe('canary');
  });

  it('classifies any other preview branch as a preview', () => {
    expect(
      envTypeFromMetadata(
        deploymentMetadataFromEnvironment({
          VERCEL_ENV: 'preview',
          VERCEL_GIT_COMMIT_REF: 'feat/env',
        }),
        { isDevelopment: false },
      ),
    ).toBe('preview');
  });

  it('classifies a build no provider recognises as a release rather than inventing a channel', () => {
    expect(envTypeFromMetadata(metadata, { isDevelopment: false })).toBe('release');
  });
});

describe('envTypeOverrideFromEnvironment', () => {
  it('accepts the four names a deployment may declare itself as', () => {
    expect(envTypeOverrideFromEnvironment({ AGENT_ZERO_BUILD_ENV: 'preview' })).toBe('preview');
  });

  it('ignores an unrecognised value rather than publishing it', () => {
    expect(envTypeOverrideFromEnvironment({ AGENT_ZERO_BUILD_ENV: 'staging' })).toBeNull();
    expect(envTypeOverrideFromEnvironment({})).toBeNull();
  });
});

describe('previewUrlFromMetadata and productionUrlFromMetadata', () => {
  const preview = deploymentMetadataFromEnvironment({
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'agent-zero-abc123.vercel.app',
  });
  const production = deploymentMetadataFromEnvironment({
    VERCEL_ENV: 'production',
    VERCEL_URL: 'agent-zero-abc123.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'agent-zero.dev',
  });

  it('reports the deploy URL as a preview URL only outside a release', () => {
    expect(previewUrlFromMetadata(preview, 'preview')).toBe('https://agent-zero-abc123.vercel.app');
    expect(previewUrlFromMetadata(production, 'release')).toBeNull();
  });

  it('reports the production domain only for the deploy that serves it', () => {
    expect(productionUrlFromMetadata(production, 'release')).toBe('https://agent-zero.dev');
    expect(productionUrlFromMetadata(preview, 'preview')).toBeNull();
  });
});
