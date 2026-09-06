import { dashboardOverview, type DashboardOverview } from '@code-zero/api';

/** Coalesces a burst of writes into one push. A run records several lifecycle events in a row. */
const PUSH_DELAY_MS = 250;

type OverviewListener = (overview: DashboardOverview) => void;

const listeners = new Set<OverviewListener>();
let scheduled: ReturnType<typeof setTimeout> | undefined;

/**
 * Recomputes the overview once and hands it to every connected stream.
 *
 * One `taskStore.list()` per write, shared by every listener, rather than one per listener: a
 * single signed-in user with several tabs open each held their own subscription and re-read the
 * whole store independently, so N open streams turned one write into N full scans. This is what
 * keeps that cost at one regardless of how many streams are listening.
 */
function broadcast(): void {
  scheduled = undefined;
  void taskStore
    .list()
    .then((tasks) => {
      const overview = dashboardOverview(tasks);
      for (const listener of listeners) listener(overview);
    })
    .catch((error: unknown) => {
      console.error('[events] failed to compute the dashboard overview', error);
    });
}

function scheduleBroadcast(): void {
  if (scheduled) return;
  scheduled = setTimeout(broadcast, PUSH_DELAY_MS);
}

taskChanges.on(TASK_CHANGED, scheduleBroadcast);

/**
 * The overview as of right now, for a stream that just connected and has nothing to wait for yet.
 */
export function currentOverview(): Promise<DashboardOverview> {
  return taskStore.list().then((tasks) => dashboardOverview(tasks));
}

/** Registers a stream for every future overview. Returns the function that stops it. */
export function subscribeOverview(listener: OverviewListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
