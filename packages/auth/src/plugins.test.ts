import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authBetterAuthOptions, type AuthDatabaseOptions } from './auth.js';
import {
  API_KEY_DEFAULT_PERMISSIONS,
  API_KEY_EXPIRES_IN_SECONDS,
  API_KEY_MAXIMUM_EXPIRES_IN_DAYS,
  API_KEY_PREFIX,
  API_KEY_RATE_LIMIT_MAX_REQUESTS,
  API_KEY_RATE_LIMIT_WINDOW_SECONDS,
  defaultAuthConfig,
  type AuthConfig,
} from './config.js';

const DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/code_zero_auth';
const SECRET = 'a-very-secret-value-that-is-long-enough';
const BASE_URL = 'http://localhost:3001';
const SCIM_SECRET = 'scim-credential-hash-secret-0123456789abcdef';
const RELYING_PARTY = {
  rpID: 'app.example.test',
  rpName: 'Code Zero',
  origin: 'https://app.example.test',
} as const;

const MISSING_VERIFICATION = /sendVerificationEmail/;
const MISSING_RESET = /sendPasswordResetEmail/;
const MISSING_MAGIC_LINK = /sendMagicLinkEmail/;
const MISSING_OTP = /sendTwoFactorOtpEmail/;
const MISSING_RELYING_PARTY = /relying party/;
const MISSING_SCIM_SECRET = /SCIM_CREDENTIAL_HASH_SECRET/;
const SHORT_SCIM_SECRET = /at least 32 characters/;
const TOTP_LABEL = /^otpauth:\/\/totp\/Code%20Zero:/;

/** A fixed instant, so expiry assertions never read the wall clock. */
const NOW = Date.parse('2026-10-18T09:00:00.000Z');

const noop = async () => {};

/** Every model the plugins below can query; the memory adapter throws on an absent one. */
function memoryStore() {
  return memoryAdapter({
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
    invite: [],
    inviteUse: [],
    twoFactor: [],
    passkey: [],
    apikey: [],
    ssoProvider: [],
    deviceCode: [],
  });
}

function pluginIds(overrides: Partial<AuthConfig>, extra: Partial<AuthDatabaseOptions> = {}) {
  return authBetterAuthOptions({
    databaseUrl: DATABASE_URL,
    config: { ...defaultAuthConfig, ...overrides },
    ...extra,
  }).plugins.map((plugin) => plugin.id);
}

/** A Better Auth instance over the memory store, so endpoints can be exercised for real. */
function instance(overrides: Partial<AuthConfig>, extra: Partial<AuthDatabaseOptions> = {}) {
  return betterAuth({
    ...authBetterAuthOptions({
      databaseUrl: DATABASE_URL,
      config: { ...defaultAuthConfig, enableSignup: true, ...overrides },
      ...extra,
    }),
    database: memoryStore(),
    secret: SECRET,
    baseURL: BASE_URL,
    rateLimit: { enabled: false },
  });
}

async function status(auth: ReturnType<typeof instance>, method: string, path: string) {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      ...(method === 'GET' ? {} : { body: '{}' }),
    }),
  );
  return response.status;
}

async function signUp(auth: ReturnType<typeof instance>, email = 'dana@example.com') {
  const { headers } = await auth.api.signUpEmail({
    body: { email, password: 'a-long-enough-password', name: 'Dana' },
    returnHeaders: true,
  });
  return new Headers({ cookie: headers.get('set-cookie') ?? '' });
}

/** Return the failure message so assertions stay outside the catch block. */
function messageFrom(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

interface TwoFactorApi {
  enableTwoFactor(options: {
    body: { password: string };
    headers: Headers;
  }): Promise<{ totpURI: string; backupCodes: string[] }>;
}

interface CreatedApiKey {
  key: string;
  referenceId: string;
  rateLimitEnabled: boolean;
  rateLimitMax: number | null;
  rateLimitTimeWindow: number | null;
  expiresAt: Date | string | null;
}

interface ApiKeyApi {
  createOrganization(options: {
    body: { name: string; slug: string };
    headers: Headers;
  }): Promise<{ id: string } | null>;
  createApiKey(options: {
    body: { name: string; organizationId: string; expiresIn?: number };
    headers: Headers;
  }): Promise<CreatedApiKey>;
  listApiKeys(options: { query: { organizationId: string }; headers: Headers }): Promise<unknown>;
  verifyApiKey(options: { body: { key: string } }): Promise<{
    valid: boolean;
    key: { referenceId: string; permissions: Record<string, string[]> | null } | null;
  }>;
}

/**
 * `authBetterAuthOptions` widens plugins to `BetterAuthPlugin[]`, so plugin endpoints are not on
 * the inferred `auth.api` type. They are checked at runtime instead of asserted into shape.
 */
function hasTwoFactorApi(api: object): api is object & TwoFactorApi {
  return 'enableTwoFactor' in api && typeof api.enableTwoFactor === 'function';
}

function hasApiKeyApi(api: object): api is object & ApiKeyApi {
  return (
    'createOrganization' in api &&
    typeof api.createOrganization === 'function' &&
    'createApiKey' in api &&
    typeof api.createApiKey === 'function' &&
    'listApiKeys' in api &&
    typeof api.listApiKeys === 'function' &&
    'verifyApiKey' in api &&
    typeof api.verifyApiKey === 'function'
  );
}

describe('plugin policy', () => {
  it('always registers the admin plugin, the authority for the app-wide role', () => {
    expect(pluginIds({})).toContain('admin');
  });

  it.each([
    ['two-factor', { enableTwoFactor: true }, { enableTwoFactor: false }, {}],
    ['passkey', { enablePasskey: true }, { enablePasskey: false }, { passkey: RELYING_PARTY }],
    [
      'magic-link',
      { enableMagicLink: true },
      { enableMagicLink: false },
      { sendMagicLinkEmail: noop },
    ],
    [
      'api-key',
      { enableOrganizations: true, enableApiKeys: true },
      { enableOrganizations: true, enableApiKeys: false },
      {},
    ],
    ['organization', { enableOrganizations: true }, { enableOrganizations: false }, {}],
    [
      'device-authorization',
      { enableDeviceAuthorization: true },
      { enableDeviceAuthorization: false },
      {},
    ],
  ] satisfies [string, Partial<AuthConfig>, Partial<AuthConfig>, Partial<AuthDatabaseOptions>][])(
    'registers %s only when the policy enables it',
    (id, on, off, extra) => {
      expect(pluginIds(on, extra)).toContain(id);
      expect(pluginIds(off, extra)).not.toContain(id);
    },
  );

  it('refuses API keys while organizations are off, since a key belongs to one', () => {
    expect(pluginIds({ enableOrganizations: false, enableApiKeys: true })).not.toContain('api-key');
  });

  it('keeps the kept plugins: multi-session, last login method, bearer with the device flow', () => {
    const ids = pluginIds({ enableDeviceAuthorization: true });

    expect(ids).toEqual(
      expect.arrayContaining([
        'multi-session',
        'last-login-method',
        'bearer',
        'device-authorization',
      ]),
    );
  });

  it('registers SSO and SCIM only for an entitled deployment', () => {
    const withoutEntitlements = pluginIds({}, { scim: { credentialHashSecret: SCIM_SECRET } });
    const entitled = pluginIds(
      {},
      { entitlements: { sso: true, scim: true }, scim: { credentialHashSecret: SCIM_SECRET } },
    );

    expect(withoutEntitlements).not.toContain('sso');
    expect(withoutEntitlements).not.toContain('scim');
    expect(entitled).toContain('sso');
    expect(entitled).toContain('scim');
  });

  it('binds passkeys to the configured relying party, never to a request header', () => {
    const plugin = authBetterAuthOptions({
      databaseUrl: DATABASE_URL,
      config: { ...defaultAuthConfig, enablePasskey: true },
      passkey: RELYING_PARTY,
    }).plugins.find((candidate) => candidate.id === 'passkey');

    expect(plugin?.options).toMatchObject(RELYING_PARTY);
  });

  it('closes every social provider to sign-up exactly when the password form is closed', () => {
    const credentials = { clientId: 'id', clientSecret: 'secret' };
    for (const enableSignup of [false, true]) {
      const options = authBetterAuthOptions({
        databaseUrl: DATABASE_URL,
        config: { ...defaultAuthConfig, enableSignup },
        github: credentials,
        gitlab: { ...credentials, issuer: 'https://gitlab.example.test' },
        google: credentials,
      });

      expect(options.socialProviders).toMatchObject({
        github: { disableSignUp: !enableSignup },
        gitlab: { disableSignUp: !enableSignup, issuer: 'https://gitlab.example.test' },
        google: { disableSignUp: !enableSignup },
      });
    }
  });

  it('bounds password length, which Better Auth 1.7 enforces with PASSWORD_TOO_LONG', () => {
    const options = authBetterAuthOptions({ databaseUrl: DATABASE_URL, config: defaultAuthConfig });

    expect(options.emailAndPassword).toMatchObject({
      minPasswordLength: 8,
      maxPasswordLength: 128,
    });
  });

  it('wires verification and password reset only when the policy turns them on', () => {
    const off = authBetterAuthOptions({ databaseUrl: DATABASE_URL, config: defaultAuthConfig });
    const on = authBetterAuthOptions({
      databaseUrl: DATABASE_URL,
      config: {
        ...defaultAuthConfig,
        enableEmailVerification: true,
        requireEmailVerification: true,
        enablePasswordReset: true,
      },
      sendVerificationEmail: noop,
      sendPasswordResetEmail: noop,
    });

    expect(off.emailVerification).toBeUndefined();
    expect(off.emailAndPassword?.sendResetPassword).toBeUndefined();
    expect(on.emailVerification?.sendVerificationEmail).toBeTypeOf('function');
    expect(on.emailAndPassword).toMatchObject({
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
    });
    expect(on.emailAndPassword?.sendResetPassword).toBeTypeOf('function');
  });
});

describe('capabilities that need delivery', () => {
  it.each([
    [{ enableEmailVerification: true }, MISSING_VERIFICATION],
    [{ enablePasswordReset: true }, MISSING_RESET],
    [{ enableMagicLink: true }, MISSING_MAGIC_LINK],
    [{ enableTwoFactor: true, enableTwoFactorEmailOtp: true }, MISSING_OTP],
    [{ enablePasskey: true }, MISSING_RELYING_PARTY],
  ] satisfies [Partial<AuthConfig>, RegExp][])(
    'refuses to construct %o without it',
    (config, pattern) => {
      expect(() => pluginIds(config)).toThrow(pattern);
    },
  );

  it('refuses the SCIM entitlement without its secret, naming the variable', () => {
    expect(() => pluginIds({}, { entitlements: { sso: false, scim: true } })).toThrow(
      MISSING_SCIM_SECRET,
    );
  });

  it('rejects a short SCIM secret without echoing it', () => {
    const credentialHashSecret = 'short-secret-value';
    const message = messageFrom(() =>
      pluginIds({}, { entitlements: { sso: false, scim: true }, scim: { credentialHashSecret } }),
    );

    expect(message).toMatch(SHORT_SCIM_SECRET);
    expect(message).not.toContain(credentialHashSecret);
  });
});

describe('enterprise endpoints', () => {
  it('serves no SSO or SCIM route without the entitlement', async () => {
    const auth = instance({});

    expect(await status(auth, 'POST', '/sso/register')).toBe(404);
    expect(await status(auth, 'POST', '/sign-in/sso')).toBe(404);
    expect(await status(auth, 'GET', '/scim/v2/Users')).toBe(404);
  });

  it('serves them, behind authentication, once entitled', async () => {
    const auth = instance(
      {},
      { entitlements: { sso: true, scim: true }, scim: { credentialHashSecret: SCIM_SECRET } },
    );

    expect(await status(auth, 'POST', '/sso/register')).not.toBe(404);
    expect(await status(auth, 'GET', '/scim/v2/Users')).toBe(401);
  });
});

describe('two-factor authentication', () => {
  it('names Code Zero as the issuer in the authenticator enrollment URI', async () => {
    const auth = instance({ enableTwoFactor: true });
    const headers = await signUp(auth);
    if (!hasTwoFactorApi(auth.api)) throw new Error('missing two-factor API');

    const enrollment = await auth.api.enableTwoFactor({
      body: { password: 'a-long-enough-password' },
      headers,
    });

    // The label and the issuer parameter both carry it, so the authenticator lists the account
    // under the product rather than under a bare address.
    expect(enrollment.totpURI).toMatch(TOTP_LABEL);
    expect(new URL(enrollment.totpURI).searchParams.get('issuer')).toBe('Code Zero');
    expect(enrollment.backupCodes.length).toBeGreaterThan(0);
  });
});

describe('API keys', () => {
  // Only `Date` is faked: the expiry is computed from it, while the plugin's own timers keep
  // running normally.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** An organization with its owner signed in, ready to mint keys. */
  async function organizationOwner() {
    const auth = instance({
      enableOrganizations: true,
      allowUserToCreateOrganization: true,
      enableApiKeys: true,
    });
    const headers = await signUp(auth);
    if (!hasApiKeyApi(auth.api)) throw new Error('missing organization or API-key API');
    const organization = await auth.api.createOrganization({
      body: { name: 'Acme Ops', slug: 'acme-ops' },
      headers,
    });
    return { api: auth.api, auth, headers, organizationId: organization?.id ?? '' };
  }

  it('mints organization keys with the cz_ prefix, an expiry, and a rate limit', async () => {
    const { api, headers, organizationId } = await organizationOwner();

    const created = await api.createApiKey({
      body: { name: 'ci', organizationId },
      headers,
    });

    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.referenceId).toBe(organizationId);
    expect(created.rateLimitEnabled).toBe(true);
    expect(created.rateLimitMax).toBe(API_KEY_RATE_LIMIT_MAX_REQUESTS);
    expect(created.rateLimitTimeWindow).toBe(API_KEY_RATE_LIMIT_WINDOW_SECONDS * 1000);
    expect(new Date(created.expiresAt ?? 0).getTime()).toBe(
      NOW + API_KEY_EXPIRES_IN_SECONDS * 1000,
    );
  });

  it('caps a requested expiry in days, not seconds', async () => {
    const { api, headers, organizationId } = await organizationOwner();
    const day = 60 * 60 * 24;

    const longest = await api.createApiKey({
      body: { name: 'ci', organizationId, expiresIn: API_KEY_MAXIMUM_EXPIRES_IN_DAYS * day },
      headers,
    });

    expect(new Date(longest.expiresAt ?? 0).getTime()).toBe(
      NOW + API_KEY_MAXIMUM_EXPIRES_IN_DAYS * day * 1000,
    );
    await expect(
      api.createApiKey({
        body: {
          name: 'ci',
          organizationId,
          expiresIn: (API_KEY_MAXIMUM_EXPIRES_IN_DAYS + 1) * day,
        },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('grants a new key task creation, and verifies it for the control plane', async () => {
    const { api, headers, organizationId } = await organizationOwner();
    const created = await api.createApiKey({ body: { name: 'ci', organizationId }, headers });

    // The shape `packages/api` reads through its `ApiKeyVerifier`: the owning organization and
    // the permissions that decide which execution modes the key gets.
    await expect(api.verifyApiKey({ body: { key: created.key } })).resolves.toMatchObject({
      valid: true,
      key: { referenceId: organizationId, permissions: API_KEY_DEFAULT_PERMISSIONS },
    });
    await expect(
      api.verifyApiKey({ body: { key: `${API_KEY_PREFIX}not-a-key` } }),
    ).resolves.toMatchObject({ valid: false, key: null });
  });

  it('stores the key hashed, so the store never holds a usable credential', async () => {
    const { api, headers, organizationId } = await organizationOwner();
    const created = await api.createApiKey({ body: { name: 'ci', organizationId }, headers });

    const listed = await api.listApiKeys({ query: { organizationId }, headers });
    const serialized = JSON.stringify(listed);

    expect(serialized).not.toContain(created.key);
  });

  it('refuses a caller who is not a member of the organization', async () => {
    const { api, auth, organizationId } = await organizationOwner();
    const outsider = await signUp(auth, 'eve@example.com');

    await expect(
      api.createApiKey({ body: { name: 'ci', organizationId }, headers: outsider }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
