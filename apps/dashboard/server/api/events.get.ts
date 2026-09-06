/**
 * An empty `heartbeat` message every 20s. Nothing reads it: it exists so an idle connection keeps
 * producing bytes, which is what stops a proxy from reclaiming it as dead during a long quiet run.
 * Named rather than unnamed so it never reaches the client's `message` handler as an empty
 * overview — `EventSource` only delivers a named event to a listener that asked for it.
 */
const HEARTBEAT_MS = 20_000;

/**
 * The dashboard overview as it changes, over Server-Sent Events.
 *
 * A Nitro route rather than an oRPC procedure, for the reason `audit-logs.get.ts` is one: this is
 * the browser session's surface, not the operator token's. `dashboard.overview` stays the way any
 * other caller reads the same data, and a page that has this stream never has to poll it.
 *
 * Each message is the whole overview rather than a delta. The page renders the aggregate anyway,
 * so a delta would only add a way for the two to disagree, and a reconnecting client would need a
 * replay log to catch up rather than simply taking the next message as the truth.
 *
 * The overview itself is computed once per write and shared by every connected stream (see
 * `../utils/overview.ts`): this handler only pushes bytes onto its own connection, so opening more
 * tabs never costs the task store more reads.
 */
export default defineEventHandler(async (event) => {
  // Raises 401 when the request carries no session, so the stream is no more readable than the
  // page it feeds.
  await requireUserSession(event);

  const stream = createEventStream(event);
  let closed = false;

  async function push(overview: unknown): Promise<void> {
    if (closed) return;
    try {
      await stream.push(JSON.stringify(overview));
    } catch {
      // The client went away between the write landing and this read finishing. Nothing to
      // report: `onClosed` below is what tears the subscription down.
    }
  }

  const unsubscribe = subscribeOverview((overview) => void push(overview));

  const heartbeat = setInterval(() => {
    if (!closed) void stream.push({ event: 'heartbeat', data: '' }).catch(() => undefined);
  }, HEARTBEAT_MS);

  stream.onClosed(() => {
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
  });

  // The current state before any change, so a page that connects mid-run renders immediately
  // rather than staying empty until something else happens. Not awaited: `send()` is what puts the
  // response on the wire, and a push that ran before it would be waiting for a reader that does
  // not exist yet — the request would hang without ever answering.
  void currentOverview().then((overview) => push(overview));
  return stream.send();
});
