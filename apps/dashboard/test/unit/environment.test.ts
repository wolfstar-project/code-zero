import { describe, expect, it } from 'vitest';

import {
  checkoutPathFromEnvironment,
  dashboardUrlFromEnvironment,
  githubWebhookSecretFromEnvironment,
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
