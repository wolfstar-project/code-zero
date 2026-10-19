import {
  authCapabilities,
  authConfigFromEnvironment,
  type AuthCapabilities,
} from '@code-zero/auth/config';

import { dashboardUrlFromEnvironment } from './environment.js';

/**
 * The environment authentication policy is read from, with this app's own public origin filled in.
 *
 * The dashboard and the auth server are one origin here, so the origin a passkey is bound to is the
 * one `dashboardUrlFromEnvironment` resolves. Supplying it as `AUTH_DASHBOARD_ORIGIN` when the
 * deployment did not set that variable itself is what lets `@code-zero/auth` resolve the relying
 * party without a second copy of the precedence rule. Shared by `server/auth.config.ts`, which
 * builds the Better Auth instance, and `/api/capabilities`, which publishes what it serves, so the
 * two read one policy.
 */
export function authEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, string | undefined>> {
  if (environment.AUTH_DASHBOARD_ORIGIN?.trim()) return environment;
  const dashboardUrl = dashboardUrlFromEnvironment(environment);
  return dashboardUrl ? { ...environment, AUTH_DASHBOARD_ORIGIN: dashboardUrl } : environment;
}

/**
 * The capabilities this deployment's sign-in surface exposes, read when the request arrives.
 *
 * No entitlements are passed: SSO and SCIM stay off until an edition supplies them, which keeps
 * this in step with `server/auth.config.ts`, which registers neither plugin either.
 */
export function deploymentAuthCapabilities(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AuthCapabilities {
  return authCapabilities(authConfigFromEnvironment(authEnvironment(environment)));
}
