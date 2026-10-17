// Imported explicitly rather than relying on Nuxt auto-imports, so the dependency stays visible at
// the call site; `nuxt typecheck` resolves either form.
import type { DashAuditLog } from '@better-auth/infra/client';
import { useAuthClient } from '@onmax/nuxt-better-auth/composables';
import { useAppConfig } from 'nuxt/app';
import { ref } from 'vue';

import type { AuditRow } from '../types/audit.js';
import type { AuditLogError } from './useAuditLogs.js';

/** One request's worth of hosted records; the service pages by offset rather than by cursor. */
const PAGE_SIZE = 25;

/**
 * The authentication trail, read from Better Auth's hosted infrastructure.
 *
 * `getAllAuditLogs` rather than `getAuditLogs`: this page is for an operator auditing the
 * deployment, not for a reader looking up their own sign-ins, and the per-user endpoint would
 * quietly answer a different question than the page asks.
 *
 * Only meaningful where the deployment configured that infrastructure. Without credentials the
 * server never registers `dash()`, so the endpoint does not exist and every call would fail; the
 * page therefore asks `enabled` first and simply never shows an authentication row otherwise,
 * rather than surfacing an error for a feature nobody turned on.
 */
export function useAuthAuditLogs() {
  const client = useAuthClient();
  // Narrowed at the read rather than relying on the generated `AppConfig` type: the package's
  // plain `tsc` pass sees `useAppConfig()` as `{}`, so an unguarded property access does not
  // compile there even though `nuxt typecheck` resolves it.
  const appConfig = useAppConfig() as { auth?: { enableInfra?: boolean } };

  /**
   * Published by `nuxt.config.ts` from the same `BETTER_AUTH_*` credentials that decide whether
   * the server registers the plugin, so the two halves cannot drift.
   */
  const enabled = Boolean(appConfig.auth?.enableInfra);

  const rows = ref<AuditRow[]>([]);
  const pending = ref(false);
  const error = ref<AuditLogError | null>(null);
  /** Total the service reports, so the page knows whether another request would return anything. */
  const total = ref(0);

  const hasMore = () => enabled && rows.value.length < total.value;

  async function load(offset = 0): Promise<void> {
    // Null before hydration in client-only mode: an ordinary "nothing to do yet", not an error.
    if (!enabled || !client) return;

    pending.value = true;
    error.value = null;
    try {
      const { data, error: apiError } = await client.dash.getAllAuditLogs({
        limit: PAGE_SIZE,
        offset,
      });

      if (apiError) {
        // 403 is the expected refusal here and reads differently from a broken service: app-level
        // admin is not the same grant as owning the organizations this endpoint scopes to.
        error.value = apiError.status === 403 ? 'forbidden' : 'generic';
        return;
      }

      const page = data?.events ?? [];
      rows.value = offset === 0 ? page.map(toRow) : [...rows.value, ...page.map(toRow)];
      total.value = data?.total ?? rows.value.length;
    } catch {
      // The client rejects only on transport failures; an API refusal arrives as `error` above.
      error.value = 'generic';
    } finally {
      pending.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (hasMore()) await load(rows.value.length);
  }

  return { enabled, rows, pending, error, hasMore, load, loadMore, refresh: () => load() };
}

/**
 * Maps one hosted record onto the page's row shape.
 *
 * `eventData` is an open `Record<string, unknown>` filled by a service this app does not control,
 * so every field is read defensively and only strings are taken: a nested object rendered through
 * `String()` would put `[object Object]` in an audit trail.
 */
function toRow(event: DashAuditLog, index: number): AuditRow {
  return {
    // `eventKey` alone is not documented as unique, so the timestamp and the position within the
    // page join it. Identity here only has to be stable for rendering, not durable.
    id: `auth:${event.createdAt}:${event.eventKey}:${index}`,
    occurredAt: event.createdAt,
    source: 'authentication',
    actorName: actorNameOf(event),
    actorKind: 'user',
    action: event.eventType,
    subject: text(event.eventData.organizationId, (id) => `organization:${id}`),
    // No outcome: the hosted record carries none. See `AuditRow` for why one is not invented.
    details: detailsOf(event),
  };
}

function actorNameOf(event: DashAuditLog): string {
  return (
    text(event.eventData.email) ||
    text(event.eventData.userId) ||
    text(event.eventData.identifier) ||
    '—'
  );
}

/** Where the request came from, which is the point of keeping an authentication trail at all. */
function detailsOf(event: DashAuditLog): string {
  return [
    text(event.location?.country),
    text(event.location?.city),
    text(event.location?.ipAddress),
  ]
    .filter((part) => part.length > 0)
    .join(' · ');
}

function text(value: unknown, format: (found: string) => string = (found) => found): string {
  return typeof value === 'string' && value.length > 0 ? format(value) : '';
}
