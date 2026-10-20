import type { AuthCapabilities } from '@code-zero/auth/config';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Imported explicitly rather than relying on Nuxt auto-imports: the plain `tsc` pass over test/**
// does not see the generated auto-import declarations that `vue-tsc` does.
import { computed, ref } from 'vue';

import TwoFactorPage from '~/pages/(auth)/two-factor.vue';

/**
 * The challenge page drives the two-factor endpoints through `useAuthClientAction`, which
 * `/api/auth/**` would answer; the fetch stub in `test/nuxt/setup.ts` keeps that route off the
 * network, so the action handle is mocked at the composable boundary instead. One mock serves
 * every action the page creates, and `state.accepted` decides what the server would have said.
 */
const state = vi.hoisted(() => ({
  accepted: false,
  emailOtp: false,
  verify: vi.fn<(input: unknown) => void>(),
  refresh: vi.fn<(options?: { force?: boolean }) => Promise<void>>(),
  navigate: vi.fn<(to: string) => Promise<void>>(),
}));

mockNuxtImport(
  'useAuthCapabilities',
  () => () =>
    Promise.resolve(
      computed<AuthCapabilities>(() => ({
        signup: false,
        password: true,
        passwordReset: false,
        emailVerification: false,
        magicLink: false,
        passkey: false,
        twoFactor: true,
        twoFactorEmailOtp: state.emailOtp,
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
      })),
    ),
);
mockNuxtImport('useAuthClientAction', () => () => {
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle');
  const error = ref<{ code: string; status: number } | null>(null);
  const data = ref<unknown>(null);
  return {
    status,
    error,
    data,
    execute: (input?: unknown) => {
      state.verify(input);
      status.value = state.accepted ? 'success' : 'error';
      error.value = state.accepted ? null : { code: 'INVALID_CODE', status: 401 };
      return Promise.resolve();
    },
  };
});
mockNuxtImport('useUserSession', () => () => ({ fetchSession: state.refresh }));
mockNuxtImport('navigateTo', () => state.navigate);

async function submitCode(code: string) {
  const wrapper = await mountSuspended(TwoFactorPage);
  await wrapper.get('input[autocomplete="one-time-code"]').setValue(code);
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  return wrapper;
}

describe('two-factor page', () => {
  beforeEach(() => {
    state.accepted = false;
    state.emailOtp = false;
    vi.clearAllMocks();
  });

  it('asks for a one-time code and offers no mailed code unless the deployment delivers one', async () => {
    const wrapper = await mountSuspended(TwoFactorPage);

    const input = wrapper.get('input[autocomplete="one-time-code"]');
    expect(input.attributes('inputmode')).toBe('numeric');
    expect(wrapper.text()).not.toContain('Send a code by email');
    expect(wrapper.find('a[href="/login"]').text()).toBe('Back to sign in');
  });

  it('keeps a rejected code on the challenge screen', async () => {
    const wrapper = await submitCode('123456');

    expect(state.verify).toHaveBeenCalledWith({ code: '123456' });
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'That code is not valid. Check it and try again.',
    );
    expect(state.refresh).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('refreshes the session and opens the dashboard after verification', async () => {
    state.accepted = true;

    const wrapper = await submitCode('123456');

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(state.refresh).toHaveBeenCalledWith({ force: true });
    expect(state.navigate).toHaveBeenCalledWith('/');
  });

  it('sends the trust-device choice only when it was ticked', async () => {
    state.accepted = true;
    const wrapper = await mountSuspended(TwoFactorPage);

    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('input[autocomplete="one-time-code"]').setValue('123456');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(state.verify).toHaveBeenCalledWith({ code: '123456', trustDevice: true });
  });

  it('switches to a backup code field that accepts more than six digits', async () => {
    const wrapper = await mountSuspended(TwoFactorPage);

    const toggle = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Use a backup code instead');
    await toggle?.trigger('click');

    const input = wrapper.get('input[type="text"]');
    expect(input.attributes('autocomplete')).toBe('off');
    expect(input.attributes('maxlength')).toBeUndefined();
    expect(wrapper.text()).toContain('Backup code');
  });

  it('offers a mailed code when the deployment delivers them, then verifies the one typed', async () => {
    state.emailOtp = true;
    state.accepted = true;
    const wrapper = await mountSuspended(TwoFactorPage);

    const send = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Send a code by email');
    expect(send).toBeDefined();
    await send?.trigger('click');
    await flushPromises();

    // `sendOtp` takes no body; the request itself is what asks the server for a code.
    expect(state.verify).toHaveBeenCalledWith(undefined);
    expect(wrapper.get('[role="status"]').text()).toContain('on its way');

    await wrapper.get('input[autocomplete="one-time-code"]').setValue('654321');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(state.verify).toHaveBeenLastCalledWith({ code: '654321' });
    expect(state.navigate).toHaveBeenCalledWith('/');
  });
});
