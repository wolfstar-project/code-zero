import type { OrganizationSettingsView, SettingsView } from '@code-zero/api';
import type { DeploymentSettings } from '@code-zero/config';
import { ORPCError } from '@orpc/client';
import { describe, expect, it, vi } from 'vitest';
import { nextTick, shallowRef } from 'vue';

import type { SelfHostedSettingsView, SettingsInput } from '../utils/form.js';
import { useDeploymentSettingsForm } from './useDeploymentSettingsForm.js';
import {
  useOrganizationLimitsForm,
  type OrganizationLimitsSaver,
} from './useOrganizationLimitsForm.js';
import { useSettings } from './useSettings.js';

/**
 * The composables take the procedures they call as arguments, so these specs hand them stubs and
 * stay in the plain-Node `unit` project, with no Nuxt app to boot.
 */
const SETTINGS: DeploymentSettings = {
  execution: {
    maxConcurrentTasks: 4,
    commandTimeoutMinutes: 30,
    allowedModes: ['observe', 'suggest', 'fix', 'autonomous'],
    maxNetwork: 'full',
  },
  model: null,
  runner: null,
};

function view(settings: DeploymentSettings = SETTINGS): SelfHostedSettingsView {
  return {
    edition: 'self-hosted',
    source: 'dashboard',
    editable: true,
    filePath: null,
    state: { ok: true, settings, saved: null, warnings: [] },
    services: [],
    bounds: {
      maxConcurrentTasks: { minimum: 1, maximum: 64 },
      commandTimeoutMinutes: { minimum: 1, maximum: 1440 },
    },
  };
}

describe('useDeploymentSettingsForm', () => {
  it('saves the mapped input and reports the stored view as saved', async () => {
    const stored = view({
      ...SETTINGS,
      execution: { ...SETTINGS.execution, maxConcurrentTasks: 2 },
    });
    const save = vi.fn<(input: SettingsInput) => Promise<SettingsView>>().mockResolvedValue(stored);
    const onSaved = vi.fn<(next: SettingsView) => void>();
    const editor = useDeploymentSettingsForm(() => view(), save, onSaved);

    editor.form.value.maxConcurrentTasks = '2';
    await editor.submit();

    expect(save).toHaveBeenCalledWith({
      execution: {
        maxConcurrentTasks: 2,
        commandTimeoutMinutes: 30,
        allowedModes: ['observe', 'suggest', 'fix', 'autonomous'],
        maxNetwork: 'full',
      },
      model: null,
      runner: null,
    });
    expect(onSaved).toHaveBeenCalledWith(stored);
    expect(editor.status.value).toBe('saved');
  });

  it('stops saying saved once the form no longer matches what was saved', async () => {
    const editor = useDeploymentSettingsForm(
      () => view(),
      () => Promise.resolve(view()),
      () => {},
    );

    await editor.submit();
    expect(editor.saved.value).toBe(true);

    editor.form.value.commandTimeoutMinutes = '10';
    expect(editor.saved.value).toBe(false);
    expect(editor.dirty.value).toBe(true);
  });

  it("puts each of the server's issues beside its field", async () => {
    const refusal = new ORPCError('BAD_REQUEST', {
      data: {
        issues: [
          {
            path: '$.execution.command_timeout_minutes',
            message: 'Expected an integer from 1 to 1440.',
          },
          { path: '$.runner.image', message: 'Expected a container image reference.' },
        ],
      },
    });
    const onSaved = vi.fn<(next: SettingsView) => void>();
    const editor = useDeploymentSettingsForm(
      () => view(),
      () => Promise.reject(refusal),
      onSaved,
    );

    await editor.submit();

    expect(editor.status.value).toBe('error');
    expect(editor.error.value).toBe('invalid');
    expect(editor.issues.value).toEqual({
      commandTimeoutMinutes: [{ text: 'Expected an integer from 1 to 1440.' }],
      runnerImage: [{ text: 'Expected a container image reference.' }],
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reports a refusal that is not about the values with no field issues', async () => {
    const editor = useDeploymentSettingsForm(
      () => view(),
      () => Promise.reject(new ORPCError('FORBIDDEN', { message: 'requires the admin role' })),
      () => {},
    );

    await editor.submit();

    expect(editor.error.value).toBe('forbidden');
    expect(editor.issues.value).toEqual({});
  });

  it('never calls the server for a form it cannot express', async () => {
    const save = vi.fn<(input: SettingsInput) => Promise<SettingsView>>();
    const editor = useDeploymentSettingsForm(
      () => view(),
      save,
      () => {},
    );

    editor.form.value.maxConcurrentTasks = '';
    await editor.submit();

    expect(save).not.toHaveBeenCalled();
    expect(editor.issues.value.maxConcurrentTasks).toEqual([
      { key: 'dashboard.settings.form.numberRequired' },
    ]);
  });

  it('starts the draft over when the settings it describes change', async () => {
    const current = shallowRef(view());
    const editor = useDeploymentSettingsForm(
      () => current.value,
      vi.fn(),
      () => {},
    );
    editor.form.value.maxConcurrentTasks = '9';

    current.value = view({
      ...SETTINGS,
      execution: { ...SETTINGS.execution, maxConcurrentTasks: 3 },
    });
    await nextTick();

    expect(editor.form.value.maxConcurrentTasks).toBe('3');
    expect(editor.dirty.value).toBe(false);
  });
});

describe('useOrganizationLimitsForm', () => {
  it('saves for the organization the view names, and reports a value above the plan', async () => {
    const organization: OrganizationSettingsView = {
      id: 'org_acme',
      role: 'admin',
      editable: true,
      limits: { maxConcurrentTasks: null, commandTimeoutMinutes: null, allowedModes: null },
      invalid: false,
      effective: null,
    };
    const save = vi.fn<OrganizationLimitsSaver>().mockRejectedValue(
      new ORPCError('BAD_REQUEST', {
        data: {
          issues: [{ path: '$.max_concurrent_tasks', message: 'The plan allows at most 4.' }],
        },
      }),
    );
    const editor = useOrganizationLimitsForm(
      () => organization,
      () => null,
      save,
      () => {},
    );

    editor.form.value.maxConcurrentTasks = '8';
    await editor.submit();

    expect(save).toHaveBeenCalledWith({
      organizationId: 'org_acme',
      limits: { maxConcurrentTasks: 8, commandTimeoutMinutes: null, allowedModes: null },
    });
    expect(editor.issues.value).toEqual({
      maxConcurrentTasks: [{ text: 'The plan allows at most 4.' }],
    });
  });
});

describe('useSettings', () => {
  it('clears the view when a later read is refused, so nothing stale reads as permission', async () => {
    const read = vi
      .fn<() => Promise<SettingsView>>()
      .mockResolvedValueOnce(view())
      .mockRejectedValueOnce(new ORPCError('FORBIDDEN'));
    const settings = useSettings(read);

    await settings.refresh();
    expect(settings.view.value?.edition).toBe('self-hosted');

    await settings.refresh();
    expect(settings.view.value).toBeNull();
    expect(settings.error.value).toBe('forbidden');
  });
});
