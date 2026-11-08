/**
 * The key-value helper the dashboard uses on Cloudflare, over a Workers KV binding.
 *
 * `nuxt.config.ts` aliases `vite-hub/kv` to this file in a Cloudflare build, so
 * `server/utils/store.ts` imports the same `kv` there as everywhere else. It answers with the same
 * `[error, value]` pairs, and nothing outside this file knows which store is behind them.
 *
 * Values are JSON, as `KeyValueStorage` documents. A key is whatever the caller passes; a prefix
 * query returns the keys that begin with it, which is what Workers KV's `list` does natively.
 */

interface KVNamespace {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: {
    prefix?: string;
    cursor?: string;
  }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

type Result<T> = [error: Error | undefined, value: T | undefined];

function namespace(): KVNamespace {
  const binding = kvBinding(useEvent().context.cloudflare);
  if (!binding) throw new Error('the KV binding is not configured on this Worker');
  return binding;
}

/** Narrows what Nitro leaves untyped on `event.context.cloudflare` to the KV binding. */
function kvBinding(cloudflare: unknown): KVNamespace | undefined {
  if (typeof cloudflare !== 'object' || cloudflare === null || !('env' in cloudflare)) {
    return undefined;
  }
  const { env } = cloudflare;
  if (typeof env !== 'object' || env === null || !('KV' in env)) return undefined;
  const { KV: binding } = env;
  return isKVNamespace(binding) ? binding : undefined;
}

function isKVNamespace(value: unknown): value is KVNamespace {
  return (
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    'put' in value &&
    'delete' in value &&
    'list' in value
  );
}

async function attempt<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return [undefined, await operation()];
  } catch (error) {
    return [error instanceof Error ? error : new Error(String(error)), undefined];
  }
}

export const kv = {
  get: (key: string): Promise<Result<unknown>> => attempt(() => namespace().get(key, 'json')),

  set: (key: string, value: unknown): Promise<Result<void>> =>
    attempt(() => namespace().put(key, JSON.stringify(value))),

  del: (key: string): Promise<Result<void>> => attempt(() => namespace().delete(key)),

  keys: (base = ''): Promise<Result<string[]>> =>
    attempt(async () => {
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await namespace().list({ prefix: base, ...(cursor ? { cursor } : {}) });
        names.push(...page.keys.map((key) => key.name));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return names;
    }),
};
