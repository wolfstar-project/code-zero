import { describe, expect, it } from 'vitest';

import {
  checkoutPathFromEnvironment,
  dashboardUrlFromEnvironment,
  githubWebhookSecretFromEnvironment,
  pollIntervalFromEnvironment,
  pollModeFromEnvironment,
  watchedRepositoriesFromEnvironment,
} from '../../server/utils/environment.js';

describe('dashboardUrlFromEnvironment', () => {
  it('uses the local Nuxt origin in development when no public site URL is configured', () => {
    expect(dashboardUrlFromEnvironment({ NODE_ENV: 'development' })).toBe('http://localhost:3000');
  });

  it('prefers the configured public site URL in development', () => {
    expect(
      dashboardUrlFromEnvironment({
        NODE_ENV: 'development',
        NUXT_PUBLIC_SITE_URL: ' https://dashboard.example.com ',
      }),
    ).toBe('https://dashboard.example.com');
  });

  it('does not invent a public origin outside development', () => {
    expect(dashboardUrlFromEnvironment({ NODE_ENV: 'production' })).toBeUndefined();
  });
});

describe('githubWebhookSecretFromEnvironment', () => {
  it('reads the configured webhook secret verbatim, since GitHub signs with those exact bytes', () => {
    expect(githubWebhookSecretFromEnvironment({ GITHUB_WEBHOOK_SECRET: ' shh ' })).toBe(' shh ');
  });

  it('treats an absent or empty secret as unconfigured so the route fails closed', () => {
    expect(githubWebhookSecretFromEnvironment({})).toBeUndefined();
    expect(githubWebhookSecretFromEnvironment({ GITHUB_WEBHOOK_SECRET: '' })).toBeUndefined();
  });
});

describe('checkoutPathFromEnvironment', () => {
  it('reads the configured checkout path', () => {
    expect(checkoutPathFromEnvironment({ CODE_ZERO_CHECKOUT_PATH: ' /srv/checkout ' })).toBe(
      '/srv/checkout',
    );
  });

  it('treats an absent or blank path as unconfigured so the route fails closed', () => {
    expect(checkoutPathFromEnvironment({})).toBeUndefined();
    expect(checkoutPathFromEnvironment({ CODE_ZERO_CHECKOUT_PATH: '  ' })).toBeUndefined();
  });
});

describe('watchedRepositoriesFromEnvironment', () => {
  it('pairs each provider repository with the checkout a run may execute against', () => {
    expect(
      watchedRepositoriesFromEnvironment({
        CODE_ZERO_POLL_REPOSITORIES: ' acme/app=/srv/checkouts/app , acme/billing=/srv/billing ',
      }),
    ).toEqual([
      { owner: 'acme', repo: 'app', checkoutPath: '/srv/checkouts/app' },
      { owner: 'acme', repo: 'billing', checkoutPath: '/srv/billing' },
    ]);
  });

  it('drops an entry that names no checkout, rather than inventing one', () => {
    // Deriving a path from the slug is exactly how a run ends up pointed somewhere nobody named.
    expect(
      watchedRepositoriesFromEnvironment({
        CODE_ZERO_POLL_REPOSITORIES: 'acme/app,acme/billing=/srv/billing,=/srv/orphan,acme=/srv/x',
      }),
    ).toEqual([{ owner: 'acme', repo: 'billing', checkoutPath: '/srv/billing' }]);
  });

  it('watches nothing when the variable is absent or empty', () => {
    expect(watchedRepositoriesFromEnvironment({})).toEqual([]);
    expect(watchedRepositoriesFromEnvironment({ CODE_ZERO_POLL_REPOSITORIES: '  ' })).toEqual([]);
  });
});

describe('pollIntervalFromEnvironment', () => {
  it('defaults to a minute and clamps what a deployment asks for', () => {
    expect(pollIntervalFromEnvironment({})).toBe(60);
    expect(pollIntervalFromEnvironment({ CODE_ZERO_POLL_INTERVAL_SECONDS: '120' })).toBe(120);
    // Below the floor a pass spends more rate limit than it earns; above the ceiling it is not
    // polling any more.
    expect(pollIntervalFromEnvironment({ CODE_ZERO_POLL_INTERVAL_SECONDS: '1' })).toBe(15);
    expect(pollIntervalFromEnvironment({ CODE_ZERO_POLL_INTERVAL_SECONDS: '99999' })).toBe(3_600);
    expect(pollIntervalFromEnvironment({ CODE_ZERO_POLL_INTERVAL_SECONDS: 'soon' })).toBe(60);
  });
});

describe('pollModeFromEnvironment', () => {
  it('polls in the mode that cannot write to a checkout unless told otherwise', () => {
    expect(pollModeFromEnvironment({})).toBe('observe');
    expect(pollModeFromEnvironment({ CODE_ZERO_POLL_MODE: 'suggest' })).toBe('suggest');
    // Anything else, including the writable modes, is refused here rather than at the runner.
    expect(pollModeFromEnvironment({ CODE_ZERO_POLL_MODE: 'fix' })).toBe('observe');
    expect(pollModeFromEnvironment({ CODE_ZERO_POLL_MODE: 'autonomous' })).toBe('observe');
  });
});
