import type { OrganizationSettingsView, SettingsView } from '@code-zero/api';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
// Imported explicitly rather than relying on Nuxt auto-imports: the plain `tsc` pass over test/**
// does not see the generated auto-import declarations that `vue-tsc` does.
import { useState } from 'nuxt/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, shallowRef } from 'vue';

import SettingsPage from '~/pages/(dashboard)/settings.vue';

/**
 * The page renders whatever `settings.get` described, and nothing it decided for itself: which
 * edition, which source, and who may edit are the server's answers. These specs replace the read
 * with a fixed view and check each state renders as the controls it promises — and no others.
 */
const view = shallowRef<SettingsView | null>(null);
const error = shallowRef<string | null>(null);
const pending = shallowRef(false);
const refresh = vi.fn<() => Promise<void>>(() => Promise.resolve());

mockNuxtImport('useSettings', () => () => ({
  view,
  error,
  pending,
  refresh,
  replace: (next: SettingsView) => {
    view.value = next;
  },
}));

const BOUNDS = {
  maxConcurrentTasks: { minimum: 1, maximum: 64 },
  commandTimeoutMinutes: { minimum: 1, maximum: 1440 },
} as const;

const SERVICES = [
  { service: 'sandbox', configured: true },
  { service: 'database', configured: true },
  { service: 'mail', configured: false },
] as const;

function fileView(state: Extract<SettingsView, { edition: 'self-hosted' }>['state']): SettingsView {
  return {
    edition: 'self-hosted',
    source: 'file',
    editable: false,
    filePath: '/srv/code-zero/config.yml',
    state,
    services: SERVICES,
    bounds: BOUNDS,
  };
}

const PLAN = {
  maxConcurrentTasks: 4,
  commandTimeoutMinutes: 60,
  allowedModes: ['observe', 'suggest', 'fix'],
  maxNetwork: 'restricted',
} as const;

function cloudView(member: OrganizationSettingsView | null): SettingsView {
  return {
    edition: 'cloud',
    services: [{ service: 'model', configured: true }, ...SERVICES],
    plan: PLAN,
    organization: member,
    bounds: BOUNDS,
  };
}

function organization(editable: boolean): OrganizationSettingsView {
  return {
    id: 'org_acme',
    role: editable ? 'owner' : 'member',
    editable,
    limits: { maxConcurrentTasks: 2, commandTimeoutMinutes: null, allowedModes: null },
    invalid: false,
    effective: { ...PLAN, maxConcurrentTasks: 2 },
  };
}

describe('settings page', () => {
  beforeEach(() => {
    view.value = null;
    error.value = null;
    pending.value = false;
    refresh.mockClear();
    useState<{ id: string } | null>('organizations:active').value = null;
  });

  it('shows file settings read-only, with the file to edit', async () => {
    view.value = fileView({
      ok: true,
      settings: {
        execution: { ...PLAN, allowedModes: ['observe', 'suggest'] },
        model: { provider: 'anthropic', name: 'claude-sonnet' },
        runner: null,
      },
      saved: null,
      warnings: [],
    });

    const wrapper = await mountSuspended(SettingsPage);

    expect(wrapper.text()).toContain('/srv/code-zero/config.yml');
    expect(wrapper.text()).toContain('claude-sonnet');
    expect(wrapper.text()).toContain('Timeout per command');
    expect(wrapper.text()).toContain('60 min');
    // Read-only means no control that could even look like it saves something.
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.findAll('input')).toHaveLength(0);
    expect(wrapper.text()).toContain('Download config.yml');
  });

  it('lists every issue when the file is invalid, and offers no export of it', async () => {
    view.value = fileView({
      ok: false,
      issues: [{ path: '$.execution.max_network', message: 'Expected none, restricted, or full.' }],
    });

    const wrapper = await mountSuspended(SettingsPage);

    expect(wrapper.text()).toContain('The settings are invalid');
    expect(wrapper.text()).toContain('$.execution.max_network');
    expect(wrapper.text()).toContain('Expected none, restricted, or full.');
    const download = wrapper.findAll('button').find((button) => button.text().includes('Download'));
    expect(download?.attributes('disabled')).toBeDefined();
  });

  it('explains a refusal instead of rendering an empty page', async () => {
    error.value = 'forbidden';

    const wrapper = await mountSuspended(SettingsPage);

    expect(wrapper.text()).toContain('requires the admin role');
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('lets an organization owner lower the limits, below the plan', async () => {
    view.value = cloudView(organization(true));

    const wrapper = await mountSuspended(SettingsPage);

    expect(wrapper.text()).toContain('Plan limits');
    expect(wrapper.find('form').exists()).toBe(true);
    expect(wrapper.find('input[name="maxConcurrentTasks"]').attributes('placeholder')).toBe(
      'Plan: 4',
    );
    // The service's own wiring is never a control on the cloud.
    expect(wrapper.find('select[name="modelProvider"]').exists()).toBe(false);
    expect(wrapper.find('input[name="runnerImage"]').exists()).toBe(false);
  });

  it('shows a member the limits without any control to change them', async () => {
    view.value = cloudView(organization(false));

    const wrapper = await mountSuspended(SettingsPage);

    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.findAll('input')).toHaveLength(0);
    expect(wrapper.text()).toContain(
      'Only an organization owner or admin can change these limits.',
    );
    expect(wrapper.text()).toContain('Effective limits');
  });

  it('asks for an organization when none is selected on the cloud', async () => {
    view.value = cloudView(null);

    const wrapper = await mountSuspended(SettingsPage);

    expect(wrapper.text()).toContain('Select an organization to see its limits.');
  });

  it('reads the settings again when the sidebar switches organization', async () => {
    view.value = cloudView(null);
    await mountSuspended(SettingsPage);
    refresh.mockClear();

    // The switcher selects an organization after mount, for a session that had none.
    useState<{ id: string } | null>('organizations:active').value = { id: 'org_acme' };
    await nextTick();

    // Every page still mounted by an earlier spec answers too, so the count is not asserted.
    expect(refresh).toHaveBeenCalled();

    refresh.mockClear();
    useState<{ id: string } | null>('organizations:active').value = { id: 'org_acme' };
    await nextTick();
    expect(refresh).not.toHaveBeenCalled();
  });
});
