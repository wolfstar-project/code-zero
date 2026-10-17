import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import TaskInspector from '~~/modules/dashboard/components/task/Inspector.vue';
import type { DashboardTask } from '~~/modules/dashboard/types/dashboard';

const AWAITING: DashboardTask = {
  id: 'cz_alpha_0001',
  repository: 'acme/checkout',
  status: 'needs-human',
  createdAt: '2026-08-09T09:00:00.000Z',
  updatedAt: '2026-08-09T10:00:00.000Z',
  events: [],
};

const DECIDED: DashboardTask = {
  ...AWAITING,
  approval: {
    decision: 'approved',
    actor: 'ops@example.test',
    comment: 'Checked the diff.',
    decidedAt: '2026-08-09T11:00:00.000Z',
  },
};

describe('TaskInspector approvals', () => {
  it('offers a decision only while the run is waiting for one', async () => {
    const wrapper = await mountSuspended(TaskInspector, { props: { task: AWAITING } });

    expect(wrapper.find('form').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
  });

  it('emits the approval with the comment that was typed', async () => {
    const wrapper = await mountSuspended(TaskInspector, { props: { task: AWAITING } });

    await wrapper.find('textarea').setValue('  Verified against the checks.  ');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('decide')).toEqual([
      [{ decision: 'approved', comment: 'Verified against the checks.' }],
    ]);
  });

  it('emits a rejection from the second control, not a second form', async () => {
    const wrapper = await mountSuspended(TaskInspector, { props: { task: AWAITING } });

    await wrapper.find('button[type="button"]').trigger('click');

    expect(wrapper.emitted('decide')).toEqual([[{ decision: 'rejected', comment: '' }]]);
  });

  it('shows the recorded decision instead of the form once one exists', async () => {
    const wrapper = await mountSuspended(TaskInspector, { props: { task: DECIDED } });

    // A second decision is not a thing the control plane accepts, so offering one would be a
    // button whose only outcome is an error.
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('ops@example.test');
    expect(wrapper.text()).toContain('Checked the diff.');
  });

  it('offers nothing for a run that never stopped for a person', async () => {
    const wrapper = await mountSuspended(TaskInspector, {
      props: { task: { ...AWAITING, status: 'completed' } },
    });

    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('disables the controls while a decision is in flight', async () => {
    const wrapper = await mountSuspended(TaskInspector, {
      props: { task: AWAITING, pending: true },
    });

    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
  });

  it('renders the failure the page reports, so a lost decision is not silent', async () => {
    const wrapper = await mountSuspended(TaskInspector, {
      props: { task: AWAITING, error: 'The decision was not recorded. Nothing changed.' },
    });

    expect(wrapper.text()).toContain('The decision was not recorded.');
  });
});
