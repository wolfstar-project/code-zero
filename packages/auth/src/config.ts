/**
 * Authentication policy, kept separate from the Better Auth instance so that callers, tests, and
 * the dashboard can reason about which capabilities are enabled without constructing a database
 * connection.
 */

/** Shortest password the dashboard will accept when registering or changing credentials. */
export const MINIMUM_PASSWORD_LENGTH = 8;

/**
 * Longest password accepted. Better Auth 1.7 rejects anything longer with `PASSWORD_TOO_LONG`
 * instead of hashing it, so the bound is stated here rather than inherited: it is what keeps a
 * multi-megabyte "password" from being handed to the hash function on every sign-in attempt.
 */
export const MAXIMUM_PASSWORD_LENGTH = 128;

/** Issuer shown next to the account in an authenticator app. */
export const TWO_FACTOR_ISSUER = 'Code Zero';

/** How long a device a second factor was passed on stays trusted, skipping the challenge. */
export const TRUSTED_DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Relying-party name shown by the browser and the authenticator when registering a passkey. */
export const PASSKEY_RELYING_PARTY_NAME = 'Code Zero';

/** How long a magic sign-in link stays redeemable. */
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 60 * 10;

/**
 * Prefix every API key carries, so a leaked one is recognisable as this product's in a secret
 * scanner and in a log line, without the prefix itself being secret.
 */
export const API_KEY_PREFIX = 'cz_';

/** How long a new API key stays valid unless its creator picks a shorter lifetime. */
export const API_KEY_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 90;

/** The longest lifetime a creator may pick for an API key, in days. */
export const API_KEY_MAXIMUM_EXPIRES_IN_DAYS = 365;

/** Requests one API key may make per {@link API_KEY_RATE_LIMIT_WINDOW_SECONDS}. */
export const API_KEY_RATE_LIMIT_MAX_REQUESTS = 600;

/** The window {@link API_KEY_RATE_LIMIT_MAX_REQUESTS} is counted over. */
export const API_KEY_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

/** How long an administrator's impersonation session lasts before it has to be restarted. */
export const IMPERSONATION_SESSION_SECONDS = 60 * 60;

/** How long a session stays valid without re-authentication. */
export const SESSION_MAXIMUM_AGE_SECONDS = 60 * 60 * 24 * 7;

/** Upper bound on members in a single organization. */
export const ORGANIZATION_MEMBERSHIP_LIMIT = 100;

/** How long an unredeemed invitation stays valid. */
export const INVITE_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

/**
 * How many concurrent accounts one browser may stay signed into.
 *
 * An operations console is routinely used with a personal account and a shared break-glass one;
 * the cap exists so a shared workstation cannot accumulate sessions indefinitely.
 */
export const MAXIMUM_DEVICE_SESSIONS = 5;

/**
 * How long a device-authorization request stays claimable before the device must restart the flow.
 *
 * RFC 8628 recommends a short window because the user code is displayed in the clear on the
 * device; ten minutes is long enough to switch to a browser and sign in, short enough that an
 * abandoned code is not left standing.
 */
export const DEVICE_CODE_EXPIRES_IN_SECONDS = 60 * 10;

/** Minimum seconds a device must wait between polls before the server answers `slow_down`. */
export const DEVICE_CODE_POLLING_INTERVAL_SECONDS = 5;

/** Path on the dashboard where a human types the code their device is displaying. */
export const DEVICE_VERIFICATION_PATH = '/device';

/**
 * Application-wide role granted to an account that no invitation gave a role to.
 *
 * Distinct from an organization role: this one is app-wide, `member.role` is scoped to one
 * organization.
 */
export const DEFAULT_USER_ROLE = 'user';

/** The app-wide role that administers the deployment, invitations included. */
export const ADMIN_USER_ROLE = 'admin';

/**
 * Every app-wide role an invitation may grant.
 *
 * Declared as a closed set so a typo in an admin's invitation payload is rejected at creation
 * rather than silently granting a role nothing ever checks for.
 */
export const USER_ROLES: readonly string[] = [DEFAULT_USER_ROLE, ADMIN_USER_ROLE];

/** Capabilities the deployment exposes on its sign-in surface. */
export interface AuthConfig {
  /** Whether new accounts may be created through the sign-in page. */
  readonly enableSignup: boolean;
  /** Whether email and password credentials are accepted. */
  readonly enablePasswordLogin: boolean;
  /** Whether the GitHub OAuth button is offered. */
  readonly enableGithubOauth: boolean;
  /** Whether the GitLab OAuth button is offered; on only when its credentials are configured. */
  readonly enableGitlabOauth: boolean;
  /** Whether the Google OAuth button is offered; on only when its credentials are configured. */
  readonly enableGoogleOauth: boolean;
  /**
   * Whether new accounts are sent a verification link. Requires a delivery transport: enabling it
   * without one fails startup rather than promising a message nobody sends.
   */
  readonly enableEmailVerification: boolean;
  /**
   * Whether an unverified address is refused at password sign-in. Implies
   * {@link enableEmailVerification}: requiring a link nobody can receive would lock every new
   * account out.
   */
  readonly requireEmailVerification: boolean;
  /** Whether a forgotten password can be reset by mail. Requires a delivery transport. */
  readonly enablePasswordReset: boolean;
  /** Whether a passwordless sign-in link can be requested by mail. Requires a delivery transport. */
  readonly enableMagicLink: boolean;
  /**
   * Whether accounts may enroll a TOTP second factor with backup codes and trusted devices.
   *
   * On by default: it adds no way *into* the deployment, only a stronger one for an account that
   * opts in, and enrollment itself requires a session and the account's password.
   */
  readonly enableTwoFactor: boolean;
  /** Whether a second factor may also be delivered as a one-time code by mail. */
  readonly enableTwoFactorEmailOtp: boolean;
  /**
   * Whether accounts may register passkeys and sign in with them.
   *
   * On by default for the same reason as {@link enableTwoFactor}, but only where a relying party
   * resolves: WebAuthn binds every credential to an origin, so a deployment that cannot name its
   * own refuses the capability rather than registering credentials for a guessed one.
   */
  readonly enablePasskey: boolean;
  /**
   * Whether organizations may mint API keys for CI and the GitHub Action.
   *
   * Keys belong to an organization, so this is refused while organizations are off.
   */
  readonly enableApiKeys: boolean;
  /**
   * Whether Better Auth's hosted infrastructure is wired up.
   *
   * True only on the cloud-managed deployment, because it is derived from credentials only that
   * deployment holds. Published to the browser so the dashboard's auth client can decide whether
   * to load the matching client plugins — the sentinel one identifies the visitor against a
   * third-party KV service, which must not happen on a self-hosted install.
   */
  readonly enableInfra: boolean;
  /** Whether organizations, memberships and invitations are exposed at all. */
  readonly enableOrganizations: boolean;
  /**
   * Whether invitations are exposed at all.
   *
   * Independent of {@link enableSignup}: with signup off, invitations are the only way into the
   * deployment; with it on, they stay useful as role and organization grants.
   */
  readonly enableInvitations: boolean;
  /**
   * Whether any signed-in user may create an organization.
   *
   * Separate from {@link enableOrganizations} so an operator can run a deployment where
   * organizations exist but only pre-provisioned ones do.
   */
  readonly allowUserToCreateOrganization: boolean;
  /**
   * Whether limited-input clients — the `zero` CLI above all — may obtain a session through the
   * RFC 8628 device flow.
   *
   * Off by default for the same reason organizations and invitations are: turning it on adds
   * routes that mint a full session for whoever completes the flow, which is not a capability a
   * deployment should acquire by upgrading. Applies equally to a cloud-managed deployment and a
   * self-hosted one; only the origin the CLI is pointed at differs.
   */
  readonly enableDeviceAuthorization: boolean;
  readonly minimumPasswordLength: number;
  readonly maximumPasswordLength: number;
  readonly sessionMaximumAgeSeconds: number;
  readonly organizationMembershipLimit: number;
  readonly inviteExpiresInSeconds: number;
  /** App-wide role an invitation grants when its creator names none. */
  readonly defaultUserRole: string;
  /** The closed set of app-wide roles an invitation may grant. */
  readonly userRoles: readonly string[];
  /**
   * App-wide roles that administer the deployment.
   *
   * One list for every consumer: Better Auth's admin plugin reads it to decide who may ban,
   * impersonate, and grant roles, and Better Enrollment reads the same one to decide who may
   * manage invitations, so the two can never disagree about who an administrator is.
   */
  readonly adminRoles: readonly string[];
  /** How many accounts one browser may hold concurrent sessions for. */
  readonly maximumDeviceSessions: number;
  /** How long a device-authorization request stays claimable. */
  readonly deviceCodeExpiresInSeconds: number;
  /** Minimum seconds between a device's polls for its token. */
  readonly deviceCodePollingIntervalSeconds: number;
  /** How long a trusted device skips the second-factor challenge. */
  readonly trustedDeviceMaxAgeSeconds: number;
  /** How long a magic sign-in link stays redeemable. */
  readonly magicLinkExpiresInSeconds: number;
  /** Default lifetime of a new API key. */
  readonly apiKeyExpiresInSeconds: number;
  /** Longest lifetime an API key may be given, in days. */
  readonly apiKeyMaximumExpiresInDays: number;
  /** Requests one API key may make per window. */
  readonly apiKeyRateLimitMaxRequests: number;
  /** The API-key rate-limit window. */
  readonly apiKeyRateLimitWindowSeconds: number;
  /** How long an impersonation session lasts. */
  readonly impersonationSessionSeconds: number;
}

/**
 * Conservative defaults: a self-hosted operations console starts closed to public registration,
 * and social login stays off until credentials are actually configured.
 */
export const defaultAuthConfig: AuthConfig = {
  enableSignup: false,
  enablePasswordLogin: true,
  enableGithubOauth: false,
  enableGitlabOauth: false,
  enableGoogleOauth: false,
  // The mail-backed flows stay off until an operator turns them on, because each one needs a
  // delivery transport and enabling one without it is a startup error, not a silent no-op.
  enableEmailVerification: false,
  requireEmailVerification: false,
  enablePasswordReset: false,
  enableMagicLink: false,
  enableTwoFactor: true,
  enableTwoFactorEmailOtp: false,
  // Off in the default policy because no relying party is known without an environment;
  // `authConfigFromEnvironment` turns it on once one resolves.
  enablePasskey: false,
  enableApiKeys: false,
  // Off until the hosted credentials exist, which is what keeps a self-hosted deployment from
  // reporting its authentication events to a service its operator never signed up for.
  enableInfra: false,
  // Organizations stay off until an operator asks for them: enabling them changes what every
  // authenticated request is scoped to, which is not something a deployment should acquire by
  // upgrading.
  enableOrganizations: false,
  allowUserToCreateOrganization: false,
  // Off until an operator asks for them, for the same reason organizations are: turning
  // invitations on adds routes that mint credentials for new accounts, which is not something a
  // deployment should acquire by upgrading.
  enableInvitations: false,
  // Off until an operator asks for it, for the same reason the two above are: the device flow
  // mints a session for a client that never sees the browser, so it has to be a deliberate grant.
  enableDeviceAuthorization: false,
  minimumPasswordLength: MINIMUM_PASSWORD_LENGTH,
  maximumPasswordLength: MAXIMUM_PASSWORD_LENGTH,
  sessionMaximumAgeSeconds: SESSION_MAXIMUM_AGE_SECONDS,
  organizationMembershipLimit: ORGANIZATION_MEMBERSHIP_LIMIT,
  inviteExpiresInSeconds: INVITE_EXPIRES_IN_SECONDS,
  defaultUserRole: DEFAULT_USER_ROLE,
  userRoles: USER_ROLES,
  adminRoles: [ADMIN_USER_ROLE],
  maximumDeviceSessions: MAXIMUM_DEVICE_SESSIONS,
  deviceCodeExpiresInSeconds: DEVICE_CODE_EXPIRES_IN_SECONDS,
  deviceCodePollingIntervalSeconds: DEVICE_CODE_POLLING_INTERVAL_SECONDS,
  trustedDeviceMaxAgeSeconds: TRUSTED_DEVICE_MAX_AGE_SECONDS,
  magicLinkExpiresInSeconds: MAGIC_LINK_EXPIRES_IN_SECONDS,
  apiKeyExpiresInSeconds: API_KEY_EXPIRES_IN_SECONDS,
  apiKeyMaximumExpiresInDays: API_KEY_MAXIMUM_EXPIRES_IN_DAYS,
  apiKeyRateLimitMaxRequests: API_KEY_RATE_LIMIT_MAX_REQUESTS,
  apiKeyRateLimitWindowSeconds: API_KEY_RATE_LIMIT_WINDOW_SECONDS,
  impersonationSessionSeconds: IMPERSONATION_SESSION_SECONDS,
};

/** OAuth client credentials, present only when both halves are configured. */
export interface OauthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** GitHub OAuth credentials, present only when both halves are configured. */
export type GithubOauthCredentials = OauthCredentials;

/** Google OAuth credentials, present only when both halves are configured. */
export type GoogleOauthCredentials = OauthCredentials;

/** GitLab OAuth credentials, plus the instance to talk to when it is not gitlab.com. */
export interface GitlabOauthCredentials extends OauthCredentials {
  /** A self-managed GitLab's origin. Absent means gitlab.com. */
  readonly issuer?: string;
}

/** Both halves of one provider's credentials, or `undefined` unless both are present. */
function oauthCredentialsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  prefix: string,
): OauthCredentials | undefined {
  const clientId = environment[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = environment[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

/**
 * Read GitHub OAuth credentials from the environment.
 *
 * Returns `undefined` unless both values are present, so a half-configured deployment fails
 * closed rather than advertising a provider that cannot complete a round trip.
 *
 * The environment is passed in so callers stay deterministic in tests.
 */
export function githubCredentialsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): GithubOauthCredentials | undefined {
  return oauthCredentialsFromEnvironment(environment, 'GITHUB');
}

/**
 * Read GitLab OAuth credentials from the environment, failing closed like
 * {@link githubCredentialsFromEnvironment}. `GITLAB_ISSUER` points the provider at a self-managed
 * instance; without it the provider talks to gitlab.com.
 */
export function gitlabCredentialsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): GitlabOauthCredentials | undefined {
  const credentials = oauthCredentialsFromEnvironment(environment, 'GITLAB');
  if (!credentials) return undefined;
  const issuer = environment.GITLAB_ISSUER?.trim();
  return issuer ? { ...credentials, issuer } : credentials;
}

/** Read Google OAuth credentials from the environment, failing closed the same way. */
export function googleCredentialsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): GoogleOauthCredentials | undefined {
  return oauthCredentialsFromEnvironment(environment, 'GOOGLE');
}

/**
 * The WebAuthn relying party passkeys are bound to.
 *
 * Every field is configuration rather than something derived from a request: a credential is
 * bound to the relying-party id it was registered under, so an id that followed whatever `Host`
 * header arrived would let a spoofed host register credentials that the real one then accepts.
 */
export interface PasskeyRelyingParty {
  /** The registrable domain credentials are scoped to, e.g. `app.example.com`. */
  readonly rpID: string;
  /** The name the browser and the authenticator show the account holder. */
  readonly rpName: string;
  /** The exact origin assertions must come from, e.g. `https://app.example.com`. */
  readonly origin: string;
}

/**
 * Resolve the passkey relying party from the environment.
 *
 * `AUTH_PASSKEY_ORIGIN` names the origin; without it the dashboard's own public origin is used
 * (`AUTH_DASHBOARD_ORIGIN`, then `NUXT_PUBLIC_SITE_URL`), since that is the page the ceremony runs
 * on. `AUTH_PASSKEY_RP_ID` defaults to that origin's hostname. Returns `undefined` when no origin
 * parses, which is what keeps the capability off rather than bound to a guess.
 */
export function passkeyFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PasskeyRelyingParty | undefined {
  const configured = [
    environment.AUTH_PASSKEY_ORIGIN,
    environment.AUTH_DASHBOARD_ORIGIN,
    environment.NUXT_PUBLIC_SITE_URL,
  ]
    .map((value) => value?.trim())
    .find((value) => value);
  if (!configured) return undefined;
  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    return undefined;
  }
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return undefined;
  return {
    rpID: environment.AUTH_PASSKEY_RP_ID?.trim() || origin.hostname,
    rpName: environment.AUTH_PASSKEY_RP_NAME?.trim() || PASSKEY_RELYING_PARTY_NAME,
    origin: origin.origin,
  };
}

/**
 * Settings the SCIM plugin needs once the `scim` entitlement registers it.
 *
 * The plugin keeps per-organization provisioning connections in the database and stores only an
 * HMAC of each bearer credential, keyed by this secret. It is its own variable rather than
 * `BETTER_AUTH_SECRET` so rotating one never invalidates the other.
 */
export interface ScimConfig {
  /** At least 32 characters. Never logged, never echoed into an error message. */
  readonly credentialHashSecret: string;
}

/** Read the SCIM settings, or `undefined` when `SCIM_CREDENTIAL_HASH_SECRET` is unset. */
export function scimFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ScimConfig | undefined {
  const credentialHashSecret = environment.SCIM_CREDENTIAL_HASH_SECRET?.trim();
  return credentialHashSecret ? { credentialHashSecret } : undefined;
}

/**
 * Credentials for Better Auth's hosted infrastructure (`@better-auth/infra`).
 *
 * All three are required together: the `dash` and `sentinel` plugins call an API and a KV service
 * that are provisioned per project, so a partially configured deployment would register endpoints
 * that fail on their first request rather than staying closed.
 */
export interface InfraConfig {
  /** Dash API origin. */
  readonly apiUrl: string;
  /** KV service origin, which is also what the browser-side sentinel client identifies against. */
  readonly kvUrl: string;
  /** Project API key. Never logged, never echoed into an error message. */
  readonly apiKey: string;
}

/**
 * Read the hosted-infrastructure credentials from the environment.
 *
 * Returns `undefined` unless all three are present, which is what confines this capability to the
 * cloud-managed deployment: a self-hosted operator has no project on Better Auth's service, so the
 * variables are absent and neither plugin is registered. That matters beyond a missing feature —
 * `sentinel` reports authentication events to a third party, and `dash` mounts a privileged
 * administration surface, so both have to stay off unless a deployment deliberately opted in.
 */
export function infraFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): InfraConfig | undefined {
  const apiUrl = environment.BETTER_AUTH_API_URL?.trim();
  const kvUrl = environment.BETTER_AUTH_KV_URL?.trim();
  const apiKey = environment.BETTER_AUTH_API_KEY?.trim();
  if (!apiUrl || !kvUrl || !apiKey) return undefined;
  return { apiUrl, kvUrl, apiKey };
}

/**
 * Settings that route a preview or local deployment's OAuth round trip through production.
 *
 * Present only when both halves are configured, for the same reason
 * {@link GithubOauthCredentials} is: the proxy is useless without the production origin to bounce
 * off, and it fails at `state_mismatch` rather than at startup without a secret every
 * participating environment shares.
 */
export interface OauthProxyConfig {
  /** The production origin registered as the provider's callback URL. */
  readonly productionUrl: string;
  /**
   * The key every participating environment encrypts the proxied profile with.
   *
   * Deliberately its own variable rather than `BETTER_AUTH_SECRET`: production and preview should
   * not share a signing secret, and a leaked proxy key must not be able to forge sessions.
   */
  readonly secret: string;
}

/**
 * Read the OAuth proxy settings from the environment.
 *
 * Returns `undefined` unless both values are present, so a half-configured preview deployment
 * runs the ordinary OAuth flow — which fails visibly against an unregistered callback URL —
 * rather than a proxy flow that fails obscurely mid-round-trip.
 */
export function oauthProxyFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OauthProxyConfig | undefined {
  const productionUrl = environment.OAUTH_PROXY_PRODUCTION_URL?.trim();
  const secret = environment.OAUTH_PROXY_SECRET?.trim();
  if (!productionUrl || !secret) return undefined;
  return { productionUrl, secret };
}

/**
 * Resolve the effective policy for a deployment.
 *
 * `AUTH_ENABLE_SIGNUP` opts a deployment into self-registration; GitHub OAuth switches itself on
 * only when usable credentials exist.
 */
export function authConfigFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AuthConfig {
  // Opt-in flags accept the literal `true` only and opt-out flags the literal `false` only, so a
  // typo leaves each one at its conservative default instead of flipping it.
  const optIn = (name: string) => environment[name] === 'true';
  const optOut = (name: string) => environment[name] !== 'false';
  const enableOrganizations = optIn('AUTH_ENABLE_ORGANIZATIONS');
  const requireEmailVerification = optIn('AUTH_REQUIRE_EMAIL_VERIFICATION');
  const enableTwoFactor = optOut('AUTH_ENABLE_TWO_FACTOR');
  return {
    ...defaultAuthConfig,
    enableSignup: optIn('AUTH_ENABLE_SIGNUP'),
    enableInvitations: optIn('AUTH_ENABLE_INVITATIONS'),
    enableDeviceAuthorization: optIn('AUTH_ENABLE_DEVICE_AUTHORIZATION'),
    enableGithubOauth: githubCredentialsFromEnvironment(environment) !== undefined,
    enableGitlabOauth: gitlabCredentialsFromEnvironment(environment) !== undefined,
    enableGoogleOauth: googleCredentialsFromEnvironment(environment) !== undefined,
    enableInfra: infraFromEnvironment(environment) !== undefined,
    // Requiring verification implies sending it: the reverse would lock out every new account.
    enableEmailVerification: requireEmailVerification || optIn('AUTH_ENABLE_EMAIL_VERIFICATION'),
    requireEmailVerification,
    enablePasswordReset: optIn('AUTH_ENABLE_PASSWORD_RESET'),
    enableMagicLink: optIn('AUTH_ENABLE_MAGIC_LINK'),
    enableTwoFactor,
    // A mail-delivered code is a second way to pass the same factor, so it cannot outlive it.
    enableTwoFactorEmailOtp: enableTwoFactor && optIn('AUTH_ENABLE_TWO_FACTOR_EMAIL_OTP'),
    enablePasskey:
      optOut('AUTH_ENABLE_PASSKEY') && passkeyFromEnvironment(environment) !== undefined,
    enableOrganizations,
    // Gated on the feature itself, so a deployment that never turned organizations on cannot
    // advertise creation through a stale variable.
    allowUserToCreateOrganization: enableOrganizations && optIn('AUTH_ALLOW_ORGANIZATION_CREATION'),
    // Same gate: a key belongs to an organization, so there is nothing to mint one for without them.
    enableApiKeys: enableOrganizations && optIn('AUTH_ENABLE_API_KEYS'),
  };
}

/**
 * Enterprise capabilities this deployment is entitled to.
 *
 * Declared structurally rather than imported from an edition or billing package: this package owns
 * authentication policy, and which edition a deployment runs is decided by its composition root.
 * Both default to `false`, so a deployment that never states its entitlements registers neither
 * plugin, and their endpoints do not exist.
 */
export interface AuthEntitlements {
  /** SAML and OIDC single sign-on per organization (`@better-auth/sso`). */
  readonly sso: boolean;
  /** SCIM 2.0 directory provisioning per organization (`@better-auth/scim`). */
  readonly scim: boolean;
}

/** What a deployment is entitled to when nobody says otherwise: nothing beyond the open core. */
export const NO_ENTITLEMENTS: AuthEntitlements = { sso: false, scim: false };

/**
 * The sign-in and account capabilities a deployment exposes, as the browser may see them.
 *
 * Plain booleans only, so it serializes as JSON unchanged and carries nothing secret: no
 * credential, no origin, no limit an attacker could tune against. The server publishes it from
 * the same policy that built the Better Auth instance, which is what lets a page decide what to
 * render without a rebuild when the policy changes.
 */
export interface AuthCapabilities {
  readonly signup: boolean;
  readonly password: boolean;
  readonly passwordReset: boolean;
  readonly emailVerification: boolean;
  readonly magicLink: boolean;
  readonly passkey: boolean;
  readonly twoFactor: boolean;
  readonly twoFactorEmailOtp: boolean;
  readonly social: {
    readonly github: boolean;
    readonly gitlab: boolean;
    readonly google: boolean;
  };
  readonly organizations: boolean;
  readonly organizationCreation: boolean;
  /** Organization invitations, which travel through Better Enrollment and need both features. */
  readonly organizationInvitations: boolean;
  readonly invitations: boolean;
  readonly apiKeys: boolean;
  readonly deviceAuthorization: boolean;
  readonly sso: boolean;
  readonly scim: boolean;
  /** Whether the hosted-infrastructure client plugins should load in the browser. */
  readonly infra: boolean;
}

/**
 * Derive the capabilities a policy exposes.
 *
 * Every field is read off the same {@link AuthConfig} `authBetterAuthOptions` registers plugins
 * from, so a page cannot advertise a method the server does not serve. Built fresh rather than
 * spread from the config, so a field added to the policy later is not published by accident.
 */
export function authCapabilities(
  config: AuthConfig,
  entitlements: AuthEntitlements = NO_ENTITLEMENTS,
): AuthCapabilities {
  return {
    signup: config.enableSignup,
    password: config.enablePasswordLogin,
    passwordReset: config.enablePasswordLogin && config.enablePasswordReset,
    emailVerification: config.enableEmailVerification,
    magicLink: config.enableMagicLink,
    passkey: config.enablePasskey,
    twoFactor: config.enableTwoFactor,
    twoFactorEmailOtp: config.enableTwoFactor && config.enableTwoFactorEmailOtp,
    social: {
      github: config.enableGithubOauth,
      gitlab: config.enableGitlabOauth,
      google: config.enableGoogleOauth,
    },
    organizations: config.enableOrganizations,
    organizationCreation: config.enableOrganizations && config.allowUserToCreateOrganization,
    organizationInvitations: config.enableOrganizations && config.enableInvitations,
    invitations: config.enableInvitations,
    apiKeys: config.enableOrganizations && config.enableApiKeys,
    deviceAuthorization: config.enableDeviceAuthorization,
    sso: entitlements.sso,
    scim: entitlements.scim,
    infra: config.enableInfra,
  };
}
