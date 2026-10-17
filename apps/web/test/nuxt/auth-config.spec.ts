import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

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

describe('app/auth.config.ts', () => {
  it('constructs a client when the deployment is cloud-managed', () => {
    // The branch that adds `sentinelClient()`, which reads `identifyUrl` as it initialises.
    expect(createAppAuthClient('http://localhost:3000')).toBeDefined();
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
