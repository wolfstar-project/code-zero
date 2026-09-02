/**
 * The RFC 8628 device-authorization client behind `zero login`.
 *
 * Spoken over plain `fetch` against the deployment's own `/api/auth/**` rather than through Better
 * Auth's client: the flow is four request shapes, and pulling an authentication library into the
 * CLI to express them would put a server-side dependency in a terminal adapter for no gain. The
 * two endpoints are the ones `@code-zero/auth`'s `deviceAuthorization()` plugin registers, so a
 * cloud-managed deployment and a self-hosted one are reached identically — only the origin differs.
 */

/** The identifier the deployment sees for this client. Not a secret; the device flow is public. */
export const DEVICE_CLIENT_ID = 'code-zero-cli';

/** Where the auth server is mounted within a deployment, fixed by `apps/dashboard`. */
const AUTH_BASE_PATH = '/api/auth';

/** What the deployment hands back for a device to display and poll with. */
export interface DeviceAuthorizationRequest {
  readonly deviceCode: string;
  /** The short code the operator types into the deployment's `/device` page. */
  readonly userCode: string;
  /** Absolute URL of that page. */
  readonly verificationUri: string;
  /** The same URL with the code already in the query, for a terminal that can render a link. */
  readonly verificationUriComplete?: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
}

/** A minted session, as `zero login` stores it. */
interface DeviceAuthorizationToken {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
}

/**
 * The polling outcomes RFC 8628 defines that are not failures.
 *
 * `pending` and `slowDown` mean keep waiting; every other outcome ends the flow. Modelled as data
 * rather than thrown, because the caller has to distinguish "not yet" from "no" on every tick.
 */
export type DevicePollOutcome =
  | { readonly kind: 'token'; readonly token: DeviceAuthorizationToken }
  | { readonly kind: 'pending' }
  | { readonly kind: 'slowDown' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'expired' };

/** The `fetch` used for the round trip, injectable so the specs never open a socket. */
export type DeviceFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Ask the deployment to open a device-authorization request.
 *
 * @throws when the deployment refuses, which most often means `AUTH_ENABLE_DEVICE_AUTHORIZATION`
 * is not set there — the flow is off by default, and saying so is more useful than a bare 404.
 */
export async function requestDeviceCode(
  origin: string,
  fetchImplementation: DeviceFetch = globalThis.fetch,
): Promise<DeviceAuthorizationRequest> {
  const response = await fetchImplementation(`${origin}${AUTH_BASE_PATH}/device/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: DEVICE_CLIENT_ID }),
  });

  if (!response.ok)
    throw new Error(
      `${origin} refused a device authorization request (HTTP ${response.status}). ` +
        'The deployment may not have the device flow enabled.',
    );

  const body: unknown = await response.json();
  if (!isRecord(body))
    throw new Error(`${origin} returned an incomplete device authorization response.`);

  const deviceCode = asString(body.device_code);
  const userCode = asString(body.user_code);
  const verificationUri = asString(body.verification_uri);
  if (!deviceCode || !userCode || !verificationUri)
    throw new Error(`${origin} returned an incomplete device authorization response.`);

  const verificationUriComplete = asString(body.verification_uri_complete);
  return {
    deviceCode,
    userCode,
    // Resolved against the origin because the plugin is configured with a path, not an absolute
    // URL — that is what lets one CLI serve any deployment without naming a host.
    verificationUri: new URL(verificationUri, origin).toString(),
    ...(verificationUriComplete
      ? { verificationUriComplete: new URL(verificationUriComplete, origin).toString() }
      : {}),
    expiresInSeconds: asPositiveNumber(body.expires_in) ?? 600,
    intervalSeconds: asPositiveNumber(body.interval) ?? 5,
  };
}

/**
 * Poll once for the token.
 *
 * Every documented RFC 8628 error is mapped to an outcome rather than thrown; anything else is a
 * genuine transport or server failure and does throw, so a misconfigured deployment does not look
 * like an operator who is merely slow to approve.
 */
export async function pollDeviceToken(
  origin: string,
  deviceCode: string,
  fetchImplementation: DeviceFetch = globalThis.fetch,
): Promise<DevicePollOutcome> {
  const response = await fetchImplementation(`${origin}${AUTH_BASE_PATH}/device/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: DEVICE_CLIENT_ID,
    }),
  });

  const parsed: unknown = await response.json().catch(() => ({}));
  const body: Readonly<Record<string, unknown>> = isRecord(parsed) ? parsed : {};

  if (response.ok) {
    const accessToken = asString(body.access_token);
    if (!accessToken) throw new Error(`${origin} approved the request but returned no token.`);
    return {
      kind: 'token',
      token: { accessToken, expiresInSeconds: asPositiveNumber(body.expires_in) ?? 0 },
    };
  }

  switch (asString(body.error)) {
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return { kind: 'slowDown' };
    case 'access_denied':
      return { kind: 'denied' };
    case 'expired_token':
      return { kind: 'expired' };
    default:
      throw new Error(
        asString(body.error_description) ??
          `${origin} rejected the device token request (HTTP ${response.status}).`,
      );
  }
}

/**
 * Narrows a parsed JSON body to something with readable properties.
 *
 * A type predicate rather than a cast: the body comes off the wire, so the one place it is
 * inspected should prove its shape instead of asserting it.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
