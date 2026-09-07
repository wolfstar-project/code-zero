/**
 * An empty `heartbeat` message every 20s. Nothing reads it: it exists so an idle connection keeps
 * producing bytes, which is what stops a proxy from reclaiming it as dead during a long quiet run.
 * Named rather than unnamed so it never reaches the client's `message` handler as an empty
 * overview — `EventSource` only delivers a named event to a listener that asked for it.
 */
const HEARTBEAT_MS = 20_000;

/**
 * Concurrent streams one signed-in account may hold open, and across every account combined.
 *
 * Each stream costs one `subscribeOverview` listener and one heartbeat timer for the life of the
 * connection (see below), so an account that never closes a tab — or a client retrying without
 * backing off — must not be able to grow either without bound.
 *
 * ponytail: fixed in-process counters, so a multi-instance deployment enforces this per instance
 * rather than per account across the fleet. Move to a shared counter (e.g. the database or a
 * cache) if running more than one instance makes that gap matter.
 */
const MAX_STREAMS_PER_USER = 6;
const MAX_TOTAL_STREAMS = 500;

const streamsByUser = new Map<string, number>();
let totalStreams = 0;

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
  const session = await requireUserSession(event);
  const userId = session.user.id;

  const forUser = streamsByUser.get(userId) ?? 0;
  if (forUser >= MAX_STREAMS_PER_USER || totalStreams >= MAX_TOTAL_STREAMS)
    throw errors.tooManyRequests('Too many live connections; close another tab and retry');
  streamsByUser.set(userId, forUser + 1);
  totalStreams += 1;
  let released = false;
  function release(): void {
    if (released) return;
    released = true;
    totalStreams -= 1;
    const remaining = (streamsByUser.get(userId) ?? 1) - 1;
    if (remaining <= 0) streamsByUser.delete(userId);
    else streamsByUser.set(userId, remaining);
  }

  const stream = createEventStream(event);
  let closed = false;
  // Set the moment any live broadcast reaches this connection, so the still-pending initial read
  // below never overwrites it with what is, by then, a stale snapshot.
  let receivedLiveUpdate = false;

  async function push(overview: unknown): Promise<void> {
    if (closed) return;
    try {
      await stream.push(JSON.stringify(overview));
    } catch {
      // The client went away between the write landing and this read finishing. Nothing to
      // report: `onClosed` below is what tears the subscription down.
    }
  }

  const unsubscribe = subscribeOverview((overview) => {
    receivedLiveUpdate = true;
    void push(overview);
  });

  const heartbeat = setInterval(() => {
    if (!closed) void stream.push({ event: 'heartbeat', data: '' }).catch(() => undefined);
  }, HEARTBEAT_MS);

  stream.onClosed(() => {
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    release();
  });

  // The current state before any change, so a page that connects mid-run renders immediately
  // rather than staying empty until something else happens. Not awaited: `send()` is what puts the
  // response on the wire, and a push that ran before it would be waiting for a reader that does
  // not exist yet — the request would hang without ever answering.
  //
  // Subscribed above before this read starts, so a broadcast racing this read is never missed —
  // but that also means a broadcast can land first and finish before this slower read does. This
  // snapshot is only ever older in that case, so it is dropped rather than sent: applying it would
  // overwrite the newer state the client already has with a stale one.
  void currentOverview().then((overview) => (receivedLiveUpdate ? undefined : push(overview)));
  return stream.send();
});
