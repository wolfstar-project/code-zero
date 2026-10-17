import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Imported explicitly rather than relying on Nuxt auto-imports: the plain `tsc` pass over test/**
// does not see the generated auto-import declarations that `vue-tsc` does.
import { ref } from 'vue';

import InvitePage from '~/pages/invite.vue';

/**
 * The redemption page renders whatever `invite.get` says comes next, never anything decided from
 * the URL: one page has to cover private and public invitations, app and organization ones, and
 * both invite-only and open deployments. These specs drive it through each `nextAction` the auth
 * server can return, plus the two states it has no action for.
 */
interface InviteResult {
  data: {
    nextAction: string | null;
    requiredFields: string[];
    organizationName: string | null;
  } | null;
  error?: { code?: string; status?: number };
}

const query = ref<Record<string, string>>({});
const getInvite = vi.fn<() => Promise<InviteResult>>();
const redeemInvite = vi.fn<() => Promise<{ error?: { code?: string } }>>();

// `fullPath` (token included) is what the sign-in link round-trips through `/login`'s `redirect`
// query param, so the mocked route has to carry the same shape `useRoute()` does, not just `query`.
mockNuxtImport('useRoute', () => () => ({
  query: query.value,
  fullPath: `/invite?token=${query.value.token ?? ''}`,
}));
mockNuxtImport('useAuthClient', () => () => ({
  invite: { get: getInvite, redeem: redeemInvite },
}));

function respondWith(nextAction: string | null, requiredFields: string[] = []): void {
  getInvite.mockResolvedValue({
    data: { nextAction, requiredFields, organizationName: null },
  });
}

describe('invite page', () => {
  beforeEach(() => {
    query.value = { token: 'a-token' };
    getInvite.mockReset();
    redeemInvite.mockReset();
    redeemInvite.mockResolvedValue({});
  });

  it('asks for the invitation email link when the URL carries no token', async () => {
    query.value = {};

    const wrapper = await mountSuspended(InvitePage);

    expect(wrapper.text()).toContain('missing its invitation token');
    // Nothing to look up, so the server is never asked.
    expect(getInvite).not.toHaveBeenCalled();
  });

  it('renders only the fields the server asked for', async () => {
    // A private invitation is bound to an address, so it never collects one.
    respondWith('SIGN_UP', ['password', 'name']);

    const wrapper = await mountSuspended(InvitePage);

    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('input[type="email"]').exists()).toBe(false);
  });

  it('collects an email when a public invitation requires one', async () => {
    respondWith('SIGN_UP', ['password', 'name', 'email']);

    const wrapper = await mountSuspended(InvitePage);

    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
  });

  it('sends only the requested fields on redemption', async () => {
    respondWith('SIGN_UP', ['password', 'name']);
    const wrapper = await mountSuspended(InvitePage);

    await wrapper.find('form').trigger('submit');

    expect(redeemInvite).toHaveBeenCalledWith({
      token: 'a-token',
      name: '',
      password: '',
    });
  });

  it('offers a plain confirmation to a signed-in invitee', async () => {
    respondWith('CONFIRM');

    const wrapper = await mountSuspended(InvitePage);

    expect(wrapper.text()).toContain('Accept this invitation for your current account.');
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('sends a signed-out invitee to sign in when the server asks for a session', async () => {
    respondWith('SIGN_IN');

    const wrapper = await mountSuspended(InvitePage);

    expect(wrapper.text()).toContain('Sign in to accept this invitation.');
  });

  it('carries the invitation through sign-in so redemption is not lost', async () => {
    // `useSignIn`/`useSignUp` on the login page navigate to whatever this query param names once
    // they complete, so without it a signed-out invitee would land on "/" after sign-in and the
    // token, still sitting in this now-unmounted page, would never reach `invite.redeem`.
    respondWith('SIGN_IN');

    const wrapper = await mountSuspended(InvitePage);
    const href = wrapper.find('a').attributes('href');

    expect(href).toBeDefined();
    expect(new URL(href!, 'http://localhost').searchParams.get('redirect')).toBe(
      '/invite?token=a-token',
    );
  });

  it('reports a spent invitation rather than rendering a form', async () => {
    // A null action is the server saying the invitation is expired, revoked, or consumed.
    respondWith(null);

    const wrapper = await mountSuspended(InvitePage);

    expect(wrapper.text()).toContain('no longer valid');
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('localizes a rejection by code instead of echoing the server text', async () => {
    // Adapter error strings are untrusted input and must never be rendered verbatim.
    getInvite.mockResolvedValue({ data: null, error: { code: 'INVITE_EXPIRED', status: 400 } });

    const wrapper = await mountSuspended(InvitePage);

    expect(wrapper.text()).toContain('That invitation has expired.');
  });
});
