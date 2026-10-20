import { describe, expect, it } from 'vitest';

import { authEnvironment, deploymentAuthCapabilities } from '../../server/utils/auth-policy.js';

describe('authEnvironment', () => {
  it('fills the dashboard origin from the public site URL, so passkeys bind to this app', () => {
    expect(
      authEnvironment({ NUXT_PUBLIC_SITE_URL: 'https://app.example.test' }).AUTH_DASHBOARD_ORIGIN,
    ).toBe('https://app.example.test');
  });

  it('leaves an explicitly configured dashboard origin alone', () => {
    const environment = {
      AUTH_DASHBOARD_ORIGIN: 'https://console.example.test',
      NUXT_PUBLIC_SITE_URL: 'https://app.example.test',
    };

    expect(authEnvironment(environment)).toBe(environment);
  });
});

describe('deploymentAuthCapabilities', () => {
  it('reads the policy when it is called, so a change needs no rebuild', () => {
    expect(deploymentAuthCapabilities({}).signup).toBe(false);
    expect(deploymentAuthCapabilities({ AUTH_ENABLE_SIGNUP: 'true' }).signup).toBe(true);
  });

  it('offers passkeys once the app knows its own origin', () => {
    expect(deploymentAuthCapabilities({}).passkey).toBe(false);
    expect(deploymentAuthCapabilities({ NODE_ENV: 'development' }).passkey).toBe(true);
  });

  it('serves no enterprise capability without an edition to grant it', () => {
    expect(deploymentAuthCapabilities({ AUTH_ENABLE_ORGANIZATIONS: 'true' })).toMatchObject({
      sso: false,
      scim: false,
    });
  });
});
