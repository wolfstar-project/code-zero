import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import LocaleSwitcher from '~~/modules/shared/components/LocaleSwitcher.vue';

describe('LocaleSwitcher', () => {
  it('lists every configured locale under its native label', async () => {
    const wrapper = await mountSuspended(LocaleSwitcher);
    const options = wrapper.findAll('option');

    expect(options.map((option) => option.attributes('value'))).toEqual(['en', 'it']);
    expect(options.map((option) => option.text())).toEqual(['English', 'Italiano']);
  });

  it('is labelled for assistive technology', async () => {
    const wrapper = await mountSuspended(LocaleSwitcher);

    expect(wrapper.get('select').attributes('aria-label')).toBe('Language');
  });

  it('starts on the active locale', async () => {
    const wrapper = await mountSuspended(LocaleSwitcher);

    expect(wrapper.get('select').element.value).toBe('en');
  });

  it('switches the application locale', async () => {
    const wrapper = await mountSuspended(LocaleSwitcher);

    await wrapper.get('select').setValue('it');
    await vi.waitFor(() => {
      expect(wrapper.get('select').attributes('aria-label')).toBe('Lingua');
    });

    // The Nuxt app is shared across the specs in this file, so restore the default locale.
    await wrapper.get('select').setValue('en');
    await vi.waitFor(() => {
      expect(wrapper.get('select').attributes('aria-label')).toBe('Language');
    });
  });
});
