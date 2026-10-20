import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import UserMenu from '~~/modules/auth/components/UserMenu.vue';

interface MockUser {
  name: string;
  email: string;
}

const mockUser = ref<MockUser | null>(null);
const mockReady = ref(false);
const signOut = vi.fn<() => Promise<void>>(() => Promise.resolve());

mockNuxtImport('useUserSession', () => () => ({
  user: mockUser,
  loggedIn: computed(() => mockUser.value !== null),
  ready: computed(() => mockReady.value),
  signOut,
}));

const OPERATOR: MockUser = { name: 'Operator', email: 'operator@example.test' };

describe('UserMenu', () => {
  beforeEach(() => {
    mockUser.value = null;
    mockReady.value = false;
    signOut.mockClear();
  });

  it('renders nothing until the session is resolved', async () => {
    const wrapper = await mountSuspended(UserMenu);

    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('renders nothing for a signed-out visitor', async () => {
    mockReady.value = true;

    const wrapper = await mountSuspended(UserMenu);

    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows who is signed in, with the email available as a tooltip', async () => {
    mockReady.value = true;
    mockUser.value = OPERATOR;

    const wrapper = await mountSuspended(UserMenu);

    expect(wrapper.text()).toContain('Signed in as');
    expect(wrapper.text()).toContain('Operator');
    expect(wrapper.get('[title]').attributes('title')).toBe('operator@example.test');
  });

  it('falls back to the email when the account has no display name', async () => {
    mockReady.value = true;
    mockUser.value = { name: '', email: 'operator@example.test' };

    const wrapper = await mountSuspended(UserMenu);

    expect(wrapper.text()).toContain('operator@example.test');
  });

  it('signs out through the session composable', async () => {
    mockReady.value = true;
    mockUser.value = OPERATOR;

    const wrapper = await mountSuspended(UserMenu);
    await wrapper.get('button').trigger('click');

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
