import { describe, expect, it } from 'vitest';

import {
  authCapabilities,
  authConfigFromEnvironment,
  defaultAuthConfig,
  githubCredentialsFromEnvironment,
  gitlabCredentialsFromEnvironment,
  googleCredentialsFromEnvironment,
  infraFromEnvironment,
  MINIMUM_PASSWORD_LENGTH,
  oauthProxyFromEnvironment,
  passkeyFromEnvironment,
  scimFromEnvironment,
} from './config.js';

describe('defaultAuthConfig', () => {
  it('starts closed to registration and social login', () => {
    expect(defaultAuthConfig.enableSignup).toBe(false);
    expect(defaultAuthConfig.enableGithubOauth).toBe(false);
    expect(defaultAuthConfig.enablePasswordLogin).toBe(true);
    expect(defaultAuthConfig.minimumPasswordLength).toBe(MINIMUM_PASSWORD_LENGTH);
  });

  it('starts closed to the device flow, which mints a session for a browserless client', () => {
    expect(defaultAuthConfig.enableDeviceAuthorization).toBe(false);
  });

  it('starts closed to the hosted infrastructure, which reports events to a third party', () => {
    expect(defaultAuthConfig.enableInfra).toBe(false);
  });
});

describe('infraFromEnvironment', () => {
  const complete = {
    BETTER_AUTH_API_URL: 'https://dash.example.test',
    BETTER_AUTH_KV_URL: 'https://kv.example.test',
    BETTER_AUTH_API_KEY: 'project-key',
  };

  it('returns the credentials when all three are present', () => {
    expect(infraFromEnvironment(complete)).toEqual({
      apiUrl: 'https://dash.example.test',
      kvUrl: 'https://kv.example.test',
      apiKey: 'project-key',
    });
  });

  it('fails closed when any one is missing, so a self-hosted install registers neither plugin', () => {
    for (const omitted of Object.keys(complete)) {
      const partial = Object.fromEntries(
        Object.entries(complete).filter(([key]) => key !== omitted),
      );
      expect(infraFromEnvironment(partial)).toBeUndefined();
    }
    expect(infraFromEnvironment({})).toBeUndefined();
  });
});

describe('oauthProxyFromEnvironment', () => {
  it('returns the settings when both halves are present', () => {
    expect(
      oauthProxyFromEnvironment({
        OAUTH_PROXY_PRODUCTION_URL: 'https://app.example.test',
        OAUTH_PROXY_SECRET: 'shared-secret',
      }),
    ).toEqual({ productionUrl: 'https://app.example.test', secret: 'shared-secret' });
  });

  it('fails closed when only one half is configured', () => {
    expect(
      oauthProxyFromEnvironment({ OAUTH_PROXY_PRODUCTION_URL: 'https://app.example.test' }),
    ).toBeUndefined();
    expect(oauthProxyFromEnvironment({ OAUTH_PROXY_SECRET: 'shared-secret' })).toBeUndefined();
    expect(oauthProxyFromEnvironment({})).toBeUndefined();
  });
});

describe('githubCredentialsFromEnvironment', () => {
  it('returns credentials when both halves are present', () => {
    const credentials = githubCredentialsFromEnvironment({
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
    });

    expect(credentials).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' });
  });

  it('fails closed when only one half is configured', () => {
    expect(githubCredentialsFromEnvironment({ GITHUB_CLIENT_ID: 'client-id' })).toBeUndefined();
    expect(
      githubCredentialsFromEnvironment({ GITHUB_CLIENT_SECRET: 'client-secret' }),
    ).toBeUndefined();
  });

  it('treats blank values as absent', () => {
    expect(
      githubCredentialsFromEnvironment({ GITHUB_CLIENT_ID: '  ', GITHUB_CLIENT_SECRET: 'secret' }),
    ).toBeUndefined();
  });
});

describe('authConfigFromEnvironment', () => {
  it('keeps registration disabled unless explicitly opted in', () => {
    expect(authConfigFromEnvironment({}).enableSignup).toBe(false);
    expect(authConfigFromEnvironment({ AUTH_ENABLE_SIGNUP: '1' }).enableSignup).toBe(false);
    expect(authConfigFromEnvironment({ AUTH_ENABLE_SIGNUP: 'TRUE' }).enableSignup).toBe(false);
    expect(authConfigFromEnvironment({ AUTH_ENABLE_SIGNUP: 'true' }).enableSignup).toBe(true);
  });

  it('advertises GitHub only when usable credentials exist', () => {
    expect(authConfigFromEnvironment({}).enableGithubOauth).toBe(false);
    expect(authConfigFromEnvironment({ GITHUB_CLIENT_ID: 'id' }).enableGithubOauth).toBe(false);
    expect(
      authConfigFromEnvironment({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' })
        .enableGithubOauth,
    ).toBe(true);
  });

  it('keeps organizations disabled unless explicitly opted in', () => {
    expect(authConfigFromEnvironment({}).enableOrganizations).toBe(false);
    expect(
      authConfigFromEnvironment({ AUTH_ENABLE_ORGANIZATIONS: 'TRUE' }).enableOrganizations,
    ).toBe(false);
    expect(
      authConfigFromEnvironment({ AUTH_ENABLE_ORGANIZATIONS: 'true' }).enableOrganizations,
    ).toBe(true);
  });

  it('keeps invitations disabled unless explicitly opted in', () => {
    expect(authConfigFromEnvironment({}).enableInvitations).toBe(false);
    expect(
      authConfigFromEnvironment({ AUTH_ENABLE_DEVICE_AUTHORIZATION: 'true' })
        .enableDeviceAuthorization,
    ).toBe(true);
    expect(
      authConfigFromEnvironment({ AUTH_ENABLE_DEVICE_AUTHORIZATION: 'TRUE' })
        .enableDeviceAuthorization,
    ).toBe(false);
    expect(authConfigFromEnvironment({}).enableDeviceAuthorization).toBe(false);
    expect(authConfigFromEnvironment({}).enableInfra).toBe(false);
    expect(
      authConfigFromEnvironment({
        BETTER_AUTH_API_URL: 'https://dash.example.test',
        BETTER_AUTH_KV_URL: 'https://kv.example.test',
        BETTER_AUTH_API_KEY: 'project-key',
      }).enableInfra,
    ).toBe(true);
    expect(authConfigFromEnvironment({ AUTH_ENABLE_INVITATIONS: 'TRUE' }).enableInvitations).toBe(
      false,
    );
    expect(authConfigFromEnvironment({ AUTH_ENABLE_INVITATIONS: 'true' }).enableInvitations).toBe(
      true,
    );
  });

  it('keeps invitations independent of whether self-registration is open', () => {
    // With signup off they are the only way in; with it on they stay useful as role grants.
    for (const AUTH_ENABLE_SIGNUP of ['false', 'true']) {
      expect(
        authConfigFromEnvironment({ AUTH_ENABLE_SIGNUP, AUTH_ENABLE_INVITATIONS: 'true' })
          .enableInvitations,
      ).toBe(true);
    }
  });

  it('refuses to advertise organization creation while organizations are off', () => {
    // A stale AUTH_ALLOW_ORGANIZATION_CREATION must not survive turning the feature back off.
    expect(
      authConfigFromEnvironment({ AUTH_ALLOW_ORGANIZATION_CREATION: 'true' })
        .allowUserToCreateOrganization,
    ).toBe(false);
    expect(
      authConfigFromEnvironment({
        AUTH_ENABLE_ORGANIZATIONS: 'true',
        AUTH_ALLOW_ORGANIZATION_CREATION: 'true',
      }).allowUserToCreateOrganization,
    ).toBe(true);
  });
});

describe('additional social providers', () => {
  it('reads GitLab and Google credentials only when both halves are present', () => {
    expect(gitlabCredentialsFromEnvironment({ GITLAB_CLIENT_ID: 'id' })).toBeUndefined();
    expect(googleCredentialsFromEnvironment({ GOOGLE_CLIENT_SECRET: 'secret' })).toBeUndefined();
    expect(
      gitlabCredentialsFromEnvironment({ GITLAB_CLIENT_ID: 'id', GITLAB_CLIENT_SECRET: 'secret' }),
    ).toEqual({ clientId: 'id', clientSecret: 'secret' });
    expect(
      googleCredentialsFromEnvironment({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });

  it('points GitLab at a self-managed instance when one is named', () => {
    expect(
      gitlabCredentialsFromEnvironment({
        GITLAB_CLIENT_ID: 'id',
        GITLAB_CLIENT_SECRET: 'secret',
        GITLAB_ISSUER: 'https://gitlab.example.test',
      }),
    ).toMatchObject({ issuer: 'https://gitlab.example.test' });
  });

  it('advertises each provider only when its credentials exist', () => {
    const config = authConfigFromEnvironment({
      GITLAB_CLIENT_ID: 'id',
      GITLAB_CLIENT_SECRET: 'secret',
    });

    expect(config.enableGitlabOauth).toBe(true);
    expect(config.enableGoogleOauth).toBe(false);
  });
});

describe('passkeyFromEnvironment', () => {
  it('derives the relying party from the dashboard origin', () => {
    expect(passkeyFromEnvironment({ NUXT_PUBLIC_SITE_URL: 'https://app.example.test/' })).toEqual({
      rpID: 'app.example.test',
      rpName: 'Code Zero',
      origin: 'https://app.example.test',
    });
  });

  it('lets an explicit setting win over the derived one', () => {
    expect(
      passkeyFromEnvironment({
        AUTH_DASHBOARD_ORIGIN: 'https://app.example.test',
        AUTH_PASSKEY_ORIGIN: 'https://auth.example.test',
        AUTH_PASSKEY_RP_ID: 'example.test',
        AUTH_PASSKEY_RP_NAME: 'Acme',
      }),
    ).toEqual({ rpID: 'example.test', rpName: 'Acme', origin: 'https://auth.example.test' });
  });

  it('fails closed without a parseable web origin', () => {
    expect(passkeyFromEnvironment({})).toBeUndefined();
    expect(passkeyFromEnvironment({ NUXT_PUBLIC_SITE_URL: 'not a url' })).toBeUndefined();
    expect(
      passkeyFromEnvironment({ NUXT_PUBLIC_SITE_URL: 'ftp://app.example.test' }),
    ).toBeUndefined();
  });
});

describe('runtime policy flags', () => {
  it('keeps the mail-backed flows off unless explicitly opted in', () => {
    const config = authConfigFromEnvironment({});

    expect(config.enableEmailVerification).toBe(false);
    expect(config.enablePasswordReset).toBe(false);
    expect(config.enableMagicLink).toBe(false);
    expect(config.enableTwoFactorEmailOtp).toBe(false);
    expect(authConfigFromEnvironment({ AUTH_ENABLE_MAGIC_LINK: 'TRUE' }).enableMagicLink).toBe(
      false,
    );
    expect(authConfigFromEnvironment({ AUTH_ENABLE_MAGIC_LINK: 'true' }).enableMagicLink).toBe(
      true,
    );
  });

  it('treats required verification as also sending it', () => {
    expect(
      authConfigFromEnvironment({ AUTH_REQUIRE_EMAIL_VERIFICATION: 'true' })
        .enableEmailVerification,
    ).toBe(true);
  });

  it('offers two-factor by default and drops its mail codes with it', () => {
    expect(authConfigFromEnvironment({}).enableTwoFactor).toBe(true);
    const off = authConfigFromEnvironment({
      AUTH_ENABLE_TWO_FACTOR: 'false',
      AUTH_ENABLE_TWO_FACTOR_EMAIL_OTP: 'true',
    });
    expect(off.enableTwoFactor).toBe(false);
    expect(off.enableTwoFactorEmailOtp).toBe(false);
  });

  it('offers passkeys only where a relying party resolves, and lets an operator opt out', () => {
    const origin = { NUXT_PUBLIC_SITE_URL: 'https://app.example.test' };

    expect(authConfigFromEnvironment({}).enablePasskey).toBe(false);
    expect(authConfigFromEnvironment(origin).enablePasskey).toBe(true);
    expect(
      authConfigFromEnvironment({ ...origin, AUTH_ENABLE_PASSKEY: 'false' }).enablePasskey,
    ).toBe(false);
  });

  it('refuses API keys while organizations are off', () => {
    expect(authConfigFromEnvironment({ AUTH_ENABLE_API_KEYS: 'true' }).enableApiKeys).toBe(false);
    expect(
      authConfigFromEnvironment({ AUTH_ENABLE_API_KEYS: 'true', AUTH_ENABLE_ORGANIZATIONS: 'true' })
        .enableApiKeys,
    ).toBe(true);
  });

  it('reads the SCIM secret without deciding whether SCIM is on', () => {
    expect(scimFromEnvironment({})).toBeUndefined();
    expect(scimFromEnvironment({ SCIM_CREDENTIAL_HASH_SECRET: 's'.repeat(40) })).toEqual({
      credentialHashSecret: 's'.repeat(40),
    });
  });
});

describe('authCapabilities', () => {
  it('reports the conservative defaults with no enterprise capability', () => {
    expect(authCapabilities(defaultAuthConfig)).toEqual({
      signup: false,
      password: true,
      passwordReset: false,
      emailVerification: false,
      magicLink: false,
      passkey: false,
      twoFactor: true,
      twoFactorEmailOtp: false,
      social: { github: false, gitlab: false, google: false },
      organizations: false,
      organizationCreation: false,
      organizationInvitations: false,
      invitations: false,
      apiKeys: false,
      deviceAuthorization: false,
      sso: false,
      scim: false,
      infra: false,
    });
  });

  it('survives a JSON round trip unchanged, so the server can publish it as is', () => {
    const capabilities = authCapabilities(
      authConfigFromEnvironment({ AUTH_ENABLE_SIGNUP: 'true', AUTH_ENABLE_ORGANIZATIONS: 'true' }),
      { sso: true, scim: false },
    );

    expect(JSON.parse(JSON.stringify(capabilities))).toEqual(capabilities);
  });

  it('publishes no credential the environment carries', () => {
    const environment = {
      GITHUB_CLIENT_ID: 'github-client-id',
      GITHUB_CLIENT_SECRET: 'github-client-secret',
      BETTER_AUTH_API_URL: 'https://dash.example.test',
      BETTER_AUTH_KV_URL: 'https://kv.example.test',
      BETTER_AUTH_API_KEY: 'project-api-key',
      OAUTH_PROXY_SECRET: 'proxy-secret',
    };
    const serialized = JSON.stringify(authCapabilities(authConfigFromEnvironment(environment)));

    for (const value of Object.values(environment)) expect(serialized).not.toContain(value);
  });

  it('requires both features for organization invitations, which travel through enrollment', () => {
    const organizationsOnly = { ...defaultAuthConfig, enableOrganizations: true };

    expect(authCapabilities(organizationsOnly).organizationInvitations).toBe(false);
    expect(
      authCapabilities({ ...organizationsOnly, enableInvitations: true }).organizationInvitations,
    ).toBe(true);
  });

  it('reports SSO and SCIM from the entitlements alone', () => {
    expect(authCapabilities(defaultAuthConfig, { sso: true, scim: true })).toMatchObject({
      sso: true,
      scim: true,
    });
  });
});
