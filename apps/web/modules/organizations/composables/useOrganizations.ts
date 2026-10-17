// Imported explicitly rather than relying on Nuxt auto-imports, so the dependency stays visible at
// the call site; `nuxt typecheck` resolves either form.
import { useAuthClient } from '@onmax/nuxt-better-auth/composables';
import { useState } from 'nuxt/app';

import { INVITATION_DELIVERY_UNAVAILABLE } from '../types/organization.js';
import type { Organization, OrganizationMember, OrganizationRole } from '../types/organization.js';

/**
 * Translation key per error code this app can explain. Everything else falls back to the generic
 * message: the server's own text is untrusted input, and the page renders what this returns.
 */
const ERROR_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  [INVITATION_DELIVERY_UNAVAILABLE]: 'organizations.errors.invitationDeliveryUnavailable',
};

/** Resolve a Better Auth error into a translation key, without assuming a shape it may not have. */
function messageFrom(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const { code } = cause as { code?: unknown };
    if (typeof code === 'string') {
      const key = ERROR_MESSAGE_KEYS[code];
      if (key) return key;
    }
  }
  return 'organizations.errors.generic';
}

/**
 * Better Auth client calls resolve with `{ data, error }` rather than rejecting on an API error.
 * Throwing the resolved error routes it through `run`'s shared handling, so a failed action
 * surfaces instead of looking successful with empty data. Checked inline at each call site
 * because a generic unwrap helper collapses the client's `{ data, error }` union to `{}`.
 */
function throwOnApiError(apiError: unknown): void {
  if (apiError) throw apiError;
}

/**
 * Organization state for the dashboard.
 *
 * Wraps the Better Auth client so components deal in plain reactive state and a few actions
 * rather than in client-plugin call shapes. Every mutation refetches rather than patching local
 * state: the auth server owns membership and roles, and a locally patched list would diverge the
 * moment a call is rejected by a policy the dashboard cannot see.
 */
export function useOrganizations() {
  // Null in client-only mode before hydration, so every action guards on it rather than assuming
  // a client exists.
  const client = useAuthClient();

  const organizations = useState<Organization[]>('organizations', () => []);
  const activeOrganization = useState<Organization | null>('organizations:active', () => null);
  const members = useState<OrganizationMember[]>('organizations:members', () => []);
  const pending = useState('organizations:pending', () => false);
  const error = useState<string | null>('organizations:error', () => null);

  /**
   * Run one client call with shared pending and error handling.
   *
   * The null check lives here so each action stays a single call: before hydration there is no
   * client, and that is an ordinary "nothing to do yet" rather than an error to surface.
   */
  async function run<T>(
    action: (authClient: NonNullable<typeof client>) => Promise<T>,
  ): Promise<T | undefined> {
    if (!client) return undefined;
    pending.value = true;
    error.value = null;
    try {
      return await action(client);
    } catch (cause) {
      error.value = messageFrom(cause);
      return undefined;
    } finally {
      pending.value = false;
    }
  }

  async function refresh() {
    await run(async (authClient) => {
      const { data, error: apiError } = await authClient.organization.list();
      throwOnApiError(apiError);
      organizations.value = data ?? [];
    });
    // A fresh session arrives with no active organization while the switcher renders the first
    // entry, so the selection is synchronized here or members and invitations would stay
    // disabled until the user re-selects manually.
    const first = organizations.value[0];
    if (!activeOrganization.value && first) await setActive(first.id);
  }

  async function refreshMembers() {
    const organizationId = activeOrganization.value?.id;
    if (!organizationId) {
      members.value = [];
      return;
    }
    await run(async (authClient) => {
      const { data, error: apiError } = await authClient.organization.listMembers({
        query: { organizationId },
      });
      throwOnApiError(apiError);
      members.value = data?.members ?? [];
    });
  }

  async function setActive(organizationId: string) {
    await run(async (authClient) => {
      const { data, error: apiError } = await authClient.organization.setActive({ organizationId });
      throwOnApiError(apiError);
      activeOrganization.value = data ?? null;
    });
    await refreshMembers();
  }

  async function create(input: { name: string; slug: string }) {
    const created = await run(async (authClient) => {
      const { data, error: apiError } = await authClient.organization.create(input);
      throwOnApiError(apiError);
      return data;
    });
    if (created) await refresh();
    return created;
  }

  async function inviteMember(input: { email: string; role: OrganizationRole }) {
    const organizationId = activeOrganization.value?.id;
    if (!organizationId) return undefined;
    return run(async (authClient) => {
      const { data, error: apiError } = await authClient.organization.inviteMember({
        ...input,
        organizationId,
      });
      throwOnApiError(apiError);
      return data;
    });
  }

  async function removeMember(memberIdOrEmail: string) {
    const organizationId = activeOrganization.value?.id;
    if (!organizationId) return;
    // Only refresh after a successful removal: refreshMembers() runs through `run()` too, which
    // clears `error` at its start, so an unconditional refresh would wipe out a failed removal's
    // error the moment the refresh itself succeeds.
    const removed = await run(async (authClient) => {
      const { error: apiError } = await authClient.organization.removeMember({
        memberIdOrEmail,
        organizationId,
      });
      throwOnApiError(apiError);
      return true;
    });
    if (removed) await refreshMembers();
  }

  return {
    organizations,
    activeOrganization,
    members,
    pending,
    error,
    refresh,
    refreshMembers,
    setActive,
    create,
    inviteMember,
    removeMember,
  };
}
