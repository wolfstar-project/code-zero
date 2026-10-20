// Imported explicitly rather than relying on Nuxt auto-imports, so the dependency stays visible at
// the call site; `nuxt typecheck` resolves either form.
import type { AuditEvent, AuditLogPage } from '@code-zero/api';
import { ORPCError } from '@orpc/client';
import { ref } from 'vue';

/** What the page needs to tell an unauthorized reader apart from a broken one. */
export type AuditLogError = 'forbidden' | 'unauthorized' | 'generic';

/**
 * The audit log, read one page at a time through the router's `audit.list` procedure.
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
/**
 * Reads one page of the trail; `$orpc.audit.list` from the page that owns the client.
 *
 * Taken as an argument rather than reached for through `useNuxtApp()`, so this composable depends
 * on the router's shape and not on the Nuxt app instance — which is also what lets the unit suite
 * drive it without standing up a runtime to inject one.
 */
export type AuditLogReader = (query: { limit?: number; cursor?: string }) => Promise<AuditLogPage>;

export function useAuditLogs(read: AuditLogReader, pageSize = 25) {
  const events = ref<AuditEvent[]>([]);
  const nextCursor = ref<string | null>(null);
  const pending = ref(false);
  const error = ref<AuditLogError | null>(null);

  /** Loads one page; without a cursor it replaces the list, with one it appends. */
  async function load(cursor?: string): Promise<void> {
    pending.value = true;
    error.value = null;
    try {
      const page = await read({ limit: pageSize, ...(cursor ? { cursor } : {}) });
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
 * The error code decides the message, never the server's own error text: it is untrusted input,
 * and the page renders what this returns.
 *
 * oRPC rejects with an `ORPCError` carrying the procedure's own code, so the two refusals the
 * router distinguishes — no session, and a session without the admin role — stay distinguishable
 * here without reading an HTTP status the transport chose.
 */
function classify(caught: unknown): AuditLogError {
  if (!(caught instanceof ORPCError)) return 'generic';
  if (caught.code === 'FORBIDDEN') return 'forbidden';
  if (caught.code === 'UNAUTHORIZED') return 'unauthorized';
  return 'generic';
}
