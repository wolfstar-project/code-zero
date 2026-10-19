import type { SettingsView } from '@code-zero/api';
import { describe, expect, it } from 'vitest';

import { useSettings } from './useSettings';

function cloudView(organizationId: string): SettingsView {
  return {
    edition: 'cloud',
    services: [],
    plan: null,
    organization: {
      id: organizationId,
      role: 'owner',
      editable: true,
      limits: { maxConcurrentTasks: null, commandTimeoutMinutes: null, allowedModes: null },
      invalid: false,
      effective: null,
    },
    bounds: {
      maxConcurrentTasks: { minimum: 1, maximum: 64 },
      commandTimeoutMinutes: { minimum: 1, maximum: 1440 },
    },
  };
}

/** A read the test answers by hand, so two reads can finish in the opposite order. */
function deferredReads() {
  const pending: ((view: SettingsView) => void)[] = [];
  const read = () =>
    new Promise<SettingsView>((resolve) => {
      pending.push(resolve);
    });
  return { read, pending };
}

describe('useSettings', () => {
  it('keeps the latest read when an earlier one answers last', async () => {
    const { read, pending } = deferredReads();
    const settings = useSettings(read);

    const first = settings.refresh();
    const second = settings.refresh();
    pending[1]?.(cloudView('org_b'));
    await second;
    pending[0]?.(cloudView('org_a'));
    await first;

    expect(settings.view.value?.edition === 'cloud' && settings.view.value.organization?.id).toBe(
      'org_b',
    );
    expect(settings.pending.value).toBe(false);
  });

  it('stays pending until the latest read answers', async () => {
    const { read, pending } = deferredReads();
    const settings = useSettings(read);

    const first = settings.refresh();
    void settings.refresh();
    pending[0]?.(cloudView('org_a'));
    await first;

    expect(settings.pending.value).toBe(true);
    expect(settings.view.value).toBeNull();
  });
});
