// Imported explicitly rather than relying on Nuxt auto-imports, so the dependency stays visible at
// the call site; `nuxt typecheck` resolves either form.
import type { AuditEvent } from '@code-zero/api';
import { computed } from 'vue';

import type { AuditRow } from '../types/audit.js';
import { useAuditLogs } from './useAuditLogs.js';
import { useAuthAuditLogs } from './useAuthAuditLogs.js';

/**
 * The audit page's one list, drawn from both trails.
 *
 * The two are fetched independently and simply concatenated: the table sorts by time, so rows
 * interleave without either source having to know about the other. Their paging differs — the
 * control plane hands back a cursor, the hosted service an offset — which is exactly why merging
 * them into a single paged request is not attempted. Loading more asks both for their next page,
 * so the list stays roughly balanced in time rather than exhausting one trail first.
 *
 * The two failure states stay separate. A hosted trail that refuses must not blank the control
 * plane's records, which this deployment owns and can always read; the page shows what it has and
 * says what is missing.
 */
export function useAuditTrail() {
  const controlPlane = useAuditLogs();
  const authentication = useAuthAuditLogs();

  const rows = computed<AuditRow[]>(() => [
    ...controlPlane.events.value.map(toRow),
    ...authentication.rows.value,
  ]);

  const pending = computed(() => controlPlane.pending.value || authentication.pending.value);
  const hasMore = computed(
    () => controlPlane.nextCursor.value !== null || authentication.hasMore(),
  );

  async function refresh(): Promise<void> {
    await Promise.all([controlPlane.refresh(), authentication.refresh()]);
  }

  async function loadMore(): Promise<void> {
    await Promise.all([controlPlane.loadMore(), authentication.loadMore()]);
  }

  return {
    rows,
    pending,
    hasMore,
    /** The control plane's own failure: this is the trail the page cannot do without. */
    error: controlPlane.error,
    /** Reported beside the list rather than in place of it. */
    authError: authentication.error,
    authEnabled: authentication.enabled,
    refresh,
    loadMore,
  };
}

/** The control plane's durable record, in the shape the table lays out. */
function toRow(event: AuditEvent): AuditRow {
  return {
    id: `control:${event.id}`,
    occurredAt: event.occurredAt,
    source: 'control-plane',
    actorName: event.actor.name,
    actorKind: event.actor.kind,
    action: event.action,
    subject: event.subject ? `${event.subject.type}:${event.subject.id}` : '',
    outcome: event.outcome,
    details: Object.entries(event.metadata ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(' · '),
  };
}
