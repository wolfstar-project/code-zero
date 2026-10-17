import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import LoginPage from '~/pages/(auth)/login.vue';

/**
 * The login page renders whatever sign-in capabilities `appConfig.auth` publishes, which
 * `nuxt.config.ts` derives from the shared environment through `authConfigFromEnvironment()`
 * (`AUTH_ENABLE_SIGNUP`, GitHub OAuth credentials). That derivation is covered in
 * `packages/auth/src/config.test.ts`; the mock stands in for it here so each spec can render the
 * page under a specific deployment policy.
 */
const authCapabilities = { enableSignup: false, enableGithubOauth: false };

mockNuxtImport('useAppConfig', () => () => ({ auth: authCapabilities }));

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
