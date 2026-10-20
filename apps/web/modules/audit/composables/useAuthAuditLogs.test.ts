import type { DashAuditLog } from '@better-auth/infra/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Both dependencies are module imports rather than Nuxt auto-imports, so they are mocked at the
 * module boundary and these specs stay in the plain-Node `unit` project.
 */
const getAllAuditLogs = vi.fn<(input: { limit: number; offset: number }) => Promise<unknown>>();
let client: { dash: { getAllAuditLogs: typeof getAllAuditLogs } } | null = null;
let enableInfra = true;

vi.mock('@onmax/nuxt-better-auth/composables', () => ({ useAuthClient: () => client }));
vi.mock('nuxt/app', () => ({ useAppConfig: () => ({ auth: { enableInfra } }) }));

const { useAuthAuditLogs } = await import('./useAuthAuditLogs.js');

function hosted(overrides: Partial<DashAuditLog> = {}): DashAuditLog {
  return {
    eventType: 'user.sign_in',
    eventData: { email: 'sam@example.com' },
    eventKey: 'evt_1',
    projectId: 'proj_1',
    createdAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-09T10:00:00.000Z',
    ...overrides,
  };
}

function answers(events: DashAuditLog[], total = events.length) {
  return { data: { events, total, limit: 25, offset: 0 }, error: null };
}

beforeEach(() => {
  getAllAuditLogs.mockReset();
  client = { dash: { getAllAuditLogs } };
  enableInfra = true;
});

describe('useAuthAuditLogs', () => {
  it('maps a hosted record onto the page’s row shape', async () => {
    getAllAuditLogs.mockResolvedValue(
      answers([hosted({ location: { country: 'IT', city: 'Milan', ipAddress: '198.51.100.7' } })]),
    );
    const log = useAuthAuditLogs();

    await log.refresh();

    expect(log.rows.value).toEqual([
      {
        id: 'auth:2026-08-09T10:00:00.000Z:evt_1:0',
        occurredAt: '2026-08-09T10:00:00.000Z',
        source: 'authentication',
        actorName: 'sam@example.com',
        actorKind: 'user',
        action: 'user.sign_in',
        subject: '',
        details: 'IT · Milan · 198.51.100.7',
      },
    ]);
  });

  it('invents no outcome, because the hosted record carries none', async () => {
    getAllAuditLogs.mockResolvedValue(answers([hosted()]));
    const log = useAuthAuditLogs();

    await log.refresh();

    expect(log.rows.value[0]).not.toHaveProperty('outcome');
  });

  it('reads only strings out of the open event payload', async () => {
    // `eventData` is filled by a service this app does not control; a nested value rendered
    // through `String()` would put `[object Object]` in an audit trail.
    getAllAuditLogs.mockResolvedValue(
      answers([hosted({ eventData: { email: { nested: true }, userId: 'usr_9' } })]),
    );
    const log = useAuthAuditLogs();

    await log.refresh();

    expect(log.rows.value[0]?.actorName).toBe('usr_9');
  });

  it('names the organization a record scopes to, when it names one', async () => {
    getAllAuditLogs.mockResolvedValue(
      answers([hosted({ eventData: { email: 'sam@example.com', organizationId: 'org_2' } })]),
    );
    const log = useAuthAuditLogs();

    await log.refresh();

    expect(log.rows.value[0]?.subject).toBe('organization:org_2');
  });

  it('appends the next offset rather than replacing what was read', async () => {
    getAllAuditLogs
      .mockResolvedValueOnce(answers([hosted({ eventKey: 'evt_1' })], 2))
      .mockResolvedValueOnce(answers([hosted({ eventKey: 'evt_2' })], 2));
    const log = useAuthAuditLogs();

    await log.refresh();
    expect(log.hasMore()).toBe(true);

    await log.loadMore();

    expect(log.rows.value).toHaveLength(2);
    expect(getAllAuditLogs).toHaveBeenLastCalledWith({ limit: 25, offset: 1 });
    expect(log.hasMore()).toBe(false);
  });

  it('tells a refusal apart from a broken service', async () => {
    getAllAuditLogs.mockResolvedValue({
      data: null,
      error: { status: 403, statusText: 'Forbidden' },
    });
    const log = useAuthAuditLogs();

    await log.refresh();

    // App-level admin is not the same grant as owning the organizations this endpoint scopes to.
    expect(log.error.value).toBe('forbidden');
    expect(log.rows.value).toEqual([]);
  });

  it('asks for nothing where the deployment never configured the hosted trail', async () => {
    enableInfra = false;
    const log = useAuthAuditLogs();

    await log.refresh();

    expect(getAllAuditLogs).not.toHaveBeenCalled();
    // Not an error: it is a feature nobody turned on.
    expect(log.error.value).toBeNull();
    expect(log.enabled).toBe(false);
  });

  it('waits rather than failing while the client is still null', async () => {
    client = null;
    const log = useAuthAuditLogs();

    await log.refresh();

    expect(log.error.value).toBeNull();
    expect(log.rows.value).toEqual([]);
  });
});
