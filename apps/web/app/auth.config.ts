import { dashClient, sentinelClient } from '@better-auth/infra/client';
import { betterEnrollmentClient } from '@octopi-ai/better-enrollment/client';
import { defineClientAuth } from '@onmax/nuxt-better-auth/config';
import {
  deviceAuthorizationClient,
  lastLoginMethodClient,
  multiSessionClient,
  organizationClient,
} from 'better-auth/client/plugins';

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
// builds the client lazily, inside the Nuxt app, so the policy published at build time is readable
// by the time this runs.
export default defineClientAuth(() => {
  const { auth } = useAppConfig();

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
    plugins: [
      organizationClient(),
      betterEnrollmentClient(),
      lastLoginMethodClient(),
      multiSessionClient(),
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
