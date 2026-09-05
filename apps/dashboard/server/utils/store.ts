import { EventEmitter } from 'node:events';

import {
  auditLogPlugins,
  PersistentAuditLogStore,
  PersistentDeliveryClaimStore,
  PersistentTaskStore,
  type AuditLogStore,
  type DeliveryClaimStore,
  type KeyValueStorage,
  type StoredTask,
  type TaskStore,
} from '@code-zero/api';
import type { EvlogPlugin } from 'evlog';
import { kv } from 'vite-hub/kv';

/** Adapts the ViteHub KV Runtime Helper to the transport-neutral {@link KeyValueStorage} contract. */
class KvKeyValueStorage implements KeyValueStorage {
  async getItem(key: string): Promise<unknown> {
    const [error, value] = await kv.get(key);
    if (error) throw error;
    return value;
  }

  async setItem(key: string, value: unknown): Promise<void> {
    const [error] = await kv.set(key, value);
    if (error) throw error;
  }

  async getKeys(base = ''): Promise<string[]> {
    const [error, keys] = await kv.keys(base);
    if (error) throw error;
    return keys ?? [];
  }

  async removeItem(key: string): Promise<void> {
    const [error] = await kv.del(key);
    if (error) throw error;
  }
}

/**
 * One shared storage instance per server process. The KV driver (fs-lite locally;
 * Cloudflare KV, Deno KV, or Upstash when hosted) follows the deployment preset registered in
 * `../../nuxt.config.ts`, so this module never changes when the deployment target does.
 */
const storage: KeyValueStorage = new KvKeyValueStorage();

/**
 * Announces that a task record changed, so `server/api/events.get.ts` can push the overview to
 * every connected dashboard instead of waiting for someone to press refresh.
 *
 * Process-local on purpose. It carries no payload and is not a message bus: a listener re-reads
 * the store, which is the durable copy every instance shares. A second server instance therefore
 * pushes its own writes and not this one's — the same limitation the page had when it polled, and
 * one only a shared pub/sub backend would remove.
 *
 * The listener cap is lifted because a listener is one open browser tab, not a leak; each stream
 * removes its own in `onClosed`.
 */
export const taskChanges = new EventEmitter().setMaxListeners(0);

/** The event `taskChanges` emits. Named once so a subscriber cannot misspell it. */
export const TASK_CHANGED = 'changed';

/**
 * The same store, announcing each write once it has landed.
 *
 * A decorator rather than a subclass: it composes over any {@link TaskStore}, which is what lets a
 * test drive it against an in-memory one instead of the deployment's KV. The notification fires
 * after the write resolves, so a subscriber that re-reads the store cannot observe the state from
 * before it.
 *
 * Wrapping here rather than in `packages/api` keeps the notification where the connections are:
 * the store contract stays a plain persistence interface, and the package that owns it holds no
 * transport concern.
 */
export function observeWrites(store: TaskStore, notify: () => void): TaskStore {
  return {
    get: (id) => store.get(id),
    list: () => store.list(),
    async save(task: StoredTask): Promise<void> {
      await store.save(task);
      notify();
    },
  };
}

/**
 * Every writer — the router's `tasks.create`, the webhook route, the poller, and the run itself as
 * it records lifecycle events — goes through this one instance, so subscribing to it observes the
 * whole lifecycle and not only the transitions one transport happens to see.
 */
export const taskStore: TaskStore = observeWrites(new PersistentTaskStore(storage), () => {
  taskChanges.emit(TASK_CHANGED);
});

/**
 * The one durable delivery-claim store for this deployment, injected as
 * `WebhookOptions.deliveryClaims` by the webhook route (`routes/webhooks/github.post.ts`):
 * because the claims live in the shared KV backend rather than a process-local map, a
 * redelivered issue event observes the recorded outcome across restarts and across server
 * instances instead of starting a duplicate run. The KV facade has no conditional write, so
 * the claim uses the store's splitter fallback, which grants at most one owner among
 * contenders that all saw the key absent; the router's in-memory registry still serializes
 * concurrent deliveries within one process.
 */
export const deliveryClaimStore: DeliveryClaimStore = new PersistentDeliveryClaimStore(storage);

/**
 * The durable audit trail, read by the router's `audit.list` and written by the evlog drain in
 * {@link auditPlugins}. It shares the deployment's KV backend with task history rather than
 * opening a store of its own, so an audit record survives a restart exactly as a task does.
 */
export const auditLogStore: AuditLogStore = new PersistentAuditLogStore(storage);

/**
 * The evlog plugins that carry `log.audit()` from a procedure to {@link auditLogStore}, handed to
 * `EvlogHandlerPlugin` by both transports.
 *
 * Built here rather than in each route because it is a deployment-owned capability, like the
 * stores above, and because both transports must install the same pipeline — a trail that
 * depended on which wire protocol a caller reached for would be worse than none.
 */
export const auditPlugins: EvlogPlugin[] = auditLogPlugins({
  store: auditLogStore,
  // The drain fails open, so a lost record would otherwise be silent. Nitro's console is the one
  // place this process can still report to at that point: the request it belonged to has already
  // been answered.
  onError: (error) => {
    console.error('[audit] failed to append an audit record', error);
  },
});
