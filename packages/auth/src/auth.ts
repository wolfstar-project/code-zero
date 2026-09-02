import { dash, sentinel } from '@better-auth/infra';
import { createDatabase, databaseUrlFromEnvironment, schema } from '@code-zero/database';
import { betterEnrollment } from '@octopi-ai/better-enrollment';
import { betterAuth } from 'better-auth';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import {
  bearer,
  deviceAuthorization,
  lastLoginMethod,
  multiSession,
  oAuthProxy,
  organization,
} from 'better-auth/plugins';
import type { OrganizationOptions } from 'better-auth/plugins';

import {
  authConfigFromEnvironment,
  DEVICE_VERIFICATION_PATH,
  githubCredentialsFromEnvironment,
  infraFromEnvironment,
  oauthProxyFromEnvironment,
} from './config.js';
import type {
  AuthConfig,
  GithubOauthCredentials,
  InfraConfig,
  OauthProxyConfig,
} from './config.js';

/**
 * Error code an organization invitation is refused with when the deployment cannot deliver it.
 *
 * Travels to the client as the error body's `code`, so a UI can say why in the visitor's language
 * rather than rendering this package's English message: an operator has to configure a transport,
 * and the org admin who pressed "invite" should be told that rather than shown a generic failure.
 * The dashboard mirrors the literal instead of importing it — this package pulls Better Auth and
 * the database adapter, neither of which may reach a browser bundle.
 */
export const ORGANIZATION_INVITATION_DELIVERY_UNAVAILABLE = 'INVITATION_DELIVERY_UNAVAILABLE';

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
 * Build the database, policy, and provider portion of the Better Auth options.
 *
 * Deliberately excludes `secret`, `baseURL`, and `trustedOrigins`: a same-origin host (a Nuxt
 * module hosting Better Auth in-process, for example) resolves those itself and must not have a
 * second, potentially divergent source for them.
 */
export function authBetterAuthOptions(options: AuthDatabaseOptions): Pick<
  BetterAuthOptions,
  'database' | 'emailAndPassword' | 'session' | 'socialProviders' | 'user'
> & {
  // Declared here rather than picked from `BetterAuthOptions`: that interface's own `plugins`
  // field is typed `... | undefined` explicitly, which trips `exactOptionalPropertyTypes` at
  // every consumer that (rightly) declares its own `plugins` as merely optional, including
  // `@onmax/nuxt-better-auth`'s server config type. A required, mutable, always-array field is
  // assignable to both; `readonly` is not, because `BetterAuthOptions['plugins']` itself is not.
  plugins: BetterAuthPlugin[];
} {
  const { config } = options;

  // Fail at construction rather than at the first private enrollment invitation: its link is not
  // returned to the creator, so without delivery it would be unreachable.
  if (config.enableInvitations && !options.sendPrivateInvitationEmail)
    throw new Error('invitations are enabled but no sendPrivateInvitationEmail was provided');
  if (config.enableInvitations && !options.dashboardUrl)
    throw new Error('invitations are enabled but no dashboardUrl was provided');

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

  return {
    database,
    emailAndPassword: {
      enabled: config.enablePasswordLogin,
      minPasswordLength: config.minimumPasswordLength,
      disableSignUp: !config.enableSignup,
    },
    session: {
      expiresIn: config.sessionMaximumAgeSeconds,
    },
    // Declared unconditionally, because the column exists in every deployment's store whether or
    // not invitations are enabled, and a field the adapter does not know about is one it silently
    // drops on write. Better Auth keeps multiple roles in this one comma-separated string, so any
    // code that sets it must send the full set: a partial write is a silent revocation, not a
    // merge. Invitation redemption is the only path that merges rather than replaces.
    user: { additionalFields: { role: { type: 'string', required: false, input: false } } },
    ...(options.github
      ? { socialProviders: { github: { ...options.github, disableSignUp: !config.enableSignup } } }
      : {}),
    plugins,
  };
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
    // `apps/dashboard`'s `buildRpcContext` resolves those first by constant-time comparison and
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
      organization({
        allowUserToCreateOrganization: config.allowUserToCreateOrganization,
        membershipLimit: config.organizationMembershipLimit,
        invitationExpiresIn: config.invitationExpiresInSeconds,
        ...organizationInvitationDelivery(options),
      }),
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
      adminRoles: [...config.inviteAdminRoles],
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
              // Seats and memberships are the same cap seen from two sides, so they read from
              // one setting: a deployment cannot end up rejecting an invitation for an
              // organization that still has room, or the reverse.
              defaultSeatLimit: config.organizationMembershipLimit,
            },
          }
        : {}),
    });

    // The plugin declares the table groups it adds conditionally — `organization` and `user`
    // appear only when org features or additional user fields are configured — as
    // `?: ... | undefined`, and under `exactOptionalPropertyTypes` an explicit `undefined` is not
    // assignable to Better Auth's merely-optional entries. Dropping the absent groups rather than
    // asserting the type away keeps the check honest and says the same thing at runtime: a table
    // group that is not there should be missing, not present and undefined.
    plugins.push({
      ...enrollment,
      schema: Object.fromEntries(
        Object.entries(enrollment.schema).filter(
          (entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== undefined,
        ),
      ),
    });
  }

  return plugins;
}

/**
 * Decide what the organization plugin does with its own member invitations.
 *
 * Better Auth mints an invitation id and nothing else: it builds no link, and the dashboard never
 * shows one to the inviter, so `sendInvitationEmail` is the only path an organization invitation
 * travels. Wiring it to the same delivery this package already declares for private enrollment
 * invitations keeps one contract for "an invitation addressed to a mailbox", and keeps
 * `packages/auth` free of any dependency on `packages/mail`.
 *
 * Without a transport or a dashboard origin the capability is closed at creation instead: an
 * invitation nobody can be told about is a pending row that silently consumes a seat and leaves
 * its recipient waiting for mail that is never sent. Organizations themselves stay available on
 * such a deployment — pre-provisioned memberships, roles, and switching are unaffected — which is
 * why this is a refusal at the endpoint rather than a startup guard like the enrollment one.
 */
function organizationInvitationDelivery(
  options: AuthDatabaseOptions,
): Pick<OrganizationOptions, 'organizationHooks' | 'sendInvitationEmail'> {
  const { dashboardUrl, sendPrivateInvitationEmail: send } = options;

  if (!send || !dashboardUrl) {
    return {
      organizationHooks: {
        beforeCreateInvitation: () => {
          throw new APIError('SERVICE_UNAVAILABLE', {
            code: ORGANIZATION_INVITATION_DELIVERY_UNAVAILABLE,
            message: 'organization invitations require a configured invitation delivery transport',
          });
        },
      },
    };
  }

  return {
    sendInvitationEmail: async (data) => {
      await send({
        to: data.email,
        // Better Auth invites an address rather than a person: the recipient may have no account
        // yet, and the inviter is never asked for a name to go with the address.
        name: null,
        inviterName: data.inviter.user.name,
        organizationName: data.organization.name,
        acceptUrl: organizationInvitationUrl(dashboardUrl, data.id),
      });
    },
  };
}

/**
 * Build the link an organization invitation points at.
 *
 * The id is path-encoded rather than interpolated raw: it comes back from the store, and a link is
 * the one place a stray `/` or `?` would change what the recipient's browser asks for.
 */
function organizationInvitationUrl(dashboardUrl: string, invitationId: string): string {
  return new URL(
    `/organizations/accept-invitation/${encodeURIComponent(invitationId)}`,
    dashboardUrl,
  ).toString();
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
 * Deliberately does not read `AUTH_DASHBOARD_ORIGIN`: a caller that only needs the database and
 * policy shape (no signing, no origin) should not be made to supply one, and one that needs
 * invitation links resolves `dashboardUrl` through {@link authOptionsFromEnvironment} instead.
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
  const oauthProxy = oauthProxyFromEnvironment(environment);
  const infra = infraFromEnvironment(environment);
  return {
    databaseUrl: databaseUrlFromEnvironment(environment),
    config: authConfigFromEnvironment(environment),
    ...(github ? { github } : {}),
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
