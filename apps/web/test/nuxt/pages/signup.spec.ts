import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import type { VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import SignupPage from '~/pages/(auth)/signup.vue';

/**
 * Registration renders whatever `appConfig.auth` publishes, which `nuxt.config.ts` derives from the
 * shared environment through `authConfigFromEnvironment()` (`AUTH_ENABLE_SIGNUP`, GitHub OAuth
 * credentials). That derivation is covered in `packages/auth/src/config.test.ts`; the mock stands in
 * for it here so each spec can render the page under a specific deployment policy.
 *
 * The closed state is presentation only — the server rejects sign-up regardless of what this page
 * offers.
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

describe('signup page', () => {
  beforeEach(() => {
    authCapabilities.enableSignup = false;
    authCapabilities.enableGithubOauth = false;
  });

  it('renders the closed state without a form when registration is disabled', async () => {
    const wrapper = await mountSuspended(SignupPage);

    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('Registration is closed on this deployment.');
    expect(wrapper.text()).not.toContain('Continue with GitHub');
  });

  it('renders the registration form when the published policy enables signup', async () => {
    authCapabilities.enableSignup = true;

    const wrapper = await mountSuspended(SignupPage);

    expect(wrapper.find('form').exists()).toBe(true);
    expect(wrapper.text()).toContain('Name');
    expect(wrapper.text()).toContain('Email');
    expect(wrapper.text()).toContain('Password');
    expect(getButtonByText(wrapper, 'Create account').exists()).toBe(true);
  });

  it('offers the GitHub button when the published policy enables OAuth', async () => {
    authCapabilities.enableSignup = true;
    authCapabilities.enableGithubOauth = true;

    const wrapper = await mountSuspended(SignupPage);

    expect(getButtonByText(wrapper, 'Continue with GitHub').exists()).toBe(true);
  });

  it('links back to sign in', async () => {
    const wrapper = await mountSuspended(SignupPage);
    const link = wrapper.find('a[href="/login"]');

    expect(link.exists()).toBe(true);
    expect(link.text()).toBe('Already have an account?');
  });
});
