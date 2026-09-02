import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import AuditTable from '~~/modules/audit/components/Table.vue';
import type { AuditRow } from '~~/modules/audit/types/audit';

const RECORDED: AuditRow[] = [
  {
    id: 'control:audit_1',
    occurredAt: '2026-08-09T10:00:00.000Z',
    source: 'control-plane',
    actorName: 'release-manager',
    actorKind: 'principal',
    action: 'task.created',
    subject: 'task:cz_1',
    outcome: 'success',
    details: 'repository=acme/app · mode=observe',
  },
  {
    id: 'control:audit_2',
    occurredAt: '2026-08-09T09:59:00.000Z',
    source: 'control-plane',
    actorName: 'ci',
    actorKind: 'principal',
    action: 'task.create',
    subject: '',
    outcome: 'denied',
    details: 'reason=mode-not-granted',
  },
  {
    id: 'auth:2026-08-09T09:58:00.000Z:sign-in:0',
    occurredAt: '2026-08-09T09:58:00.000Z',
    source: 'authentication',
    actorName: 'sam@example.com',
    actorKind: 'user',
    action: 'user.sign_in',
    subject: '',
    // No outcome: the hosted trail records none.
    details: 'IT · Milan',
  },
];

describe('AuditTable', () => {
  it('renders one row per recorded action, with actor and outcome', async () => {
    const wrapper = await mountSuspended(AuditTable, { props: { rows: RECORDED } });

    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    expect(wrapper.text()).toContain('release-manager');
    expect(wrapper.text()).toContain('task.created');
    expect(wrapper.text()).toContain('task:cz_1');
    expect(wrapper.text()).toContain('denied');
  });

  it('says which trail vouches for each row', async () => {
    const wrapper = await mountSuspended(AuditTable, { props: { rows: RECORDED } });

    expect(wrapper.text()).toContain('Control plane');
    expect(wrapper.text()).toContain('Authentication');
  });

  it('claims no outcome for a row whose source records none', async () => {
    const wrapper = await mountSuspended(AuditTable, {
      props: { rows: [RECORDED[2] as AuditRow] },
    });

    // The outcome cell is the last one; it must not borrow a verdict the hosted trail never gave.
    const outcome = wrapper.findAll('tbody tr td').at(-1);
    expect(outcome?.text()).toBe('—');
    expect(wrapper.text()).not.toContain('success');
  });

  it('explains an empty trail rather than rendering a bare table', async () => {
    const wrapper = await mountSuspended(AuditTable, { props: { rows: [] } });

    expect(wrapper.find('tbody').exists()).toBe(false);
    expect(wrapper.text()).toContain('No actions recorded yet');
  });

  it('offers a retry for a failure the reader can do something about', async () => {
    const wrapper = await mountSuspended(AuditTable, {
      props: { rows: [], error: 'generic' as const },
    });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('keeps rows on screen when a load-more failure leaves some behind', async () => {
    // `error` and non-empty `rows` together mean a `loadMore`, not the initial fetch, is what
    // failed — see `useAuditLogs` for why a cursorless failure clears `rows` itself. Swapping to
    // the full error card here would hide rows the reader already has for no reason.
    const wrapper = await mountSuspended(AuditTable, {
      props: { rows: RECORDED, error: 'generic' as const },
    });

    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    expect(wrapper.text()).toContain('release-manager');
    expect(wrapper.text()).not.toContain('The audit log could not be read');
  });

  it('offers no retry when the refusal is the reader’s own role', async () => {
    const wrapper = await mountSuspended(AuditTable, {
      props: { rows: [], error: 'forbidden' as const },
    });

    // Retrying cannot grant a role, so the button that implies it would is absent.
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toContain('admin role');
  });

  it('reorders the trail when a column header is used', async () => {
    const wrapper = await mountSuspended(AuditTable, { props: { rows: RECORDED } });

    // Third header is Actor; ascending puts `ci` first.
    await wrapper.findAll('thead button')[2]?.trigger('click');

    await vi.waitFor(() => {
      expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('ci');
    });
    expect(wrapper.findAll('thead th')[2]?.attributes('aria-sort')).toBe('ascending');
  });

  it('matches the filter against the timestamp the reader sees, not just its raw ISO form', async () => {
    const wrapper = await mountSuspended(AuditTable, { props: { rows: RECORDED } });

    // Whatever `toLocaleString` renders for this instant in the test environment's locale — the
    // exact string is a fixture detail, not something the filter accessor should have to reparse.
    const rendered = new Date('2026-08-09T10:00:00.000Z').toLocaleString('en');
    await wrapper.get('input[type="search"]').setValue(rendered);

    await vi.waitFor(() => {
      expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    });
    expect(wrapper.text()).toContain('task.created');
  });

  it('narrows the trail to what the filter matches', async () => {
    const wrapper = await mountSuspended(AuditTable, { props: { rows: RECORDED } });

    await wrapper.get('input[type="search"]').setValue('release-manager');

    await vi.waitFor(() => {
      expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    });
    expect(wrapper.text()).toContain('task.created');
  });

  it('filters across both trails on one box', async () => {
    const wrapper = await mountSuspended(AuditTable, { props: { rows: RECORDED } });

    await wrapper.get('input[type="search"]').setValue('sam@example.com');

    await vi.waitFor(() => {
      expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    });
    expect(wrapper.text()).toContain('user.sign_in');
  });

  it('says so when the filter matches nothing, rather than looking empty', async () => {
    const wrapper = await mountSuspended(AuditTable, { props: { rows: RECORDED } });

    await wrapper.get('input[type="search"]').setValue('nothing-matches-this');

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('No rows match this filter.');
    });
    // The empty-trail copy would be a lie here: the trail has entries, the filter hides them.
    expect(wrapper.text()).not.toContain('No actions recorded yet');
  });
});
