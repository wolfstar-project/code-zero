import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import { useAuthErrorMessage } from '../../../modules/auth/composables/useAuthErrorMessage.js';

/**
 * `useAuthErrorMessage` needs a component context for `useI18n`, so the specs mount a bare
 * harness and call the returned function directly.
 */
const Harness = defineComponent({
  setup() {
    return useAuthErrorMessage();
  },
  render: () => h('div'),
});

async function localize() {
  const wrapper = await mountSuspended(Harness);
  return wrapper.vm.localizeAuthError;
}

describe('useAuthErrorMessage', () => {
  it('translates a known Better Auth error code', async () => {
    const localizeAuthError = await localize();

    expect(
      localizeAuthError({
        message: 'invalid email or password',
        code: 'INVALID_EMAIL_OR_PASSWORD',
        status: 401,
        raw: null,
      }),
    ).toBe('That email and password combination is not valid.');
  });

  it('matches error codes case-insensitively', async () => {
    const localizeAuthError = await localize();

    expect(
      localizeAuthError({
        message: 'invalid email',
        code: 'invalid_email',
        status: 400,
        raw: null,
      }),
    ).toBe('Enter a valid email address.');
  });

  it('never renders untrusted server text for an unrecognised code', async () => {
    const localizeAuthError = await localize();
    const message = localizeAuthError({
      message: 'raw adapter text',
      code: 'SOMETHING_UNEXPECTED',
      status: 400,
      raw: null,
    });

    expect(message).toBe('Sign-in failed. Check your credentials and try again.');
    expect(message).not.toContain('raw adapter text');
  });

  it('reports an unreachable auth server when the request never got a status', async () => {
    const localizeAuthError = await localize();

    expect(localizeAuthError({ message: 'fetch failed', raw: null })).toBe(
      'The authentication service is unreachable.',
    );
  });

  it('falls back to the generic message when there is no error to inspect', async () => {
    const localizeAuthError = await localize();

    expect(localizeAuthError(null)).toBe('Sign-in failed. Check your credentials and try again.');
  });

  it('honours a caller-provided fallback key', async () => {
    const localizeAuthError = await localize();

    expect(localizeAuthError(undefined, 'auth.errors.UNREACHABLE')).toBe(
      'The authentication service is unreachable.',
    );
  });
});
