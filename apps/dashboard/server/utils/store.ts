import {
  createAuditRecorder,
  PersistentAuditLogStore,
  PersistentDeliveryClaimStore,
  PersistentTaskStore,
  type AuditLogStore,
  type AuditRecorder,
  type DeliveryClaimStore,
  type KeyValueStorage,
  type TaskStore,
} from '@code-zero/api';
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

export const taskStore: TaskStore = new PersistentTaskStore(storage);

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
 * The durable audit trail, read by `server/api/audit-logs.get.ts` and written by the procedures
 * both transports serve. It shares the deployment's KV backend with task history rather than
 * opening a store of its own, so an audit record survives a restart exactly as a task does.
 */
export const auditLogStore: AuditLogStore = new PersistentAuditLogStore(storage);

/**
 * One recorder per server process, injected into the RPC context by both transports. Built here
 * rather than in `context.ts` because it is a deployment-owned capability, like the stores above,
 * and because the recorder must be the same instance for every request the process serves.
 */
export const auditRecorder: AuditRecorder = createAuditRecorder({ store: auditLogStore });
