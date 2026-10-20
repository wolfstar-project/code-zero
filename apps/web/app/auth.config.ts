import { apiKeyClient } from '@better-auth/api-key/client';
import { dashClient, sentinelClient } from '@better-auth/infra/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { betterEnrollmentClient } from '@octopi-ai/better-enrollment/client';
import { defineClientAuth } from '@onmax/nuxt-better-auth/config';
import {
  adminClient,
  deviceAuthorizationClient,
  lastLoginMethodClient,
  magicLinkClient,
  multiSessionClient,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';

/** The page `app/pages/(auth)/two-factor.vue` serves; a route rule keeps it guest-only. */
const TWO_FACTOR_PATH = '/two-factor';

// Better Auth is mounted in this app's own server (`server/auth.config.ts`), so every request is
// same-origin: no explicit `baseURL` or credentialed CORS is needed.
//
// Both plugins are passed exactly as their factories return them. Better Auth infers the whole
// client API from this list in one pass, reading each plugin's `$InferServerPlugin`, so widening
// one entry — by intersecting it with the base `BetterAuthClientPlugin` interface, for instance —
// costs the *other* plugin its inferred endpoints: `organization.list`, `organization.inviteMember`
// and the rest stop existing on the client's type.
//
// Declared as a factory rather than a plain object so `useAppConfig()` is callable: the module
// builds the client lazily, inside the Nuxt app. Only the hosted-infrastructure flag is read from
// there, because it decides which client code loads; every sign-in capability is read at runtime
// from `/api/capabilities` instead.
export default defineClientAuth(() => {
  const { auth } = useAppConfig();
  // Captured here, while the factory runs inside the Nuxt app, because the two-factor redirect
  // below fires from a fetch hook with no component or plugin context of its own.
  const nuxtApp = useNuxtApp();

  return {
    // Registered unconditionally: these client plugins only add callable methods, and whether the
    // deployment actually serves them is decided by the auth server's own policy. Gating them on a
    // build-time flag would let a stale dashboard build lose access to an enabled feature.
    //
    // The list is a flat literal for the same inference reason the two entries above already were,
    // and it stays in server-config order so a reader can line the two files up:
    // `lastLoginMethodClient` reads the sign-in hint cookie, `multiSessionClient` lists and switches
    // between the accounts this browser holds sessions for, `deviceAuthorizationClient` is what the
    // `/device` page calls to approve or deny a CLI's request, and `dashClient` reads the hosted
    // audit log.
    //
    // `adminClient`, `twoFactorClient`, `passkeyClient`, `magicLinkClient`, and `apiKeyClient` are
    // the client halves of plugins the server registers from runtime policy; the pages that drive
    // them read `/api/capabilities` to decide whether to offer them.
    plugins: [
      organizationClient(),
      betterEnrollmentClient(),
      lastLoginMethodClient(),
      multiSessionClient(),
      adminClient(),
      // A sign-in the server answers with `twoFactorRedirect` has no session yet: the password was
      // right and the second factor is still owed. Without this hook the sign-in page would show
      // a success it cannot act on, so the visitor is taken to the challenge page instead.
      twoFactorClient({
        onTwoFactorRedirect: async () => {
          await nuxtApp.runWithContext(() => navigateTo(TWO_FACTOR_PATH));
        },
      }),
      passkeyClient(),
      magicLinkClient(),
      apiKeyClient(),
      deviceAuthorizationClient(),
      dashClient(),
      // The one entry that is gated, and the only one whose absence changes nothing about the
      // client's type: it contributes no `$InferServerPlugin`, only fetch hooks. It has to be
      // conditional because it is not passive — it fingerprints the browser and identifies the
      // visitor against Better Auth's KV service on every auth request, which must not happen on a
      // deployment whose operator never signed up for that service. `enableInfra` is derived from
      // the same `BETTER_AUTH_*` credentials that decide whether the server registers `sentinel()`
      // at all, so the two halves cannot drift.
      //
      // What it buys where it is on: `423` responses carrying a proof-of-work challenge are solved
      // and retried automatically instead of surfacing to the visitor as a failed sign-in.
      // `identifyUrl` is the project's own ingestion endpoint, published by `nuxt.config.ts` from
      // the same `BETTER_AUTH_KV_URL` the server plugins use. Omitting it would silently fall back
      // to Better Auth's shared global endpoint, which the plugin itself warns against on startup.
      ...(auth.enableInfra ? [sentinelClient({ identifyUrl: auth.infraKvUrl })] : []),
    ],
  };
});
