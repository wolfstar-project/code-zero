// Imported explicitly rather than relying on Nuxt auto-imports, so the dependency stays visible at
// the call site; `nuxt typecheck` resolves either form.
import type { AuditEvent, AuditLogPage } from '@code-zero/api';
import { ref } from 'vue';

/** What the page needs to tell an unauthorized reader apart from a broken one. */
export type AuditLogError = 'forbidden' | 'unauthorized' | 'generic';

/**
 * The audit log, read one page at a time from `GET /api/audit-logs`.
 *
 * Client-side only, deliberately. The endpoint authenticates the browser's session cookie, and
 * fetching it during SSR would mean forwarding that cookie from the server render — a wider
 * surface than this page needs, and one no other page in this app has taken on yet. The trail is
 * also not first-paint content: an operator opens this page to look something up, and a spinner
 * for one round trip costs less than a hydration mismatch.
 *
 * State is local rather than `useState`: two tabs of the audit log should each hold their own
 * scroll-back rather than share a cursor.
 */
export function useAuditLogs(pageSize = 25) {
  const events = ref<AuditEvent[]>([]);
  const nextCursor = ref<string | null>(null);
  const pending = ref(false);
  const error = ref<AuditLogError | null>(null);

  /** Loads one page; without a cursor it replaces the list, with one it appends. */
  async function load(cursor?: string): Promise<void> {
    pending.value = true;
    error.value = null;
    try {
      const page = await $fetch<AuditLogPage>('/api/audit-logs', {
        query: { limit: pageSize, ...(cursor ? { cursor } : {}) },
      });
      events.value = cursor ? [...events.value, ...page.events] : page.events;
      nextCursor.value = page.nextCursor;
    } catch (caught) {
      error.value = classify(caught);
      // A failed page leaves what was already read in place: losing the reader's position is a
      // worse answer to a transient failure than showing a stale list beside the error. The
      // cursor survives with it, so a retry re-requests the page that failed through `loadMore`
      // instead of falling back to a cursorless `refresh()` that would replace every page the
      // reader has already scrolled through.
      if (!cursor) {
        events.value = [];
        nextCursor.value = null;
      }
    } finally {
      pending.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (nextCursor.value) await load(nextCursor.value);
  }

  return { events, nextCursor, pending, error, load, loadMore, refresh: () => load() };
}

/**
 * The status decides the message, never the server's own error text: it is untrusted input, and
 * the page renders what this returns.
 */
function classify(caught: unknown): AuditLogError {
  const status =
    caught && typeof caught === 'object' && 'statusCode' in caught
      ? (caught as { statusCode?: unknown }).statusCode
      : undefined;
  if (status === 403) return 'forbidden';
  if (status === 401) return 'unauthorized';
  return 'generic';
}
