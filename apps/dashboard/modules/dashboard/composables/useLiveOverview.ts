// Imported explicitly rather than relying on Nuxt auto-imports, so the dependency stays visible at
// the call site, the same way `modules/audit/composables/useAuditLogs.ts` does it.
import { useQueryClient } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue';

import type { DashboardOverview } from '../types/dashboard.js';

/**
 * How long a stream may stay quiet before the page stops presenting its data as current. Longer
 * than the server's 20s heartbeat, so an idle-but-healthy connection is never called stale.
 */
const STALE_AFTER_MS = 45_000;

/** Matches the server's own reconnect expectations without hammering it after a restart. */
const RECONNECT_DELAY_MS = 1_500;

export interface LiveOverview {
  /** Whether the stream is currently carrying updates. */
  connected: Readonly<Ref<boolean>>;
  /**
   * Whether the last message is old enough that the page should say so.
   *
   * Old data on a monitoring surface is worse than none, because it still looks authoritative.
   */
  stale: Readonly<Ref<boolean>>;
}

/**
 * Keeps the dashboard overview current from `/api/events`, writing each message straight into the
 * TanStack Query cache the page already reads.
 *
 * `setQueryData` rather than `invalidateQueries`: the message *is* the new overview, so refetching
 * would ask the server for what it just sent. The query itself stays the loader for the first
 * paint and for a client that never gets a stream open.
 *
 * Takes the query key rather than reaching for `useNuxtApp().$orpc`, so nothing here depends on
 * the Nuxt app instance: the page already holds the typed client, and a composable that takes what
 * it needs is one the unit suite can drive without standing up a runtime to inject it.
 *
 * Client-only. `EventSource` does not exist during SSR, and a server render has no window in which
 * a later message could arrive anyway.
 */
export function useLiveOverview(queryKey: readonly unknown[]): LiveOverview {
  const queryClient = useQueryClient();

  const connected = ref(false);
  const lastMessageAt = ref(0);
  const now = ref(Date.now());

  const stale = computed(
    () => lastMessageAt.value > 0 && now.value - lastMessageAt.value > STALE_AFTER_MS,
  );

  if (import.meta.client) {
    let source: EventSource | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const clock = setInterval(() => {
      now.value = Date.now();
    }, 1_000);

    const open = (): void => {
      const stream = new EventSource('/api/events');
      source = stream;
      stream.addEventListener('open', () => {
        connected.value = true;
      });
      stream.addEventListener('message', (message: MessageEvent<string>) => {
        connected.value = true;
        lastMessageAt.value = Date.now();
        now.value = lastMessageAt.value;
        try {
          const parsed: unknown = JSON.parse(message.data);
          // Checked rather than asserted: the cache this writes into is what the page renders, so
          // a frame that is not an overview has to be dropped instead of blanking the board.
          if (isOverview(parsed)) queryClient.setQueryData(queryKey, parsed);
        } catch {
          // A truncated frame is not worth tearing the connection down for: the next message
          // carries the whole overview again.
        }
      });
      // Fires for a dropped connection and for a refused one alike. `EventSource` retries on its
      // own, but not after the server closed the stream deliberately, so the reconnect is explicit.
      stream.addEventListener('error', () => {
        connected.value = false;
        stream.close();
        if (reconnect === undefined)
          reconnect = setTimeout(() => {
            reconnect = undefined;
            open();
          }, RECONNECT_DELAY_MS);
      });
    };

    onMounted(open);
    onBeforeUnmount(() => {
      clearInterval(clock);
      if (reconnect !== undefined) clearTimeout(reconnect);
      source?.close();
      connected.value = false;
    });
  }

  return { connected: readonly(connected), stale: readonly(stale) };
}

/** The one field the page cannot render without; everything else is counters it defaults to zero. */
function isOverview(value: unknown): value is DashboardOverview {
  return (
    typeof value === 'object' && value !== null && 'tasks' in value && Array.isArray(value.tasks)
  );
}
