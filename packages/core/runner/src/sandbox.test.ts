import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Runner } from './boundary.js';
import { RunnerPool, RunnerPoolQuotaError, type SandboxProvider } from './sandbox.js';

const runner: Runner = {
  describe: () => ({ kind: 'container', isolated: true, writable: false, network: 'none' }),
  context: async () => '',
  reviewFiles: async () => [],
  read: async () => '',
  readBytes: async () => new Uint8Array(),
  exists: async () => false,
  write: async () => undefined,
  check: async (command) => ({
    command,
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 0,
  }),
  changedFiles: async () => [],
};

function provider(): SandboxProvider & { stopped: string[] } {
  return {
    kind: 'vitehub',
    stopped: [],
    async provision(request) {
      return { externalId: `remote-${request.taskId}`, runner };
    },
    async stop(id) {
      this.stopped.push(id);
    },
  };
}

describe('RunnerPool', () => {
  const request = {
    taskId: 'task-1',
    repository: 'acme/app',
    mode: 'observe' as const,
    writable: false,
    network: 'none' as const,
    leaseMs: 1_000,
  };

  it('returns only the Runner boundary and public lifecycle metadata', async () => {
    const adapter = provider();
    const pool = new RunnerPool(adapter, {
      maxActive: 2,
      maxActivePerRepository: 1,
      maxLeaseMs: 2_000,
      now: () => 10_000,
    });
    const lease = await pool.acquire(request);
    expect(lease.runner).toBe(runner);
    expect(pool.snapshot().leases[0]).not.toHaveProperty('runner');
    expect(pool.snapshot()).toMatchObject({ active: 1, capacity: 2 });
  });

  it('enforces pool, repository, and lease quotas before provisioning', async () => {
    const pool = new RunnerPool(provider(), {
      maxActive: 2,
      maxActivePerRepository: 1,
      maxLeaseMs: 1_000,
    });
    await pool.acquire(request);
    await expect(pool.acquire({ ...request, taskId: 'task-2' })).rejects.toBeInstanceOf(
      RunnerPoolQuotaError,
    );
    await expect(
      pool.acquire({ ...request, taskId: 'task-3', repository: 'acme/other', leaseMs: 2_000 }),
    ).rejects.toThrow('exceeds');
  });

  it('rejects non-finite and non-positive lease durations before provisioning', async () => {
    let provisioned = 0;
    const adapter = provider();
    const original = adapter.provision.bind(adapter);
    adapter.provision = async (sandboxRequest) => {
      provisioned += 1;
      return original(sandboxRequest);
    };
    const pool = new RunnerPool(adapter, {
      maxActive: 1,
      maxActivePerRepository: 1,
      maxLeaseMs: 1_000,
    });
    for (const leaseMs of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      await expect(pool.acquire({ ...request, leaseMs })).rejects.toBeInstanceOf(
        RunnerPoolQuotaError,
      );
    }
    expect(provisioned).toBe(0);
    expect(pool.snapshot().active).toBe(0);
  });

  it('reserves capacity before provisioning so overlapping acquires cannot bypass quotas', async () => {
    let releaseProvision!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseProvision = resolve;
    });
    const adapter = provider();
    adapter.provision = async (sandboxRequest) => {
      await gate;
      return { externalId: `remote-${sandboxRequest.taskId}`, runner };
    };
    const pool = new RunnerPool(adapter, {
      maxActive: 1,
      maxActivePerRepository: 1,
      maxLeaseMs: 1_000,
    });
    const first = pool.acquire(request);
    const second = pool.acquire({ ...request, taskId: 'task-2' });
    await expect(second).rejects.toBeInstanceOf(RunnerPoolQuotaError);
    releaseProvision();
    await expect(first).resolves.toMatchObject({ taskId: 'task-1' });
    expect(pool.snapshot().active).toBe(1);
  });

  it('starts the lease clock after provisioning so slow provisioning cannot expire the lease', async () => {
    let current = 1_000;
    const adapter = provider();
    adapter.provision = async (sandboxRequest) => {
      // Simulate provisioning that consumes more than the requested lease interval.
      current += 2_000;
      return { externalId: `remote-${sandboxRequest.taskId}`, runner };
    };
    const pool = new RunnerPool(adapter, {
      maxActive: 1,
      maxActivePerRepository: 1,
      maxLeaseMs: 1_000,
      now: () => current,
    });
    const lease = await pool.acquire(request);
    expect(Date.parse(lease.acquiredAt)).toBe(3_000);
    expect(Date.parse(lease.expiresAt)).toBe(4_000);
    await expect(pool.sweepExpired()).resolves.toBe(0);
    expect(adapter.stopped).toEqual([]);
    expect(pool.snapshot().active).toBe(1);
  });

  it('releases reserved capacity when provisioning fails', async () => {
    const adapter = provider();
    adapter.provision = async () => {
      throw new Error('provision failed');
    };
    const pool = new RunnerPool(adapter, {
      maxActive: 1,
      maxActivePerRepository: 1,
      maxLeaseMs: 1_000,
    });
    await expect(pool.acquire(request)).rejects.toThrow('provision failed');
    adapter.provision = async (sandboxRequest) => ({
      externalId: `remote-${sandboxRequest.taskId}`,
      runner,
    });
    await expect(pool.acquire({ ...request, taskId: 'task-2' })).resolves.toMatchObject({
      taskId: 'task-2',
    });
  });

  it('keeps leases retryable when the provider stop fails', async () => {
    let current = 1_000;
    let failStops = true;
    const adapter = provider();
    adapter.stop = async (id) => {
      if (failStops) throw new Error('stop failed');
      adapter.stopped.push(id);
    };
    const pool = new RunnerPool(adapter, {
      maxActive: 1,
      maxActivePerRepository: 1,
      maxLeaseMs: 1_000,
      now: () => current,
    });
    const lease = await pool.acquire(request);
    await expect(pool.release(lease.id)).rejects.toThrow('stop failed');
    expect(pool.snapshot().active).toBe(1);
    current = 3_000;
    await expect(pool.sweepExpired()).resolves.toBe(0);
    expect(pool.snapshot().active).toBe(1);
    failStops = false;
    await expect(pool.release(lease.id)).resolves.toBe(true);
    expect(adapter.stopped).toEqual(['remote-task-1']);
    expect(pool.snapshot().active).toBe(0);
  });

  describe('automatic expiry enforcement', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('stops a runner at its lease deadline without an external sweep', async () => {
      vi.useFakeTimers();
      const adapter = provider();
      const pool = new RunnerPool(adapter, {
        maxActive: 1,
        maxActivePerRepository: 1,
        maxLeaseMs: 1_000,
      });
      await pool.acquire(request);
      expect(pool.snapshot().active).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(adapter.stopped).toEqual(['remote-task-1']);
      expect(pool.snapshot().active).toBe(0);
    });

    it('retries an automatic expiry stop that failed', async () => {
      vi.useFakeTimers();
      let failStops = true;
      const adapter = provider();
      adapter.stop = async (id) => {
        if (failStops) throw new Error('stop failed');
        adapter.stopped.push(id);
      };
      const pool = new RunnerPool(adapter, {
        maxActive: 1,
        maxActivePerRepository: 1,
        maxLeaseMs: 1_000,
        expiryRetryMs: 500,
      });
      await pool.acquire(request);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(pool.snapshot().active).toBe(1);
      failStops = false;
      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.stopped).toEqual(['remote-task-1']);
      expect(pool.snapshot().active).toBe(0);
    });

    it('does not fire an expiry timer for a lease released early', async () => {
      vi.useFakeTimers();
      const adapter = provider();
      const pool = new RunnerPool(adapter, {
        maxActive: 1,
        maxActivePerRepository: 1,
        maxLeaseMs: 1_000,
      });
      const lease = await pool.acquire(request);
      await expect(pool.release(lease.id)).resolves.toBe(true);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(adapter.stopped).toEqual(['remote-task-1']);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('dispose surfaces failed stops and a retried dispose stops the lease', async () => {
      vi.useFakeTimers();
      let failStops = true;
      const adapter = provider();
      adapter.stop = async (id) => {
        if (failStops) throw new Error('stop failed');
        adapter.stopped.push(id);
      };
      const pool = new RunnerPool(adapter, {
        maxActive: 1,
        maxActivePerRepository: 1,
        maxLeaseMs: 1_000,
      });
      await pool.acquire(request);
      await expect(pool.dispose()).rejects.toBeInstanceOf(AggregateError);
      expect(pool.snapshot().active).toBe(1);
      failStops = false;
      await expect(pool.dispose()).resolves.toBeUndefined();
      expect(adapter.stopped).toEqual(['remote-task-1']);
      expect(pool.snapshot().active).toBe(0);
    });

    it('stops a runner whose provisioning resolves after dispose', async () => {
      let releaseProvision!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseProvision = resolve;
      });
      const adapter = provider();
      adapter.provision = async (sandboxRequest) => {
        await gate;
        return { externalId: `remote-${sandboxRequest.taskId}`, runner };
      };
      const pool = new RunnerPool(adapter, {
        maxActive: 1,
        maxActivePerRepository: 1,
        maxLeaseMs: 1_000,
      });
      const pending = pool.acquire(request);
      await pool.dispose();
      releaseProvision();
      await expect(pending).rejects.toBeInstanceOf(RunnerPoolQuotaError);
      expect(adapter.stopped).toEqual(['remote-task-1']);
      expect(pool.snapshot().active).toBe(0);
    });

    it('surfaces a failed stop after disposal during provisioning and retries it internally', async () => {
      vi.useFakeTimers();
      let releaseProvision!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseProvision = resolve;
      });
      let failStops = true;
      const adapter = provider();
      adapter.provision = async (sandboxRequest) => {
        await gate;
        return { externalId: `remote-${sandboxRequest.taskId}`, runner };
      };
      adapter.stop = async (id) => {
        if (failStops) throw new Error('stop failed');
        adapter.stopped.push(id);
      };
      const pool = new RunnerPool(adapter, {
        maxActive: 1,
        maxActivePerRepository: 1,
        maxLeaseMs: 1_000,
        expiryRetryMs: 500,
      });
      const pending = pool.acquire(request);
      await pool.dispose();
      releaseProvision();
      // The cleanup failure is surfaced instead of being swallowed behind a quota error.
      await expect(pending).rejects.toBeInstanceOf(AggregateError);
      expect(pool.snapshot().active).toBe(1);
      // The retry loop keeps running after disposal, across repeated failures.
      await vi.advanceTimersByTimeAsync(500);
      expect(pool.snapshot().active).toBe(1);
      failStops = false;
      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.stopped).toEqual(['remote-task-1']);
      expect(pool.snapshot().active).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('re-arms the internal stop retry when dispose fails to stop a lease', async () => {
      vi.useFakeTimers();
      let failStops = true;
      const adapter = provider();
      adapter.stop = async (id) => {
        if (failStops) throw new Error('stop failed');
        adapter.stopped.push(id);
      };
      const pool = new RunnerPool(adapter, {
        maxActive: 1,
        maxActivePerRepository: 1,
        maxLeaseMs: 1_000,
        expiryRetryMs: 500,
      });
      await pool.acquire(request);
      await expect(pool.dispose()).rejects.toBeInstanceOf(AggregateError);
      expect(pool.snapshot().active).toBe(1);
      failStops = false;
      // No second dispose() call: the pool's own retry timer stops the leaked runner.
      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.stopped).toEqual(['remote-task-1']);
      expect(pool.snapshot().active).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('dispose clears timers, stops remaining leases, and rejects new acquires', async () => {
      vi.useFakeTimers();
      const adapter = provider();
      const pool = new RunnerPool(adapter, {
        maxActive: 1,
        maxActivePerRepository: 1,
        maxLeaseMs: 1_000,
      });
      await pool.acquire(request);
      await pool.dispose();
      expect(adapter.stopped).toEqual(['remote-task-1']);
      expect(pool.snapshot().active).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await expect(pool.acquire({ ...request, taskId: 'task-2' })).rejects.toBeInstanceOf(
        RunnerPoolQuotaError,
      );
    });
  });

  it('stops expired sandboxes deterministically', async () => {
    let current = 1_000;
    const adapter = provider();
    const pool = new RunnerPool(adapter, {
      maxActive: 1,
      maxActivePerRepository: 1,
      maxLeaseMs: 1_000,
      now: () => current,
    });
    await pool.acquire(request);
    current = 2_000;
    await expect(pool.sweepExpired()).resolves.toBe(1);
    expect(adapter.stopped).toEqual(['remote-task-1']);
    expect(pool.snapshot().active).toBe(0);
  });
});
