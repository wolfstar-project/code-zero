import type { AuditLogPage } from '@code-zero/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import type { AuditRow } from '../types/audit.js';

/**
 * The hosted trail is stubbed at the module boundary: its own spec covers the mapping, and what
 * matters here is only how the two lists come together.
 */
const authRows = ref<AuditRow[]>([]);
const authRefresh = vi.fn<() => Promise<void>>(async () => {});
const authLoadMore = vi.fn<() => Promise<void>>(async () => {});
let authHasMore = false;

vi.mock('./useAuthAuditLogs.js', () => ({
  useAuthAuditLogs: () => ({
    enabled: true,
    rows: authRows,
    pending: ref(false),
    error: ref(null),
    hasMore: () => authHasMore,
    load: vi.fn<() => Promise<void>>(),
    loadMore: authLoadMore,
    refresh: authRefresh,
  }),
}));

const { useAuditTrail } = await import('./useAuditTrail.js');

function controlPlanePage(nextCursor: string | null = null): AuditLogPage {
  return {
    events: [
      {
        id: 'audit_1',
        occurredAt: '2026-08-09T10:00:00.000Z',
        actor: { kind: 'principal', name: 'release-manager' },
        action: 'task.created',
        outcome: 'success',
        subject: { type: 'task', id: 'cz_1' },
        metadata: { repository: 'acme/app', mode: 'observe' },
      },
    ],
    nextCursor,
  };
}

const AUTH_ROW: AuditRow = {
  id: 'auth:2026-08-09T09:00:00.000Z:evt_1:0',
  occurredAt: '2026-08-09T09:00:00.000Z',
  source: 'authentication',
  actorName: 'sam@example.com',
  actorKind: 'user',
  action: 'user.sign_in',
  subject: '',
  details: '',
};

beforeEach(() => {
  authRows.value = [];
  authHasMore = false;
  authRefresh.mockClear();
  authLoadMore.mockClear();
  vi.stubGlobal('$fetch', () => Promise.resolve(controlPlanePage()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAuditTrail', () => {
  it('renders a control-plane record with its subject and metadata flattened', async () => {
    const trail = useAuditTrail();

    await trail.refresh();

    expect(trail.rows.value).toEqual([
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
    ]);
  });

  it('carries both trails in one list', async () => {
    authRows.value = [AUTH_ROW];
    const trail = useAuditTrail();

    await trail.refresh();

    expect(trail.rows.value.map((row) => row.source)).toEqual(['control-plane', 'authentication']);
    expect(authRefresh).toHaveBeenCalledOnce();
  });

  it('asks both trails for their next page, so neither is exhausted first', async () => {
    vi.stubGlobal('$fetch', () => Promise.resolve(controlPlanePage('cursor_1')));
    authHasMore = true;
    const trail = useAuditTrail();

    await trail.refresh();
    expect(trail.hasMore.value).toBe(true);

    await trail.loadMore();

    expect(authLoadMore).toHaveBeenCalledOnce();
  });

  it('reports more to read while either trail still has a page', async () => {
    authHasMore = true;
    const trail = useAuditTrail();

    await trail.refresh();

    // The control plane is exhausted (null cursor); the hosted trail is not.
    expect(trail.hasMore.value).toBe(true);
  });
});
