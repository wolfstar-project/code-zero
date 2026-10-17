import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import ShortcutsDialog from '~~/modules/shared/components/app/ShortcutsDialog.vue';
import {
  APP_SHORTCUTS,
  useAppShortcuts,
  useShortcutsDialog,
} from '~~/modules/shared/composables/useAppShortcuts';

/**
 * The dialog reads its open state from shared Nuxt state, which only resolves inside a component
 * setup — so the spec opens it the same way the `?` shortcut does rather than through a prop.
 */
const Host = defineComponent({
  setup() {
    const open = useShortcutsDialog();
    open.value = true;
    return () => h(ShortcutsDialog);
  },
});

describe('AppShortcutsDialog', () => {
  it('lists every registered shortcut with the keys to press', async () => {
    const wrapper = await mountSuspended(Host);

    expect(wrapper.findAll('li')).toHaveLength(APP_SHORTCUTS.length);
    expect(wrapper.text()).toContain('Go to the audit log');
    // A sequence renders one key per chord, so `g` `a` is two.
    const sequence = wrapper.findAll('li')[1];
    expect(sequence?.findAll('kbd')).toHaveLength(2);
  });

  it('closes on the close button', async () => {
    const wrapper = await mountSuspended(Host);

    await wrapper.get('[role="dialog"] button').trigger('click');

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('closes on Escape, through the real key binding', async () => {
    const wrapper = await mountSuspended(Host);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await vi.waitFor(() => {
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });
  });

  it('opens on ? through the global binding', async () => {
    // The shell binds the shortcuts and always renders the dialog; this mirrors that pairing.
    const Shell = defineComponent({
      setup() {
        useAppShortcuts();
        return () => h(ShortcutsDialog);
      },
    });
    const wrapper = await mountSuspended(Shell);

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

    // What a keyboard actually sends for `?`: Shift held, `Slash` physical key.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true }),
    );

    await vi.waitFor(() => {
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    });
  });
});
