import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';

import createAppAuthClient from '~/auth.config';

/**
 * Builds the real auth client from `app/auth.config.ts`.
 *
 * Every other spec in this directory mocks `useAuthClient`, so nothing exercised that file itself
 * — including the `useAppConfig()` call the client-plugin list reads `enableInfra` from. That call
 * happens while the client is being constructed rather than inside a component, so a failure there
 * would not surface in a component spec: it would take down every authenticated page at runtime
 * instead, which is exactly the failure these two cases are here to catch.
 *
 * What this spec deliberately does *not* assert is which plugin surfaces exist. Better Auth
 * returns a proxy that turns every property access into a callable path builder, so
 * `client.organization` and `client.nonsense` are indistinguishable at runtime. Whether the flat
 * plugin literal still infers `organization`, `invite`, `multiSession`, and `dash` is a
 * compile-time property, and it is enforced by `nuxt typecheck` over the real call sites in
 * `modules/organizations/composables/useOrganizations.ts` and `app/pages/invite.vue`.
 */
// Mirrors the shape `nuxt.config.ts` publishes, `infraKvUrl` included: passing the project's own
// ingestion endpoint is what keeps `sentinelClient()` off Better Auth's shared global one, and a
// mock without it would let that regress unnoticed.
const authCapabilities = { enableInfra: true, infraKvUrl: 'https://kv.example.test' };

mockNuxtImport('useAppConfig', () => () => ({ auth: authCapabilities }));

const navigate = vi.hoisted(() => vi.fn<(to: string) => Promise<void>>());
mockNuxtImport('navigateTo', () => navigate);

/** What the auth server answers a correct password with when the account owes a second factor. */
function twoFactorChallenge(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ twoFactorRedirect: true, twoFactorMethods: ['totp'] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('app/auth.config.ts', () => {
  it('constructs a client when the deployment is cloud-managed', () => {
    // The branch that adds `sentinelClient()`, which reads `identifyUrl` as it initialises.
    expect(createAppAuthClient('http://localhost:3000')).toBeDefined();
  });

  it('sends a sign-in the server challenges for a second factor to /two-factor', async () => {
    // The challenge is not an error — the password was right — and it is not a session either,
    // so without this hook the sign-in page would be left showing a success it cannot act on.
    // The fetch is answered in-process, so the client's own two-factor hook is what runs here.
    const client = createAppAuthClient('http://localhost:3000');

    const { error } = await client.signIn.email(
      { email: 'ada@example.test', password: 'correct horse battery staple' },
      { customFetchImpl: twoFactorChallenge },
    );

    expect(error).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/two-factor');
  });

  it('constructs a client when it is not, so the gate cannot break a self-hosted install', () => {
    // The gate that keeps a self-hosted install from fingerprinting its visitors against a
    // third-party KV service. Flipping it must not break client construction.
    authCapabilities.enableInfra = false;
    try {
      expect(createAppAuthClient('http://localhost:3000')).toBeDefined();
    } finally {
      authCapabilities.enableInfra = true;
    }
  });
});
