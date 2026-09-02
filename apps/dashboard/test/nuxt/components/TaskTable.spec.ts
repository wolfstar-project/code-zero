import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import TaskTable from '~~/modules/dashboard/components/task/Table.vue';
import type { DashboardTask } from '~~/modules/dashboard/types/dashboard';

const QUEUED: DashboardTask[] = [
  {
    id: 'cz_alpha_0001',
    repository: 'acme/checkout',
    status: 'running',
    createdAt: '2026-08-09T09:00:00.000Z',
    updatedAt: '2026-08-09T10:00:00.000Z',
    events: [],
  },
  {
    id: 'cz_beta_0002',
    repository: 'acme/billing',
    status: 'queued',
    createdAt: '2026-08-09T08:00:00.000Z',
    updatedAt: '2026-08-09T09:00:00.000Z',
    events: [],
  },
];

function repositoryCells(wrapper: { findAll: (selector: string) => { text: () => string }[] }) {
  return wrapper.findAll('tbody tr td:nth-child(2) p:first-child').map((cell) => cell.text());
}

describe('TaskTable', () => {
  it('renders one row per task, newest first', async () => {
    const wrapper = await mountSuspended(TaskTable, { props: { tasks: QUEUED } });

    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    expect(repositoryCells(wrapper)).toEqual(['checkout', 'billing']);
  });

  it('reorders the queue when a column header is used', async () => {
    const wrapper = await mountSuspended(TaskTable, { props: { tasks: QUEUED } });

    // Second header is Repository; ascending puts billing above checkout.
    await wrapper.findAll('thead button')[1]?.trigger('click');

    await vi.waitFor(() => {
      expect(repositoryCells(wrapper)).toEqual(['billing', 'checkout']);
    });
  });

  it('marks the sorted column for assistive technology', async () => {
    const wrapper = await mountSuspended(TaskTable, { props: { tasks: QUEUED } });

    await wrapper.findAll('thead button')[1]?.trigger('click');

    await vi.waitFor(() => {
      expect(wrapper.findAll('thead th')[1]?.attributes('aria-sort')).toBe('ascending');
    });
  });

  it('narrows the queue to what the filter matches', async () => {
    const wrapper = await mountSuspended(TaskTable, { props: { tasks: QUEUED } });

    await wrapper.get('input[type="search"]').setValue('billing');

    await vi.waitFor(() => {
      expect(repositoryCells(wrapper)).toEqual(['billing']);
    });
  });

  it('says so when the filter matches nothing, rather than looking empty', async () => {
    const wrapper = await mountSuspended(TaskTable, { props: { tasks: QUEUED } });

    await wrapper.get('input[type="search"]').setValue('nothing-matches-this');

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('No rows match this filter.');
    });
  });

  it('selects the task the reader clicks', async () => {
    const wrapper = await mountSuspended(TaskTable, { props: { tasks: QUEUED } });

    await wrapper.findAll('tbody tr')[1]?.trigger('click');

    expect(wrapper.emitted('select')).toEqual([['cz_beta_0002']]);
  });

  it('exposes the ids in display order, which is what keyboard selection walks', async () => {
    const wrapper = await mountSuspended(TaskTable, { props: { tasks: QUEUED } });

    expect(wrapper.vm.orderedIds).toEqual(['cz_alpha_0001', 'cz_beta_0002']);

    // Sorting by repository ascending flips them, and the exposed order has to follow.
    await wrapper.findAll('thead button')[1]?.trigger('click');

    await vi.waitFor(() => {
      expect(wrapper.vm.orderedIds).toEqual(['cz_beta_0002', 'cz_alpha_0001']);
    });
  });
});
