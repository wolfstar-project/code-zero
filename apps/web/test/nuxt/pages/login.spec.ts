import type { AuthCapabilities } from '@code-zero/auth/config';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed } from 'vue';

import LoginPage from '~/pages/(auth)/login.vue';

/**
 * The login page renders whatever sign-in capabilities `/api/capabilities` publishes, which the
 * server derives at runtime through `authCapabilities()` from the same environment it builds Better
 * Auth from. That derivation is covered in `packages/auth/src/config.test.ts`; the mock stands in
 * for the request here so each spec can render the page under a specific deployment policy.
 */
const authCapabilities = { enableSignup: false, enableGithubOauth: false };

mockNuxtImport(
  'useAuthCapabilities',
  () => () =>
    Promise.resolve(
      computed<AuthCapabilities>(() => ({
        signup: authCapabilities.enableSignup,
        password: true,
        passwordReset: false,
        emailVerification: false,
        magicLink: false,
        passkey: false,
        twoFactor: true,
        twoFactorEmailOtp: false,
        social: { github: authCapabilities.enableGithubOauth, gitlab: false, google: false },
        organizations: false,
        organizationCreation: false,
        organizationInvitations: false,
        invitations: false,
        apiKeys: false,
        deviceAuthorization: false,
        sso: false,
        scim: false,
        infra: false,
      })),
    ),
);

function getButtonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text);
  if (button === undefined) {
    throw new Error(`No button with text "${text}"`);
  }
  return button;
}

describe('login page', () => {
  beforeEach(() => {
    authCapabilities.enableSignup = false;
    authCapabilities.enableGithubOauth = false;
  });

  it('renders a closed deployment without registration or GitHub affordances', async () => {
    const wrapper = await mountSuspended(LoginPage);

    expect(wrapper.text()).toContain('Sign in');
    expect(wrapper.text()).not.toContain('Need an account?');
    expect(wrapper.text()).not.toContain('Continue with GitHub');
  });

  it('links to the signup route when the published policy enables signup', async () => {
    authCapabilities.enableSignup = true;

    const wrapper = await mountSuspended(LoginPage);
    const link = wrapper.find('a[href="/signup"]');

    expect(link.exists()).toBe(true);
    expect(link.text()).toBe('Need an account?');
    // Sign-in only: the registration fields live on /signup, never on this page.
    expect(wrapper.text()).not.toContain('Name');
  });

  it('offers the GitHub button when the published policy enables OAuth', async () => {
    authCapabilities.enableGithubOauth = true;

    const wrapper = await mountSuspended(LoginPage);

    expect(getButtonByText(wrapper, 'Continue with GitHub').exists()).toBe(true);
  });
});
