import { dashboardOverview, type DashboardOverview, type TaskStore } from '@code-zero/api';

/** Coalesces a burst of writes into one push. A run records several lifecycle events in a row. */
const PUSH_DELAY_MS = 250;

type OverviewListener = (overview: DashboardOverview) => void;

/** The one thing a broadcaster reads to answer "what changed". Narrow so a test needs no store. */
interface OverviewSource {
  list: TaskStore['list'];
}

/** The one thing a broadcaster listens on. `EventEmitter`, reduced to the method this uses. */
interface ChangeSignal {
  on(event: string, listener: () => void): unknown;
}

export interface OverviewBroadcaster {
  /** The overview as of right now, for a stream that just connected and has nothing to wait for yet. */
  currentOverview(): Promise<DashboardOverview>;
  /** Registers a stream for every future overview. Returns the function that stops it. */
  subscribeOverview(listener: OverviewListener): () => void;
}

/**
 * Builds the debounced, shared broadcast described in {@link currentOverview} below.
 *
 * Takes the store and the change signal as parameters rather than reading `taskStore`/
 * `taskChanges` directly, so this stays testable without the ViteHub KV binding those resolve to
 * at runtime — the same reason `observeWrites` in `./store.ts` takes its store as a parameter. The
 * module-level export below is the one real caller; everything here is what a test drives instead.
 */
export function createOverviewBroadcaster(
  store: OverviewSource,
  changes: ChangeSignal,
  changedEvent: string,
): OverviewBroadcaster {
  const listeners = new Set<OverviewListener>();
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  // Set for the duration of the store read a broadcast is actually performing, which is not the
  // same window `scheduled` covers: `scheduled` only spans the debounce delay before that read
  // starts. Without this, a change arriving while a slow read is already in flight would see
  // `scheduled` cleared and arm a second, overlapping read — exactly the N-scans-per-write cost
  // this exists to avoid, just moved from N listeners to N racing reads.
  let reading = false;
  let changedWhileReading = false;

  async function broadcast(): Promise<void> {
    scheduled = undefined;
    reading = true;
    try {
      const overview = dashboardOverview(await store.list());
      for (const listener of listeners) listener(overview);
    } catch (error) {
      console.error('[events] failed to compute the dashboard overview', error);
    } finally {
      reading = false;
      // A change that arrived mid-read was not represented in the snapshot just read — and was
      // deliberately not scheduled while `reading` held, so it must not be dropped now that the
      // read that would have missed it is done.
      if (changedWhileReading) {
        changedWhileReading = false;
        scheduleBroadcast();
      }
    }
  }

  function scheduleBroadcast(): void {
    if (reading) {
      changedWhileReading = true;
      return;
    }
    if (scheduled) return;
    scheduled = setTimeout(() => void broadcast(), PUSH_DELAY_MS);
  }

  changes.on(changedEvent, scheduleBroadcast);

  return {
    currentOverview: () => store.list().then((tasks) => dashboardOverview(tasks)),
    subscribeOverview: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let broadcaster: OverviewBroadcaster | undefined;

/**
 * The one broadcaster this process runs, built from the real store and the real change signal.
 *
 * Lazy rather than built at module load: `createOverviewBroadcaster` is what a test imports and
 * drives directly, and building this at the top level would reach for `taskStore`/`taskChanges` —
 * Nitro auto-imports resolved only inside the running server — the moment this module loaded,
 * which is exactly what a plain test import must not do.
 *
 * One `taskStore.list()` per write, shared by every listener, rather than one per listener: a
 * single signed-in user with several tabs open each held their own subscription and re-read the
 * whole store independently, so N open streams turned one write into N full scans. This is what
 * keeps that cost at one regardless of how many streams are listening.
 */
function overviewBroadcaster(): OverviewBroadcaster {
  broadcaster ??= createOverviewBroadcaster(taskStore, taskChanges, TASK_CHANGED);
  return broadcaster;
}

export function currentOverview(): Promise<DashboardOverview> {
  return overviewBroadcaster().currentOverview();
}

export function subscribeOverview(listener: OverviewListener): () => void {
  return overviewBroadcaster().subscribeOverview(listener);
}
