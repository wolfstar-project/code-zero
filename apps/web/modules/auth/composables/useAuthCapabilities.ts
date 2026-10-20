import type { AuthCapabilities } from '@code-zero/auth/config';
// Imported explicitly rather than relying on Nuxt auto-imports, for the reason
// `useAuthErrorMessage` gives.
import { useAsyncData, useRequestFetch } from 'nuxt/app';
import { computed, type ComputedRef } from 'vue';

/** The server route `server/api/capabilities.get.ts` serves. */
const CAPABILITIES_PATH = '/api/capabilities';

/**
 * What the page renders when the capabilities cannot be read: the password form and nothing else.
 *
 * Fails toward the closed side, so an unreachable endpoint can hide a method the server serves but
 * never advertise one it does not. The server enforces its own policy either way.
 */
const CLOSED: AuthCapabilities = {
  signup: false,
  password: true,
  passwordReset: false,
  emailVerification: false,
  magicLink: false,
  passkey: false,
  twoFactor: false,
  twoFactorEmailOtp: false,
  social: { github: false, gitlab: false, google: false },
  organizations: false,
  organizationCreation: false,
  organizationInvitations: false,
  invitations: false,
  apiKeys: false,
  deviceAuthorization: false,
  sso: false,
  scim: false,
  infra: false,
};

/**
 * The deployment's sign-in capabilities, read from the server at runtime.
 *
 * Fetched during SSR under one key, so the first paint already reflects the policy and every
 * caller on the page shares the one request. Awaited by its callers for that reason: an unawaited
 * fetch would render the closed state on the server and correct it on the client.
 */
export async function useAuthCapabilities(): Promise<ComputedRef<AuthCapabilities>> {
  // `useRequestFetch` forwards the incoming request during SSR. The path is widened to `string`
  // on purpose: matching it against Nitro's typed route table exceeds the checker's depth limit,
  // and the result is typed by the contract instead.
  const fetchCapabilities = useRequestFetch();
  const path: string = CAPABILITIES_PATH;
  const { data } = await useAsyncData('auth-capabilities', () =>
    fetchCapabilities<AuthCapabilities>(path),
  );
  return computed(() => data.value ?? CLOSED);
}
