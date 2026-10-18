import { apiKey } from '@better-auth/api-key';
import { dash, sentinel } from '@better-auth/infra';
import { passkey } from '@better-auth/passkey';
import { scim } from '@better-auth/scim';
import { sso } from '@better-auth/sso';
import { createDatabase, databaseUrlFromEnvironment, schema } from '@code-zero/database';
import { betterEnrollment } from '@octopi-ai/better-enrollment';
import { betterAuth } from 'better-auth';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import {
  admin,
  bearer,
  deviceAuthorization,
  lastLoginMethod,
  magicLink,
  multiSession,
  oAuthProxy,
  organization,
  twoFactor,
} from 'better-auth/plugins';

import { accessControl, organizationRoles } from './access.js';
import {
  authConfigFromEnvironment,
  DEVICE_VERIFICATION_PATH,
  githubCredentialsFromEnvironment,
  gitlabCredentialsFromEnvironment,
  googleCredentialsFromEnvironment,
  infraFromEnvironment,
  NO_ENTITLEMENTS,
  oauthProxyFromEnvironment,
  passkeyFromEnvironment,
  scimFromEnvironment,
  API_KEY_PREFIX,
  TWO_FACTOR_ISSUER,
} from './config.js';
import type {
  AuthConfig,
  AuthEntitlements,
  GithubOauthCredentials,
  GitlabOauthCredentials,
  GoogleOauthCredentials,
  InfraConfig,
  OauthProxyConfig,
  PasskeyRelyingParty,
  ScimConfig,
} from './config.js';

/**
 * Delivers a private (email-bound) enrollment invitation.
 *
 * Declared structurally rather than imported from `@code-zero/mail`: this package owns
 * authentication policy, and taking a dependency on the mail package would make one capability
 * package depend on another. The link is never returned to whoever created the invitation, so
 * this callback is the only path it travels: it exists solely in the recipient's mailbox, which
 * is what makes presenting the token proof of mailbox access and lets redemption mark the address
 * verified.
 */
export type SendPrivateInvitationEmail = (invitation: {
  readonly to: string;
  /** The invitee's name when the inviter supplied one. */
  readonly name: string | null;
  readonly inviterName: string;
  /** Set when the invitation grants membership in, or founding of, an organization. */
  readonly organizationName: string | null;
  /** Absolute URL that redeems the invitation. Carries the only copy of the token. */
  readonly acceptUrl: string;
}) => Promise<void>;

/**
 * Delivers a public (shareable) enrollment invitation to the person who created it.
 *
 * Public links are also returned once by Better Enrollment, but delivery gives the inviter a
 * durable copy they can share later. Unlike a private invitation this proves no mailbox access for
 * the eventual invitee, so the recipient here is always the inviter.
 */
export type SendPublicInvitationEmail = (invitation: {
  readonly to: string;
  readonly inviterName: string;
  readonly role: string;
  readonly organizationName: string | null;
  /** Absolute, shareable URL that redeems the invitation. */
  readonly shareUrl: string;
  /** Maximum redemptions, or null when the invitation is unlimited. */
  readonly maxUses: number | null;
  /** Invitation expiry, or null when it never expires. */
  readonly expiresAt: Date | null;
}) => Promise<void>;

/**
 * Delivers the link that verifies an account's email address.
 *
 * Structural, like the invitation contracts above, so this package never depends on
 * `@code-zero/mail`. The link carries a single-use token and is sent only to the address it
 * verifies.
 */
export type SendVerificationEmail = (message: {
  readonly to: string;
  readonly name: string;
  /** Absolute URL that verifies the address. Carries the only copy of the token. */
  readonly verifyUrl: string;
}) => Promise<void>;

/** Delivers the link that resets a forgotten password, to the account's own address only. */
export type SendPasswordResetEmail = (message: {
  readonly to: string;
  readonly name: string;
  /** Absolute URL that opens the reset form. Carries the only copy of the token. */
  readonly resetUrl: string;
}) => Promise<void>;

/** Delivers a passwordless sign-in link. Possession of the link is the credential. */
export type SendMagicLinkEmail = (message: {
  readonly to: string;
  /** Absolute URL that signs the recipient in. Carries the only copy of the token. */
  readonly signInUrl: string;
}) => Promise<void>;

/** Delivers a one-time second-factor code by mail, for an account that chose that factor. */
export type SendTwoFactorOtpEmail = (message: {
  readonly to: string;
  readonly name: string;
  /** The one-time code. Short-lived, single-use, and never logged. */
  readonly code: string;
}) => Promise<void>;

/** Everything Better Auth's policy shape needs that isn't signing or origin configuration. */
export interface AuthDatabaseOptions {
  /**
   * Postgres connection string holding users and sessions.
   *
   * The pool is opened by `@code-zero/database`, which owns the schema and the migrations for
   * those tables.
   */
  readonly databaseUrl: string;
  readonly config: AuthConfig;
  readonly github?: GithubOauthCredentials;
  readonly gitlab?: GitlabOauthCredentials;
  readonly google?: GoogleOauthCredentials;
  /**
   * The relying party passkeys are bound to. Required when `config.enablePasskey` is on: without
   * a configured origin the plugin would trust whatever `Origin` header a request carried.
   */
  readonly passkey?: PasskeyRelyingParty;
  /**
   * Enterprise capabilities. Absent means none: SSO and SCIM are registered only when their
   * entitlement is explicitly true, and otherwise their endpoints do not exist.
   */
  readonly entitlements?: AuthEntitlements;
  /** SCIM settings, required when the `scim` entitlement is granted. */
  readonly scim?: ScimConfig;
  /** Required when `config.enableEmailVerification` is on. */
  readonly sendVerificationEmail?: SendVerificationEmail;
  /** Required when `config.enablePasswordReset` is on. */
  readonly sendPasswordResetEmail?: SendPasswordResetEmail;
  /** Required when `config.enableMagicLink` is on. */
  readonly sendMagicLinkEmail?: SendMagicLinkEmail;
  /** Required when `config.enableTwoFactorEmailOtp` is on. */
  readonly sendTwoFactorOtpEmail?: SendTwoFactorOtpEmail;
  /**
   * Routes this deployment's OAuth round trip through a production origin.
   *
   * Present only on preview and local deployments, which cannot register their own ephemeral
   * callback URL with the provider. Absent in production, where `productionUrl` would equal the
   * deployment's own origin and the plugin would decline to proxy anyway.
   */
  readonly oauthProxy?: OauthProxyConfig;
  /**
   * Credentials for Better Auth's hosted infrastructure, present only on the cloud-managed
   * deployment. Absent everywhere else, which is what keeps `dash` and `sentinel` unregistered on
   * a self-hosted install rather than registered and failing.
   */
  readonly infra?: InfraConfig;
  /**
   * Dashboard origin invitation links point at, so a recipient lands on the UI, not the API.
   * Required when Better Enrollment invitations are enabled.
   */
  readonly dashboardUrl?: string;
  /**
   * How private enrollment invitations are delivered. Required when invitations are enabled: the
   * link is deliberately never shown to its creator, so a deployment without a transport could
   * create invitations that are unreachable by anyone, including the person who made them.
   */
  readonly sendPrivateInvitationEmail?: SendPrivateInvitationEmail;
  /**
   * How public enrollment invitations are delivered to their creator. Optional because Better
   * Enrollment also returns a public link directly from create and resend operations.
   */
  readonly sendPublicInvitationEmail?: SendPublicInvitationEmail;
}

/** Everything the Better Auth instance needs that is not policy. */
export interface AuthInstanceOptions extends AuthDatabaseOptions {
  /** Signing secret. Must be supplied by the caller; there is deliberately no default. */
  readonly secret: string;
  /** Public origin the auth server is reachable at. */
  readonly baseUrl: string;
  /** Origins allowed to complete a credentialed round trip, typically the dashboard. */
  readonly trustedOrigins: readonly string[];
}

/**
 * Organization endpoints this package never exposes.
 *
 * The organization plugin ships its own invitation flow (an `invitation` row, an emailed id, an
 * accept endpoint). Code Zero invites through Better Enrollment instead, which covers the same
 * ground with proof of mailbox access, public links, and seat limits, so serving both would give
 * one concept two models and two sets of rules. The organization plugin has no option to turn its
 * flow off, so the endpoints are removed from the plugin before it is registered: they are absent
 * from `auth.api` and their routes answer 404, rather than existing behind a guard someone could
 * later relax.
 */
export const ORGANIZATION_INVITATION_ENDPOINTS = [
  'createInvitation',
  'acceptInvitation',
  'rejectInvitation',
  'cancelInvitation',
  'getInvitation',
  'listInvitations',
  'listUserInvitations',
] as const;

/**
 * Build the database, policy, and provider portion of the Better Auth options.
 *
 * Deliberately excludes `secret`, `baseURL`, and `trustedOrigins`: a same-origin host (a Nuxt
 * module hosting Better Auth in-process, for example) resolves those itself and must not have a
 * second, potentially divergent source for them.
 *
 * Every capability is decided by `options.config`, read when this runs rather than when the app
 * was built, and every capability that needs something to work — a mail transport, a relying
 * party, a secret — refuses to construct without it instead of registering endpoints that fail on
 * their first request. The refusals name what is missing and never echo a configured value.
 */
export function authBetterAuthOptions(options: AuthDatabaseOptions): Pick<
  BetterAuthOptions,
  'database' | 'emailAndPassword' | 'emailVerification' | 'session' | 'socialProviders' | 'user'
> & {
  // Declared here rather than picked from `BetterAuthOptions`: that interface's own `plugins`
  // field is typed `... | undefined` explicitly, which trips `exactOptionalPropertyTypes` at
  // every consumer that (rightly) declares its own `plugins` as merely optional, including
  // `@onmax/nuxt-better-auth`'s server config type. A required, mutable, always-array field is
  // assignable to both; `readonly` is not, because `BetterAuthOptions['plugins']` itself is not.
  plugins: BetterAuthPlugin[];
} {
  const { config } = options;
  assertCapabilitiesAreDeliverable(options);

  const plugins = authPlugins(options);

  // Widened to the option type Better Auth declares. Left as the concrete adapter type, the
  // inferred return type embeds types TypeScript cannot name in the emitted declarations.
  //
  // The client and the tables both come from `@code-zero/database`: this package owns
  // authentication policy, not the store, so the shape of `user` and `session` stays reviewable in
  // one place and any other consumer of those tables sees the same declarations.
  const database: BetterAuthOptions['database'] = drizzleAdapter(
    createDatabase({ connectionString: options.databaseUrl }),
    { provider: 'pg', schema },
  );

  const { sendVerificationEmail, sendPasswordResetEmail } = options;

  return {
    database,
    emailAndPassword: {
      enabled: config.enablePasswordLogin,
      minPasswordLength: config.minimumPasswordLength,
      maxPasswordLength: config.maximumPasswordLength,
      disableSignUp: !config.enableSignup,
      requireEmailVerification: config.requireEmailVerification,
      // A reset proves control of the mailbox, not of the sessions the old password opened, so
      // every one of them ends with it.
      revokeSessionsOnPasswordReset: true,
      ...(config.enablePasswordReset && sendPasswordResetEmail
        ? {
            sendResetPassword: async ({ user, url }) => {
              await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl: url });
            },
          }
        : {}),
    },
    ...(config.enableEmailVerification && sendVerificationEmail
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }) => {
              await sendVerificationEmail({ to: user.email, name: user.name, verifyUrl: url });
            },
          },
        }
      : {}),
    session: {
      expiresIn: config.sessionMaximumAgeSeconds,
    },
    ...socialProviders(options),
    plugins,
  };
}

/** The refusal for a capability turned on without what it needs. Names the need, never a value. */
function missing(capability: string, requirement: string): Error {
  return new Error(`cannot enable ${capability} without ${requirement}`);
}

/**
 * Refuse a policy that turns on a capability nothing can deliver.
 *
 * Each of these would otherwise register endpoints that accept a request and then fail, or worse
 * succeed without the message the visitor is waiting for. Failing at startup is the one place an
 * operator is guaranteed to see it.
 */
function assertCapabilitiesAreDeliverable(options: AuthDatabaseOptions): void {
  const { config } = options;
  const entitlements = options.entitlements ?? NO_ENTITLEMENTS;

  // Fail at construction rather than at the first private enrollment invitation: its link is not
  // returned to the creator, so without delivery it would be unreachable.
  if (config.enableInvitations && !options.sendPrivateInvitationEmail)
    throw missing('invitations', 'sendPrivateInvitationEmail');
  if (config.enableInvitations && !options.dashboardUrl)
    throw missing('invitations', 'dashboardUrl');
  if (config.enableEmailVerification && !options.sendVerificationEmail)
    throw missing('email verification', 'sendVerificationEmail');
  if (config.enablePasswordReset && !options.sendPasswordResetEmail)
    throw missing('password reset', 'sendPasswordResetEmail');
  if (config.enableMagicLink && !options.sendMagicLinkEmail)
    throw missing('magic link sign-in', 'sendMagicLinkEmail');
  if (config.enableTwoFactor && config.enableTwoFactorEmailOtp && !options.sendTwoFactorOtpEmail)
    throw missing('two-factor email codes', 'sendTwoFactorOtpEmail');
  if (config.enablePasskey && !options.passkey) throw missing('passkeys', 'relying party');
  if (entitlements.scim && !options.scim) throw missing('SCIM', 'SCIM_CREDENTIAL_HASH_SECRET');
  // Checked here, by length only, so the plugin's own refusal can never be the one that reports
  // it: that message is not ours to keep free of the value.
  if (entitlements.scim && (options.scim?.credentialHashSecret.length ?? 0) < 32)
    throw new Error('SCIM_CREDENTIAL_HASH_SECRET must be at least 32 characters');
}

/**
 * The social providers whose credentials are configured.
 *
 * Each one closes sign-up exactly when the password form does: a provider that could create an
 * account the form refuses would make `enableSignup` a suggestion.
 */
function socialProviders(options: AuthDatabaseOptions): Pick<BetterAuthOptions, 'socialProviders'> {
  const disableSignUp = !options.config.enableSignup;
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {
    ...(options.github ? { github: { ...options.github, disableSignUp } } : {}),
    ...(options.gitlab ? { gitlab: { ...options.gitlab, disableSignUp } } : {}),
    ...(options.google ? { google: { ...options.google, disableSignUp } } : {}),
  };
  return Object.keys(providers).length > 0 ? { socialProviders: providers } : {};
}

/**
 * Assemble the plugin list for a policy.
 *
 * Built imperatively into a `BetterAuthPlugin[]` rather than spread out of conditionals, because
 * each plugin's own return type is narrower than the interface and only stays assignable while the
 * target type is in view at the point it is added.
 */
function authPlugins(options: AuthDatabaseOptions): BetterAuthPlugin[] {
  const { config, dashboardUrl, sendPrivateInvitationEmail, sendPublicInvitationEmail } = options;
  const entitlements = options.entitlements ?? NO_ENTITLEMENTS;
  const plugins: BetterAuthPlugin[] = [];

  // Unconditional: it registers no route and mints nothing. It records which method an account
  // last signed in with, so the sign-in page can lead with it instead of presenting a returning
  // operator with an undifferentiated list. `storeInDatabase` mirrors the value onto
  // `user.lastLoginMethod` (see `@code-zero/database`'s `auth.ts`) so the hint survives a new
  // browser; the cookie the plugin also writes only ever covers the one it was set in.
  plugins.push(lastLoginMethod({ storeInDatabase: true }));

  // Also unconditional, and also route-free in the sense that matters: every endpoint it adds
  // requires an existing session, so it widens no way *into* the deployment. An operations
  // console is routinely driven from a personal account and a shared break-glass one, and
  // without this the second sign-in silently evicts the first.
  plugins.push(multiSession({ maximumSessions: config.maximumDeviceSessions }));

  // Unconditional, because it is the authority for a column every deployment has: `user.role`.
  // It decides which values administer the deployment (`adminRoles`), and every endpoint it adds
  // — ban, impersonate, set a role, list users — requires a session holding one of them, so it
  // opens nothing to anyone else. The control plane asks it rather than parsing the role itself.
  plugins.push(
    admin({
      defaultRole: config.defaultUserRole,
      adminRoles: [...config.adminRoles],
      impersonationSessionDuration: config.impersonationSessionSeconds,
    }),
  );

  // TOTP with backup codes and trusted devices. Registering it does not weaken sign-in: an
  // account has to re-enter its password, enroll a secret, and verify a first code before
  // `twoFactorEnabled` is set, and failed challenges count toward the plugin's account lockout.
  if (config.enableTwoFactor) {
    const send = config.enableTwoFactorEmailOtp ? options.sendTwoFactorOtpEmail : undefined;
    plugins.push(
      twoFactor({
        issuer: TWO_FACTOR_ISSUER,
        trustDeviceMaxAge: config.trustedDeviceMaxAgeSeconds,
        ...(send
          ? {
              otpOptions: {
                sendOTP: async ({ user, otp }) => {
                  await send({ to: user.email, name: user.name, code: otp });
                },
              },
            }
          : {}),
      }),
    );
  }

  // WebAuthn. Registration needs a session, so this adds a stronger way in for an account that
  // opted in and none for anyone else. The relying party comes from configuration only (see
  // `PasskeyRelyingParty`); the guard above refuses the capability without one.
  if (config.enablePasskey && options.passkey) {
    plugins.push(
      passkey({
        rpID: options.passkey.rpID,
        rpName: options.passkey.rpName,
        origin: options.passkey.origin,
      }),
    );
  }

  // Passwordless sign-in by mail. It closes sign-up exactly when the password form does, which is
  // also what lets Better Enrollment's `auto` mode see one consistent policy below.
  if (config.enableMagicLink && options.sendMagicLinkEmail) {
    const send = options.sendMagicLinkEmail;
    plugins.push(
      magicLink({
        disableSignUp: !config.enableSignup,
        expiresIn: config.magicLinkExpiresInSeconds,
        // A dump of the verification table must not be a list of working sign-in links.
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          await send({ to: email, signInUrl: url });
        },
      }),
    );
  }

  // Only on the deployments that need it — a preview or local origin the OAuth provider has no
  // callback registered for. `oauthProxyFromEnvironment` withholds the settings unless both the
  // production origin and the shared secret are configured, and the plugin itself declines to
  // proxy when `productionURL` matches this deployment's own `baseURL`, so production carries it
  // inertly rather than being a separate build.
  if (options.oauthProxy) {
    plugins.push(
      oAuthProxy({
        productionURL: options.oauthProxy.productionUrl,
        secret: options.oauthProxy.secret,
      }),
    );
  }

  // Better Auth's hosted infrastructure, registered only on the cloud-managed deployment. Both
  // plugins take the same connection settings, and both reach a service outside this deployment:
  // `sentinel` scores authentication attempts (credential stuffing, impossible travel, proof of
  // work) and `dash` reports analytics and mounts the administration API the hosted console
  // drives. `infraFromEnvironment` withholds the credentials unless all three are configured, so
  // a self-hosted install registers neither rather than registering endpoints that fail on their
  // first call — and, more to the point, never reports its authentication events to a third party
  // its operator did not sign up for.
  //
  // What `dash` costs, stated plainly because it is not obvious from the call: it mounts ~79
  // endpoints under `/api/auth/dash/**`, including `execute-adapter`, `impersonate-user`,
  // `delete-many-users`, and `export-users`. All but two are guarded by a JWT the hosted service
  // signs, verified against its JWKS with a five-minute maximum age, whose `apiKeyHash` claim must
  // additionally match a hash of this deployment's own `apiKey` — two independent factors, so
  // controlling the API origin alone does not admit a caller.
  //
  // The two exceptions are `accept-invitation` and `complete-invitation`, which cannot carry that
  // guard because the invitee holds no API key; they are authorized by an invitation token
  // validated against the hosted API instead. Both create a user with `emailVerified: true`,
  // optionally a credential account, and a session — through the internal adapter, so they bypass
  // `emailAndPassword.disableSignUp` and the Better Enrollment flow this package gates behind
  // `enableInvitations`. Enabling `dash` therefore delegates account creation to whoever can mint
  // an invitation in the hosted console, regardless of `enableSignup`. That is a deliberate
  // property of the cloud-managed deployment, not an oversight: it is why these credentials are
  // the one thing that turns this on, and why a self-hosted install must never carry them.
  if (options.infra) {
    const connection = {
      apiUrl: options.infra.apiUrl,
      kvUrl: options.infra.kvUrl,
      apiKey: options.infra.apiKey,
    };
    plugins.push(sentinel(connection));
    plugins.push(dash(connection));
  }

  // The RFC 8628 device flow, which is how the `zero` CLI signs in: it prints a short code, the
  // operator types it into `/device` in a browser they are already signed into, and the CLI polls
  // until a session token comes back. Gated because completing the flow mints a full session for
  // a client that never sees the browser.
  if (config.enableDeviceAuthorization) {
    // Registered with the device flow rather than separately, because it is the half that makes
    // the flow's output usable: `/device/token` returns a session token, but `getSession` reads
    // the session *cookie*, so without this the CLI would hold a credential no request could
    // present. `bearer` converts `Authorization: Bearer <session-token>` into that cookie before
    // the session is resolved.
    //
    // It shares the header with the control plane's own operator tokens, which is safe because
    // `apps/web`'s `buildRpcContext` resolves those first by constant-time comparison and
    // only falls through to a session lookup when none matched.
    //
    // The cost is that a leaked session token becomes replayable as a header, not only as a
    // cookie. That is inherent to letting a browserless client hold a session at all, which is
    // exactly what this flag grants, so the two are gated together rather than independently.
    plugins.push(bearer());
    plugins.push(
      deviceAuthorization({
        // A path, not an absolute URL: Better Auth resolves it against the deployment's own
        // `baseURL`, which is what lets one CLI serve a cloud-managed origin and a self-hosted one
        // without either being named here.
        verificationUri: DEVICE_VERIFICATION_PATH,
        // The plugin parses these as duration strings rather than seconds, so the policy's own
        // numbers are formatted rather than restated.
        expiresIn: `${config.deviceCodeExpiresInSeconds}s`,
        interval: `${config.deviceCodePollingIntervalSeconds}s`,
      }),
    );
  }

  if (config.enableOrganizations) {
    plugins.push(
      withoutEndpoints(
        organization({
          ac: accessControl,
          roles: organizationRoles,
          allowUserToCreateOrganization: config.allowUserToCreateOrganization,
          membershipLimit: config.organizationMembershipLimit,
          organizationHooks: {
            // Defense in depth behind the removed endpoints: a server-side caller that reached the
            // plugin's invitation path some other way is refused rather than served.
            beforeCreateInvitation: () => {
              throw new APIError('FORBIDDEN', {
                message: 'organization invitations are issued through enrollment invites',
              });
            },
          },
        }),
        ORGANIZATION_INVITATION_ENDPOINTS,
      ),
    );

    // Organization-owned keys for CI and the GitHub Action, registered after the organization
    // plugin whose permissions they are checked against (`apiKey: [...]` in `access.ts`). Every
    // property a caller could use to widen a key — rate limits, remaining uses, permissions — is
    // server-only in the plugin, and the key is stored hashed: its plaintext is returned once.
    if (config.enableApiKeys) {
      plugins.push(
        apiKey({
          references: 'organization',
          defaultPrefix: API_KEY_PREFIX,
          requireName: true,
          disableKeyHashing: false,
          // An API key never doubles as a browser session: it authenticates the control plane's
          // machine routes, not `/api/auth/**`.
          enableSessionForAPIKeys: false,
          keyExpiration: {
            // Seconds, despite the option's own documentation saying milliseconds: 1.7 applies
            // it with `getDate(value, "sec")`. A test pins the resulting expiry, so a release
            // that changes the unit fails here instead of minting keys that live 1000x longer.
            defaultExpiresIn: config.apiKeyExpiresInSeconds,
            maxExpiresIn: config.apiKeyMaximumExpiresInDays,
          },
          rateLimit: {
            enabled: true,
            timeWindow: config.apiKeyRateLimitWindowSeconds * 1000,
            maxRequests: config.apiKeyRateLimitMaxRequests,
          },
        }),
      );
    }
  }

  // Enterprise single sign-on, present only where the deployment is entitled to it. Without the
  // entitlement the plugin is not registered at all, so its endpoints — provider registration
  // included — do not exist rather than refusing at a guard.
  if (entitlements.sso) {
    plugins.push(
      sso({
        // A provider routes an email domain to itself, so the domain has to be proven first:
        // otherwise any organization could claim `example.com` and receive its users.
        domainVerification: { enabled: true },
        // The same sign-up policy as every other method: on an invite-only deployment an SSO
        // identity signs in to an account that already exists, and does not create one.
        disableImplicitSignUp: !config.enableSignup,
        organizationProvisioning: { defaultRole: 'member' },
      }),
    );
  }

  // Enterprise directory provisioning, under the same rule as SSO. Connections and their bearer
  // credentials are managed per organization in the database, and only an HMAC of each credential
  // is stored, keyed by a secret of its own.
  if (entitlements.scim && options.scim) {
    plugins.push(
      withDefinedSchema(
        scim({
          connections: [],
          managedConnections: { credentialHashSecret: options.scim.credentialHashSecret },
        }),
      ),
    );
  }

  // Added after the organization plugin, which it detects at construction to decide whether the
  // `org-join` and `org-create` invitation kinds exist at all.
  if (config.enableInvitations && dashboardUrl) {
    const enrollment = betterEnrollment({
      // Derived from the sign-up configuration rather than configured twice: with
      // `enableSignup` off every sign-up route is closed and invitations are the only way in,
      // and with it on they degrade to role and organization grants. Stating a mode here as
      // well is how the two drift apart.
      mode: 'auto',
      validRoles: [...config.userRoles],
      defaultRole: config.defaultUserRole,
      adminRoles: [...config.adminRoles],
      expiresIn: config.inviteExpiresInSeconds,
      publicExpiresIn: config.inviteExpiresInSeconds,
      buildInviteUrl: ({ token }) => inviteRedeemUrl(dashboardUrl, token),
      sendPrivateInvitation: async (data) => {
        // Checked in the guard above; narrowing here keeps the callback total.
        const send = sendPrivateInvitationEmail;
        if (!send) return;
        await send({
          to: data.email,
          name: data.name,
          inviterName: data.inviterName,
          organizationName: data.organizationName,
          acceptUrl: data.url,
        });
      },
      sendPublicInvitation: async (data) => {
        const send = sendPublicInvitationEmail;
        // A headless system invitation may deliberately have no attributable email address. Its
        // caller still receives the public link, but there is no valid mailbox to notify.
        if (!send || !data.inviterEmail) return;
        await send({
          to: data.inviterEmail,
          inviterName: data.inviterName,
          role: data.role,
          organizationName: data.organizationName,
          shareUrl: data.url,
          maxUses: data.maxUses,
          expiresAt: data.expiresAt,
        });
      },
      ...(config.enableOrganizations
        ? {
            organization: {
              ac: accessControl,
              // The same roles the organization plugin enforces, so "may this member invite into
              // the organization" has one answer: Better Enrollment checks
              // `invitation: ["create"]` against exactly these.
              roles: enrollmentRoles(),
              // Seats and memberships are the same cap seen from two sides, so they read from
              // one setting: a deployment cannot end up rejecting an invitation for an
              // organization that still has room, or the reverse.
              defaultSeatLimit: config.organizationMembershipLimit,
            },
          }
        : {}),
    });

    plugins.push(withDefinedSchema(enrollment));
  }

  return plugins;
}

/**
 * Return `plugin` with only the table groups it actually declares.
 *
 * Better Enrollment and SCIM both declare the table groups they add conditionally — enrollment's
 * `organization` and `user` appear only when org features or additional user fields are
 * configured, SCIM's catalog tables only with managed connections — as `?: ... | undefined`, and
 * under `exactOptionalPropertyTypes` an explicit `undefined` is not assignable to Better Auth's
 * merely-optional entries. Dropping the absent groups rather than asserting the type away keeps
 * the check honest and says the same thing at runtime: a table group that is not there should be
 * missing, not present and undefined.
 */
function withDefinedSchema(
  plugin: Omit<BetterAuthPlugin, 'schema'> & { schema: Record<string, unknown> },
): BetterAuthPlugin {
  const tables: NonNullable<BetterAuthPlugin['schema']> = {};
  for (const [model, table] of Object.entries(plugin.schema)) {
    if (isTableSchema(table)) tables[model] = table;
  }
  return { ...plugin, schema: tables };
}

/** Narrow one plugin table group at the runtime boundary, without asserting it into shape. */
function isTableSchema(table: unknown): table is NonNullable<BetterAuthPlugin['schema']>[string] {
  return typeof table === 'object' && table !== null && 'fields' in table;
}

/**
 * The organization roles in the shape Better Enrollment reads them.
 *
 * The same role objects, adapted at one seam: Better Auth's `authorize` reports success as
 * `{ success: true, error?: undefined }`, which `exactOptionalPropertyTypes` will not match against
 * the plugin's `error?: string`. Restating the result keeps every decision in `access.ts`.
 */
function enrollmentRoles() {
  return Object.fromEntries(
    Object.entries(organizationRoles).map(([name, role]) => [
      name,
      {
        authorize: (permissions: Record<string, string[]>, connector?: 'OR' | 'AND') => {
          const result = role.authorize(permissions, connector);
          return result.success ? { success: true } : { success: false, error: result.error };
        },
      },
    ]),
  );
}

/**
 * Return a copy of `plugin` without the named endpoints.
 *
 * Better Auth mounts a route for every entry in a plugin's `endpoints` and exposes each on
 * `auth.api`, so an entry that is not there is a route that does not exist. The plugin's own
 * object is left untouched.
 */
function withoutEndpoints(plugin: BetterAuthPlugin, names: readonly string[]): BetterAuthPlugin {
  const endpoints = Object.fromEntries(
    Object.entries(plugin.endpoints ?? {}).filter(([name]) => !names.includes(name)),
  );
  return { ...plugin, endpoints };
}

/**
 * Build a standalone Better Auth instance from explicit options.
 *
 * A factory rather than a module-level singleton, so that tests and alternative composition roots
 * can construct an isolated instance without reaching into the environment. Kept for callers that
 * own their own signing secret and origin rather than delegating them to a host module.
 */
export function createAuth(options: AuthInstanceOptions) {
  return betterAuth({
    ...authBetterAuthOptions(options),
    secret: options.secret,
    baseURL: options.baseUrl,
    trustedOrigins: [...options.trustedOrigins],
  });
}

/**
 * Build the link an enrollment invitation points at.
 *
 * One path for every invitation kind and both modes, carrying only the token: what the page has to
 * render is decided by the auth server when it reads the token, so the URL never encodes whether
 * the recipient is joining an organization, founding one, or merely signing up. That also keeps
 * the link from disclosing anything about the invitation to whoever it is forwarded to.
 */
function inviteRedeemUrl(dashboardUrl: string, token: string): string {
  const url = new URL('/invite', dashboardUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Missing configuration is a deployment error, not something to paper over with a default. */
function requireEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

/**
 * Resolve `authBetterAuthOptions` options from the environment.
 *
 * Deliberately does not require `AUTH_DASHBOARD_ORIGIN`: a caller that only needs the database
 * and policy shape (no signing, no origin) should not be made to supply one, and one that needs
 * invitation links resolves `dashboardUrl` through {@link authOptionsFromEnvironment} instead. The
 * passkey relying party reads it when it is set, and is simply absent when nothing names an origin.
 *
 * Entitlements are not read here: which edition a deployment runs is the composition root's
 * decision, passed in as `entitlements`, so no environment variable alone can switch SSO or SCIM
 * on.
 *
 * The connection string is resolved by `@code-zero/database` so the store has one variable
 * regardless of which process opens it; it accepts the pre-split `AUTH_DATABASE_URL` as well. The
 * error messages name the variable but never echo its value, so a misconfigured deployment cannot
 * leak a secret or a connection string into a crash log.
 */
export function authDatabaseOptionsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AuthDatabaseOptions {
  const github = githubCredentialsFromEnvironment(environment);
  const gitlab = gitlabCredentialsFromEnvironment(environment);
  const google = googleCredentialsFromEnvironment(environment);
  const relyingParty = passkeyFromEnvironment(environment);
  const scimSettings = scimFromEnvironment(environment);
  const oauthProxy = oauthProxyFromEnvironment(environment);
  const infra = infraFromEnvironment(environment);
  return {
    databaseUrl: databaseUrlFromEnvironment(environment),
    config: authConfigFromEnvironment(environment),
    ...(github ? { github } : {}),
    ...(gitlab ? { gitlab } : {}),
    ...(google ? { google } : {}),
    ...(relyingParty ? { passkey: relyingParty } : {}),
    ...(scimSettings ? { scim: scimSettings } : {}),
    ...(oauthProxy ? { oauthProxy } : {}),
    ...(infra ? { infra } : {}),
  };
}

/**
 * Resolve `createAuth` options from the environment.
 *
 * The error messages name the variable but never echo its value, so a misconfigured deployment
 * cannot leak a secret or a connection string into a crash log.
 */
export function authOptionsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AuthInstanceOptions {
  const dashboardOrigin = requireEnvironmentValue(environment, 'AUTH_DASHBOARD_ORIGIN');

  return {
    ...authDatabaseOptionsFromEnvironment(environment),
    secret: requireEnvironmentValue(environment, 'BETTER_AUTH_SECRET'),
    baseUrl: requireEnvironmentValue(environment, 'BETTER_AUTH_URL'),
    trustedOrigins: [dashboardOrigin],
    // The same origin the dashboard is served from, so invitation links resolve to the UI.
    dashboardUrl: dashboardOrigin,
  };
}

/** The constructed Better Auth instance. */
export type AuthInstance = ReturnType<typeof createAuth>;

/** Session record as the dashboard receives it. */
export type Session = AuthInstance['$Infer']['Session'];

/** Authenticated user as the dashboard receives it. */
export type User = Session['user'];
