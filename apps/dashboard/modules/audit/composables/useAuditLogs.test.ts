import type { AuditEvent, AuditLogPage } from '@code-zero/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAuditLogs } from './useAuditLogs.js';

/**
 * `$fetch` is a Nuxt global rather than an import, so the specs stub it. Nothing else in the
 * composable needs the app runtime, which keeps these in the plain-Node `unit` project.
 */
function stubFetch(...responses: (AuditLogPage | Error)[]): void {
  const queue = [...responses];
  vi.stubGlobal('$fetch', () => {
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
}

function event(id: string): AuditEvent {
  return {
    id,
    occurredAt: '2026-08-09T10:00:00.000Z',
    actor: { kind: 'principal', name: 'release-manager' },
    action: 'task.created',
    outcome: 'success',
  };
}

function page(ids: string[], nextCursor: string | null): AuditLogPage {
  return { events: ids.map(event), nextCursor };
}

/** The shape `$fetch` rejects with; only `statusCode` is read, and never the server's text. */
function httpError(statusCode: number): Error {
  return Object.assign(new Error('request failed'), { statusCode });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAuditLogs', () => {
  it('appends a cursor-loaded page to the rows already read', async () => {
    stubFetch(page(['audit_3'], 'cursor_1'), page(['audit_2'], null));
    const log = useAuditLogs();

    await log.refresh();
    await log.loadMore();

    expect(log.events.value.map((entry) => entry.id)).toEqual(['audit_3', 'audit_2']);
    expect(log.nextCursor.value).toBeNull();
  });

  it('keeps the cursor when a page load fails, so the same page can be retried', async () => {
    stubFetch(page(['audit_3'], 'cursor_1'), httpError(503), page(['audit_2'], null));
    const log = useAuditLogs();
    await log.refresh();

    await log.loadMore();

    // Clearing the cursor here would strand the retained rows behind a cursorless `refresh()`,
    // which replaces every page the reader had already scrolled through.
    expect(log.error.value).toBe('generic');
    expect(log.nextCursor.value).toBe('cursor_1');
    expect(log.events.value.map((entry) => entry.id)).toEqual(['audit_3']);

    await log.loadMore();

    expect(log.error.value).toBeNull();
    expect(log.events.value.map((entry) => entry.id)).toEqual(['audit_3', 'audit_2']);
  });

  it('resets the list and the cursor when a cursorless load fails', async () => {
    stubFetch(page(['audit_3'], 'cursor_1'), httpError(403));
    const log = useAuditLogs();
    await log.refresh();

    await log.refresh();

    expect(log.error.value).toBe('forbidden');
    expect(log.events.value).toEqual([]);
    expect(log.nextCursor.value).toBeNull();
  });
});
