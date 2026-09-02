import type { TaskResult } from '@code-zero/shared';
import { describe, expect, it } from 'vitest';

import type { StoredTask } from './control-plane.js';
import { dashboardOverview } from './dashboard.js';

const TIMESTAMP = '2026-08-09T10:00:00.000Z';

function task(id: string, overrides: Partial<StoredTask> = {}): StoredTask {
  return {
    id,
    repository: 'acme/app',
    status: 'queued',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    events: [],
    ...overrides,
  };
}

function finished(totalTokens: number, costUsd: number): TaskResult {
  return {
    id: 'cz_run',
    state: 'completed',
    verdict: 'accepted',
    verified: true,
    finding: null,
    plan: [],
    acceptanceCriteria: [],
    checks: [],
    changedFiles: [],
    attempts: 1,
    events: [],
    usage: {
      modelCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens,
      latencyMs: 0,
      costUsd,
      models: {},
    },
    runner: { kind: 'local', isolated: false, writable: false, network: 'none' },
    summary: 'done',
  };
}

describe('dashboardOverview', () => {
  it('reports an empty control plane without inventing counters', () => {
    expect(dashboardOverview([])).toEqual({
      tasks: [],
      active: 0,
      queued: 0,
      awaitingApproval: 0,
      totalTokens: 0,
      costUsd: 0,
    });
  });

  it('counts queued and running work separately', () => {
    const overview = dashboardOverview([
      task('cz_1'),
      task('cz_2', { status: 'running' }),
      task('cz_3', { status: 'completed' }),
    ]);
    expect(overview).toMatchObject({ queued: 1, active: 1 });
  });

  it('counts only undecided human reviews as awaiting approval', () => {
    const decided = task('cz_2', {
      status: 'needs-human',
      approval: {
        decision: 'approved',
        actor: 'operator',
        comment: null,
        decidedAt: TIMESTAMP,
      },
    });
    const overview = dashboardOverview([task('cz_1', { status: 'needs-human' }), decided]);
    expect(overview.awaitingApproval).toBe(1);
  });

  it('totals usage across finished runs and ignores runs that never reported any', () => {
    const overview = dashboardOverview([
      task('cz_1', { status: 'completed', result: finished(100, 0.25) }),
      task('cz_2', { status: 'completed', result: finished(50, 0.5) }),
      task('cz_3'),
    ]);
    expect(overview).toMatchObject({ totalTokens: 150, costUsd: 0.75 });
  });
});
