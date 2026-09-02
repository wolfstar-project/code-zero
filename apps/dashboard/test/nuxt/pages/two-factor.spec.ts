import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

import TwoFactorPage from '~/pages/two-factor.vue';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,qr')) },
}));

const user = ref<{ twoFactorEnabled: boolean } | null>(null);
const { fetchSession, navigateTo, enable, disable, verifyTotp, verifyBackupCode } = vi.hoisted(
  () => ({
    fetchSession: vi.fn(() => Promise.resolve()),
    navigateTo: vi.fn(() => Promise.resolve()),
    enable: vi.fn(),
    disable: vi.fn(),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
  }),
);

mockNuxtImport('navigateTo', () => navigateTo);
mockNuxtImport('useUserSession', () => () => ({
  user,
  loggedIn: computed(() => user.value !== null),
  ready: computed(() => true),
  fetchSession,
}));
mockNuxtImport('useAuthClient', () => () => ({
  twoFactor: { enable, disable, verifyTotp, verifyBackupCode },
}));

describe('two-factor page', () => {
  beforeEach(() => {
    user.value = null;
    fetchSession.mockClear();
    navigateTo.mockClear();
    enable.mockReset();
    disable.mockReset();
    verifyTotp.mockReset();
    verifyBackupCode.mockReset();
  });

  it('completes a sign-in challenge with a trusted-device TOTP code', async () => {
    verifyTotp.mockResolvedValue({});
    const wrapper = await mountSuspended(TwoFactorPage);

    await wrapper.get('input[autocomplete="one-time-code"]').setValue('123456');
    await wrapper.get('form[data-mode="challenge"]').trigger('submit');

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: true });
    expect(navigateTo).toHaveBeenCalledWith('/');
  });

  it('accepts a backup code during sign-in', async () => {
    verifyBackupCode.mockResolvedValue({});
    const wrapper = await mountSuspended(TwoFactorPage);

    await wrapper.get('button[data-factor="backup"]').trigger('click');
    await wrapper.get('input[autocomplete="one-time-code"]').setValue('backup-code');
    await wrapper.get('form[data-mode="challenge"]').trigger('submit');

    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'backup-code', trustDevice: true });
  });

  it('shows the QR code and one-time backup codes after password confirmation', async () => {
    user.value = { twoFactorEnabled: false };
    enable.mockResolvedValue({
      data: { totpURI: 'otpauth://totp/Agent%20Zero', backupCodes: ['one', 'two'] },
    });
    const wrapper = await mountSuspended(TwoFactorPage);

    await wrapper.get('input[autocomplete="current-password"]').setValue('correct-password');
    await wrapper.get('form[data-mode="enable"]').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.get('img').attributes('src')).toContain('data:image/png'),
    );

    expect(enable).toHaveBeenCalledWith({ password: 'correct-password' });
    expect(wrapper.text()).toContain('one');
    expect(wrapper.text()).toContain('two');
  });

  it('verifies the first TOTP code before considering enrollment complete', async () => {
    user.value = { twoFactorEnabled: false };
    enable.mockResolvedValue({
      data: { totpURI: 'otpauth://totp/Agent%20Zero', backupCodes: ['one'] },
    });
    verifyTotp.mockResolvedValue({});
    const wrapper = await mountSuspended(TwoFactorPage);

    await wrapper.get('form[data-mode="enable"]').trigger('submit');
    await wrapper.get('input[autocomplete="one-time-code"]').setValue('654321');
    await wrapper.get('form[data-mode="confirm"]').trigger('submit');

    expect(verifyTotp).toHaveBeenCalledWith({ code: '654321' });
    expect(fetchSession).toHaveBeenCalledWith({ force: true });
  });

  it('requires the password to disable an active second factor', async () => {
    user.value = { twoFactorEnabled: true };
    disable.mockResolvedValue({});
    const wrapper = await mountSuspended(TwoFactorPage);

    await wrapper.get('input[autocomplete="current-password"]').setValue('correct-password');
    await wrapper.get('form[data-mode="disable"]').trigger('submit');

    expect(disable).toHaveBeenCalledWith({ password: 'correct-password' });
    expect(fetchSession).toHaveBeenCalledWith({ force: true });
  });
});
