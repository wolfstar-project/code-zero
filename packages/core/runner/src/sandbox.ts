import { randomUUID } from 'node:crypto';

import type { NetworkPolicy, RunMode } from '@code-zero/shared';

import type { Runner } from './boundary.js';

/** Public, credential-free request passed to every hosted sandbox adapter. */
export interface SandboxRequest {
  taskId: string;
  repository: string;
  mode: RunMode;
  writable: boolean;
  network: NetworkPolicy;
  leaseMs: number;
}

/** A provisioned execution boundary. Provider credentials stay captured by the adapter instance. */
export interface ProvisionedSandbox {
  externalId: string;
  runner: Runner;
}

/** Provider-neutral hosted sandbox lifecycle, implemented inside the runner package only. */
export interface SandboxProvider {
  readonly kind: 'vitehub' | 'cloudflare' | 'vercel' | 'custom';
  provision(request: Readonly<SandboxRequest>): Promise<ProvisionedSandbox>;
  stop(externalId: string): Promise<void>;
}

export interface SandboxLease {
  id: string;
  taskId: string;
  repository: string;
  provider: SandboxProvider['kind'];
  externalId: string;
  acquiredAt: string;
  expiresAt: string;
  runner: Runner;
}

export interface RunnerPoolOptions {
  maxActive: number;
  maxActivePerRepository: number;
  maxLeaseMs: number;
  /** Delay before retrying an automatic expiry stop that failed. Defaults to 30 seconds. */
  expiryRetryMs?: number;
  now?: () => number;
}

export interface RunnerPoolSnapshot {
  active: number;
  capacity: number;
  expiring: number;
  leases: Array<Omit<SandboxLease, 'runner'>>;
}

/** Raised before provisioning when a pool quota would be exceeded. */
export class RunnerPoolQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerPoolQuotaError';
  }
}

/**
 * Owns hosted runner leases and their bounded lifecycle.
 *
 * This class deliberately returns the regular `Runner` contract. The agent cannot observe or call
 * a vendor SDK, and the control plane cannot execute a command through a second path.
 */
export class RunnerPool {
  private readonly leases = new Map<string, SandboxLease>();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingTotal = 0;
  private readonly pendingByRepository = new Map<string, number>();
  private readonly now: () => number;
  private readonly expiryRetryMs: number;
  private disposed = false;

  constructor(
    private readonly provider: SandboxProvider,
    private readonly options: RunnerPoolOptions,
  ) {
    assertPositiveInteger(options.maxActive, 'maxActive');
    assertPositiveInteger(options.maxActivePerRepository, 'maxActivePerRepository');
    assertPositiveInteger(options.maxLeaseMs, 'maxLeaseMs');
    if (options.expiryRetryMs !== undefined)
      assertPositiveInteger(options.expiryRetryMs, 'expiryRetryMs');
    this.expiryRetryMs = options.expiryRetryMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  async acquire(request: SandboxRequest): Promise<SandboxLease> {
    if (this.disposed) throw new RunnerPoolQuotaError('Runner pool has been disposed');
    if (!Number.isFinite(request.leaseMs) || request.leaseMs <= 0)
      throw new RunnerPoolQuotaError('Requested lease duration must be a positive number');
    if (request.leaseMs > this.options.maxLeaseMs)
      throw new RunnerPoolQuotaError('Requested lease exceeds the configured maximum');
    if (this.leases.size + this.pendingTotal >= this.options.maxActive)
      throw new RunnerPoolQuotaError('Runner pool capacity is exhausted');
    const repositoryActive =
      [...this.leases.values()].filter((lease) => lease.repository === request.repository).length +
      (this.pendingByRepository.get(request.repository) ?? 0);
    if (repositoryActive >= this.options.maxActivePerRepository)
      throw new RunnerPoolQuotaError('Repository runner quota is exhausted');

    // Reserve capacity before awaiting provisioning so overlapping acquires cannot bypass quotas.
    this.pendingTotal += 1;
    this.pendingByRepository.set(
      request.repository,
      (this.pendingByRepository.get(request.repository) ?? 0) + 1,
    );
    try {
      const provisioned = await this.provider.provision(Object.freeze({ ...request }));
      // Start the lease clock only after provisioning succeeds so slow provisioning cannot
      // consume the usable lease interval and hand back an already-expired lease.
      const started = this.now();
      const lease: SandboxLease = {
        id: `lease_${randomUUID()}`,
        taskId: request.taskId,
        repository: request.repository,
        provider: this.provider.kind,
        externalId: provisioned.externalId,
        acquiredAt: new Date(started).toISOString(),
        expiresAt: new Date(started + request.leaseMs).toISOString(),
        runner: provisioned.runner,
      };
      this.leases.set(lease.id, lease);
      if (this.disposed) {
        // The pool was disposed while provisioning; the runner must stop instead of escaping
        // shutdown. A failed stop keeps the lease tracked, arms the internal stop retry, and
        // surfaces the failure so the caller knows a live sandbox remains.
        let stopFailure: { error: unknown } | undefined;
        try {
          await this.release(lease.id);
        } catch (error) {
          stopFailure = { error };
        }
        if (stopFailure) {
          this.scheduleStopRetry(lease.id);
          throw new AggregateError(
            [stopFailure.error],
            'Runner pool was disposed during provisioning and stopping the runner failed; the pool retries the stop and dispose() can also retry',
            { cause: stopFailure.error },
          );
        }
        throw new RunnerPoolQuotaError('Runner pool was disposed during provisioning');
      }
      // The pool owns expiry enforcement: a runner must stop at its lease deadline even when no
      // external caller ever sweeps.
      this.scheduleExpiry(lease.id, request.leaseMs);
      return lease;
    } finally {
      this.pendingTotal -= 1;
      const remaining = (this.pendingByRepository.get(request.repository) ?? 1) - 1;
      if (remaining > 0) this.pendingByRepository.set(request.repository, remaining);
      else this.pendingByRepository.delete(request.repository);
    }
  }

  async release(id: string): Promise<boolean> {
    const lease = this.leases.get(id);
    if (!lease) return false;
    // Keep the lease tracked until the provider stop succeeds so a failed stop can be retried,
    // while sharing one in-flight stop between concurrent release and sweep calls.
    let stop = this.stopping.get(id);
    if (!stop) {
      stop = this.provider.stop(lease.externalId);
      this.stopping.set(id, stop);
    }
    try {
      await stop;
    } finally {
      this.stopping.delete(id);
    }
    this.leases.delete(id);
    this.clearExpiry(id);
    return true;
  }

  /**
   * Clears every expiry timer and stops all remaining leases. The pool rejects new acquires
   * afterwards. When a provider stop fails, the lease stays tracked, an internal stop retry is
   * armed, and this method throws an `AggregateError`; calling `dispose()` again also retries
   * the remaining stops.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const id of this.expiryTimers.keys()) this.clearExpiry(id);
    const failures: unknown[] = [];
    await Promise.all(
      Array.from(this.leases.keys(), async (id) => {
        try {
          await this.release(id);
        } catch (error) {
          // Keep an automatic cleanup path alive even when the caller never retries dispose().
          this.scheduleStopRetry(id);
          failures.push(error);
        }
      }),
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Runner pool disposal failed to stop every lease; call dispose() again to retry',
      );
  }

  /** Manual backstop for the pool-owned expiry timers, e.g. after a process restart. */
  async sweepExpired(): Promise<number> {
    const expired = [...this.leases.values()].filter(
      (lease) => Date.parse(lease.expiresAt) <= this.now(),
    );
    const results = await Promise.allSettled(expired.map((lease) => this.release(lease.id)));
    return results.filter((result) => result.status === 'fulfilled' && result.value).length;
  }

  snapshot(): RunnerPoolSnapshot {
    const expiringBefore = this.now() + Math.min(15 * 60_000, this.options.maxLeaseMs);
    return {
      active: this.leases.size,
      capacity: this.options.maxActive,
      expiring: [...this.leases.values()].filter(
        (lease) => Date.parse(lease.expiresAt) <= expiringBefore,
      ).length,
      leases: Array.from(this.leases.values(), (lease) => ({
        id: lease.id,
        taskId: lease.taskId,
        repository: lease.repository,
        provider: lease.provider,
        externalId: lease.externalId,
        acquiredAt: lease.acquiredAt,
        expiresAt: lease.expiresAt,
      })),
    };
  }

  private scheduleExpiry(id: string, delayMs: number): void {
    this.clearExpiry(id);
    const timer = setTimeout(() => {
      this.expiryTimers.delete(id);
      this.release(id).catch(() => {
        // The provider stop failed; the lease stays tracked, so retry on a bounded interval.
        this.scheduleStopRetry(id);
      });
    }, delayMs);
    // The timer stays referenced on purpose: lease state is process-local, so letting the process
    // exit before the deadline would leave the remote sandbox running with no cleanup path.
    // Callers that want to exit early must release the lease or dispose the pool.
    this.expiryTimers.set(id, timer);
  }

  /**
   * Retries a failed provider stop on a bounded interval. This deliberately keeps running after
   * the pool is disposed: a tracked lease still owns a live remote sandbox, so the retry loop is
   * the only automatic cleanup path left once no expiry timer or dispose() call is pending.
   */
  private scheduleStopRetry(id: string): void {
    if (!this.leases.has(id)) return;
    this.scheduleExpiry(id, this.expiryRetryMs);
  }

  private clearExpiry(id: string): void {
    const timer = this.expiryTimers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.expiryTimers.delete(id);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}
