import type { SettingsView } from '@code-zero/api';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ORPCError } from '@orpc/client';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import SettingsForm from '~~/modules/settings/components/Form.vue';
import type { SelfHostedSettingsView, SettingsInput } from '~~/modules/settings/utils/form';

/**
 * The dashboard-source form: it edits, sends, and shows the server's verdict beside each field.
 * The save is a prop, so these specs hand it a stub and the router is never reached.
 */
const VIEW: SelfHostedSettingsView = {
  edition: 'self-hosted',
  source: 'dashboard',
  editable: true,
  filePath: null,
  state: {
    ok: true,
    settings: {
      execution: {
        maxConcurrentTasks: 4,
        commandTimeoutMinutes: 30,
        allowedModes: ['observe', 'suggest', 'fix', 'autonomous'],
        maxNetwork: 'full',
      },
      model: null,
      runner: { isolation: 'container', engine: 'docker', image: 'ghcr.io/acme/runner:1' },
    },
    saved: { by: 'admin@example.com', at: '2026-10-18T10:00:00.000Z' },
    warnings: [],
  },
  services: [],
  bounds: {
    maxConcurrentTasks: { minimum: 1, maximum: 64 },
    commandTimeoutMinutes: { minimum: 1, maximum: 1440 },
  },
};

describe('SettingsForm', () => {
  it('shows the server issues beside the fields they name, and keeps the draft', async () => {
    const save = vi.fn<(input: SettingsInput) => Promise<SettingsView>>().mockRejectedValue(
      new ORPCError('BAD_REQUEST', {
        data: {
          issues: [
            {
              path: '$.execution.command_timeout_minutes',
              message: 'Expected an integer from 1 to 1440.',
            },
          ],
        },
      }),
    );
    const wrapper = await mountSuspended(SettingsForm, { props: { view: VIEW, save } });

    await wrapper.find('input[name="commandTimeoutMinutes"]').setValue('5000');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].execution.commandTimeoutMinutes).toBe(5000);
    const timeout = wrapper.find('input[name="commandTimeoutMinutes"]');
    expect(timeout.attributes('aria-invalid')).toBe('true');
    expect(wrapper.text()).toContain('Expected an integer from 1 to 1440.');
    expect(wrapper.text()).toContain('Some values were refused.');
    expect((timeout.element as HTMLInputElement).value).toBe('5000');
    expect(wrapper.emitted('saved')).toBeUndefined();
  });

  it('emits the stored view once the server accepts the save', async () => {
    const save = vi.fn<(input: SettingsInput) => Promise<SettingsView>>().mockResolvedValue(VIEW);
    const wrapper = await mountSuspended(SettingsForm, { props: { view: VIEW, save } });

    await wrapper.find('input[name="maxConcurrentTasks"]').setValue('2');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      execution: { maxConcurrentTasks: 2 },
      runner: { isolation: 'container', engine: 'docker', image: 'ghcr.io/acme/runner:1' },
    });
    expect(wrapper.emitted('saved')?.[0]).toEqual([VIEW]);
  });

  it('keeps observe ticked and out of reach, since no deployment can drop it', async () => {
    const wrapper = await mountSuspended(SettingsForm, { props: { view: VIEW, save: vi.fn() } });

    const observe = wrapper.find('input[name="allowedModes"][value="observe"]');
    expect((observe.element as HTMLInputElement).checked).toBe(true);
    expect(observe.attributes('disabled')).toBeDefined();
  });

  it('offers the model fields only when one model is imposed on every run', async () => {
    const wrapper = await mountSuspended(SettingsForm, { props: { view: VIEW, save: vi.fn() } });

    expect(wrapper.find('input[name="modelName"]').exists()).toBe(false);
    await wrapper.find('input[name="modelSource"][value="deployment"]').setValue(true);
    expect(wrapper.find('input[name="modelName"]').exists()).toBe(true);
  });
});
