import type { AuditEvent, AuditLogPage } from '@code-zero/api';
import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';

import { useAuditLogs, type AuditLogReader } from './useAuditLogs.js';

/**
 * The composable takes its reader as an argument, so a spec hands it one instead of standing up
 * the Nuxt app the real client hangs off. That is what keeps these in the plain-Node `unit`
 * project.
 */
function reader(...responses: (AuditLogPage | Error)[]): AuditLogReader {
  const queue = [...responses];
  return () => {
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error('No response queued for this call'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
}

function event(id: string): AuditEvent {
  return {
    id,
    occurredAt: '2026-08-09T10:00:00.000Z',
    actor: { type: 'api', id: 'release-manager' },
    action: 'task.created',
    outcome: 'success',
  };
}

function page(ids: string[], nextCursor: string | null): AuditLogPage {
  return { events: ids.map(event), nextCursor };
}

/** The shape oRPC rejects with; only the code is read, and never the server's text. */
function rejection(code: 'FORBIDDEN' | 'UNAUTHORIZED' | 'INTERNAL_SERVER_ERROR'): Error {
  return new ORPCError(code);
}

describe('useAuditLogs', () => {
  it('appends a cursor-loaded page to the rows already read', async () => {
    const log = useAuditLogs(reader(page(['audit_3'], 'cursor_1'), page(['audit_2'], null)));

    await log.refresh();
    await log.loadMore();

    expect(log.events.value.map((entry) => entry.id)).toEqual(['audit_3', 'audit_2']);
    expect(log.nextCursor.value).toBeNull();
  });

  it('keeps the cursor when a page load fails, so the same page can be retried', async () => {
    const log = useAuditLogs(
      reader(
        page(['audit_3'], 'cursor_1'),
        rejection('INTERNAL_SERVER_ERROR'),
        page(['audit_2'], null),
      ),
    );
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
    const log = useAuditLogs(reader(page(['audit_3'], 'cursor_1'), rejection('FORBIDDEN')));
    await log.refresh();

    await log.refresh();

    expect(log.error.value).toBe('forbidden');
    expect(log.events.value).toEqual([]);
    expect(log.nextCursor.value).toBeNull();
  });
});
