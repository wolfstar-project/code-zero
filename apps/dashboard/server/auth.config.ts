import { authBetterAuthOptions, authDatabaseOptionsFromEnvironment } from '@code-zero/auth';
import { createMailer, mailProviderNameFromEnvironment } from '@code-zero/mail';
import { defineServerAuth } from '@onmax/nuxt-better-auth/config';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { testUtils } from 'better-auth/plugins';

// This module is the composition root for authentication, so it is where the mail transport is
// bound and injected. `packages/auth` declares the delivery contract structurally and never
// imports `@code-zero/mail`, which keeps one capability package from depending on another.
//
// The transport is injected when it actually delivers, or in development where the console
// provider is useful for exercising invitation flows locally. Production still withholds the
// callback for `console`, so `authBetterAuthOptions` fails startup instead of accepting invitations
// that will never reach their recipients.
const sendMail = createMailer();
const deliversMail =
  mailProviderNameFromEnvironment() !== 'console' || process.env.NODE_ENV === 'development';

/**
 * Better Auth's database, policy, and provider configuration.
 *
 * `secret` and `baseURL` are deliberately absent from `authBetterAuthOptions`: the module injects
 * them itself (from `NUXT_BETTER_AUTH_SECRET`/`BETTER_AUTH_SECRET` and the resolved site URL), so
 * this file cannot become a second, divergent source for either. `dashboardUrl` resolves from
 * `NUXT_PUBLIC_SITE_URL` for the same reason `secret`/`baseURL` are omitted above: this app is
 * same-origin with itself, so the dashboard origin an invitation link should point at is this
 * deployment's own public origin. It has to be resolved at module load (rather than derived from
 * an incoming request) because Better Auth's plugin list, and therefore the invitation callback
 * closure, is built once. Development falls back to Nuxt's default `http://localhost:3000`;
 * deployments must still set their actual public origin explicitly.
 */
const dashboardUrl = dashboardUrlFromEnvironment(process.env);

const options = authBetterAuthOptions({
  ...authDatabaseOptionsFromEnvironment(),
  ...(dashboardUrl ? { dashboardUrl } : {}),
  ...(deliversMail
    ? {
        // The enrollment plugin deliberately never returns a private invitation's link to whoever
        // created it, so this callback is the only path the token travels. The template renders
        // the optional halves away rather than printing "null": an invitation with no invitee name
        // or no organization is the ordinary app-wide case, not a missing value.
        sendPrivateInvitationEmail: ({ to, name, inviterName, organizationName, acceptUrl }) =>
          sendMail({
            to,
            templateId: 'privateInvitation',
            context: {
              name: name ?? '',
              inviterName,
              organizationName: organizationName ?? '',
              acceptUrl,
            },
          }),
        sendPublicInvitationEmail: ({
          to,
          inviterName,
          organizationName,
          shareUrl,
          maxUses,
          expiresAt,
        }) =>
          sendMail({
            to,
            templateId: 'publicInvitation',
            context: {
              inviterName,
              organizationName: organizationName ?? '',
              shareUrl,
              maxUses: maxUses === null ? 'Unlimited' : String(maxUses),
              expiresAt: expiresAt?.toISOString() ?? 'Never',
            },
          }),
      }
    : {}),
});

/**
 * `AUTH_E2E_MEMORY` swaps the Postgres adapter for an in-memory one. Two callers set it, both of
 * which own the whole server process and throw its store away when they exit: the Playwright
 * preview server (`start:playwright:webserver`, see `playwright.config.ts`), so the e2e suite in
 * `test/e2e/test-utils.ts` can sign up and sign in its own throwaway account through the real
 * `/api/auth/**` endpoints without a live database; and `dev:dashboard` (`.env.solo`), so the
 * dashboard starts from a fresh clone without one either. Both stay off the network and off mutable
 * external state. `AUTH_DATABASE_URL` still has to resolve to build `options` above, but nothing
 * ever queries it once `database` is overridden here.
 *
 * Deliberately not guarded by `NODE_ENV`: `nuxt preview` — the command this app's own e2e suite
 * runs, per `start:playwright:webserver` above — sets `NODE_ENV=production` whenever it isn't
 * already set (`@nuxt/cli`'s `preview` command), identically to a real deployment's built output.
 * A `NODE_ENV === 'production'` check would therefore reject every e2e run, not just a leaked
 * flag. Keep this variable out of any shared `.env`/CI template that a real deployment also reads —
 * `.env.solo` is not one: `nuxt` loads it only when a command names it with `--dotenv`, which is
 * how `dev:dashboard` alone reaches it.
 */
export default defineServerAuth(
  process.env.AUTH_E2E_MEMORY === 'true'
    ? {
        ...options,
        // Better Auth's memory adapter needs each model's collection to exist up front, even
        // empty — an absent key throws "Model <name> not found" on the first query rather than
        // being treated as an empty table.
        database: memoryAdapter({
          user: [],
          session: [],
          account: [],
          verification: [],
          invite: [],
          inviteUse: [],
          deviceCode: [],
        }),
        // Test-only, and deliberately added here rather than in `packages/auth`: `testUtils`
        // registers no HTTP route, but it hangs privileged helpers off the auth context that can
        // mint sessions and delete accounts without credentials. Keeping it inside this branch
        // means a real deployment's context never carries them, because the branch is only taken
        // when the store is the throwaway in-memory one.
        plugins: [...options.plugins, testUtils()],
        // The default rate limiter can't determine a per-client IP in this sandboxed preview
        // server, so it falls back to one shared bucket across every request. A parallel
        // Playwright run's repeated sign-up/sign-in calls exhaust that bucket in a few tests;
        // rate limiting isn't what this suite exercises, so it's off for this adapter only.
        rateLimit: { enabled: false },
      }
    : options,
);
