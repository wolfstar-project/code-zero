import { createHash, randomUUID } from 'node:crypto';

import {
  now,
  redactSecrets,
  secretValuesFromEnvironment,
  type EvidenceBundle,
} from '@code-zero/shared';

import type { DashboardTask } from './types.js';

export type { ApprovalDecision, ControlPlaneTaskStatus, TaskApproval } from './types.js';

/**
 * One changed file's verified content, or null when the change deleted the file.
 *
 * The content is base64 of the file's exact bytes, not decoded text: a snapshot passes through
 * JSON persistence and back into Git blob creation, and a string decode would silently replace
 * invalid UTF-8 sequences, publishing different bytes than the run verified.
 */
export interface ChangedFileSnapshot {
  path: string;
  contentBase64: string | null;
}

/** Durable, deliberately narrow task history. Review input and checkout paths are never stored. */
export interface StoredTask extends DashboardTask {
  evidence?: EvidenceBundle;
  /**
   * Immutable contents of the run's changed files, captured through the run's own boundary the
   * moment it finished. Publication reads from this snapshot, never from the live checkout, so a
   * mutation after verification cannot ride along under the run's evidence.
   */
  changedFileSnapshot?: ChangedFileSnapshot[];
}

export interface TaskStore {
  get(id: string): Promise<StoredTask | undefined>;
  list(): Promise<StoredTask[]>;
  save(task: StoredTask): Promise<void>;
  clear?(): Promise<void>;
}

/** Minimal surface shared by Nitro storage, Redis/KV drivers, and deterministic test stores. */
export interface KeyValueStorage {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  getKeys(base?: string): Promise<string[]>;
  removeItem?(key: string): Promise<void>;
  /**
   * Write the record only when the key is absent, atomically when the driver can promise it.
   * Returns whether this caller created the record. Drivers without a conditional-write
   * primitive omit this method and callers fall back to a read-then-write claim.
   */
  setItemIfAbsent?(key: string, value: unknown): Promise<boolean>;
}

const TASK_PREFIX = 'tasks:';

/** Persists redacted records through Nitro's provider-neutral storage layer. */
export class PersistentTaskStore implements TaskStore {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly secrets: readonly string[] = secretValuesFromEnvironment(),
  ) {}

  async get(id: string): Promise<StoredTask | undefined> {
    const value = await this.storage.getItem(`${TASK_PREFIX}${id}`);
    return isStoredTask(value) ? value : undefined;
  }

  async list(): Promise<StoredTask[]> {
    const keys = await this.storage.getKeys(TASK_PREFIX);
    const records = await Promise.all(keys.map((key) => this.storage.getItem(key)));
    return records
      .filter(isStoredTask)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async save(task: StoredTask): Promise<void> {
    await this.storage.setItem(`${TASK_PREFIX}${task.id}`, sanitizeTask(task, this.secrets));
  }
}

/** The answer to one delivery-claim attempt: sole ownership, or what the earlier claim decided. */
export type DeliveryClaim =
  | { claimed: true }
  /** `outcome` is null while the earlier claim is still in flight or was lost mid-run. */
  | { claimed: false; outcome: unknown };

/**
 * Durable, atomically claimed webhook-delivery outcomes.
 *
 * A claim is taken before any work starts and survives process restarts, other instances, and
 * in-memory eviction, so a redelivered event observes the recorded outcome instead of starting
 * a duplicate run.
 */
export interface DeliveryClaimStore {
  /** Atomically claim a delivery key, or report the standing claim's recorded outcome. */
  claim(key: string): Promise<DeliveryClaim>;
  /** Record the delivery's final outcome under this caller's claim so redeliveries replay it. */
  complete(key: string, outcome: unknown): Promise<void>;
  /** Discard an unfinished claim so a redelivery may retry after a transport failure. */
  release(key: string): Promise<void>;
}

const DELIVERY_PREFIX = 'deliveries:';

interface DeliveryClaimRecord {
  claimedAt: string;
  outcome: unknown;
}

/**
 * Delivery claims persisted through the same provider-neutral storage layer as task records.
 *
 * The claim marker is written before the work it guards. Drivers that expose
 * {@link KeyValueStorage.setItemIfAbsent} make the claim an atomic conditional create across
 * instances. Drivers without one never get a bare write-then-read (which is last-writer-wins, so
 * a later writer would read back its own token and claim alongside the earlier winner): the claim
 * runs a splitter instead. Each contender first records itself in a contender register, then
 * treats an existing marker as a closed door, writes the marker, and owns the delivery only when
 * the register still holds its own token. Any interleaving that could have produced a second
 * owner is instead observed as a closed door or an overwritten register, so at most one contender
 * ever claims; under a pathological interleaving every contender may lose, which reports the
 * standing (unfinished) claim — the same safe refusal as a claim lost mid-run — rather than
 * starting duplicate work.
 */
export class PersistentDeliveryClaimStore implements DeliveryClaimStore {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly secrets: readonly string[] = secretValuesFromEnvironment(),
  ) {}

  async claim(key: string): Promise<DeliveryClaim> {
    const storageKey = deliveryStorageKey(key);
    const marker: DeliveryClaimRecord = { claimedAt: now(), outcome: null };
    if (this.storage.setItemIfAbsent) {
      if (await this.storage.setItemIfAbsent(storageKey, marker)) return { claimed: true };
      return { claimed: false, outcome: await this.recordedOutcome(storageKey) };
    }
    // Splitter arbitration for drivers without a conditional create. Order is load-bearing:
    // register first, then check the door, then close it, then read the register back. A winner's
    // read-back proves no other contender registered after it; any such contender must have
    // registered before the winner closed the door and would therefore have lost the read-back
    // itself, or registered after and seen the door closed. Two contenders can never both win.
    const token = randomUUID();
    const contenderKey = contenderStorageKey(storageKey);
    await this.storage.setItem(contenderKey, token);
    const existing = await this.storage.getItem(storageKey);
    if (isDeliveryClaimRecord(existing)) return { claimed: false, outcome: existing.outcome };
    await this.storage.setItem(storageKey, marker);
    const lastContender = await this.storage.getItem(contenderKey);
    if (lastContender === token) return { claimed: true };
    return { claimed: false, outcome: await this.recordedOutcome(storageKey) };
  }

  async complete(key: string, outcome: unknown): Promise<void> {
    const record: DeliveryClaimRecord = {
      claimedAt: now(),
      outcome: redactDeep(outcome, this.secrets),
    };
    await this.storage.setItem(deliveryStorageKey(key), record);
  }

  async release(key: string): Promise<void> {
    const storageKey = deliveryStorageKey(key);
    // The contender register goes first so a retry never reads a stale token as its own loss.
    await this.storage.removeItem?.(contenderStorageKey(storageKey));
    await this.storage.removeItem?.(storageKey);
  }

  private async recordedOutcome(storageKey: string): Promise<unknown> {
    const record = await this.storage.getItem(storageKey);
    return isDeliveryClaimRecord(record) ? record.outcome : null;
  }
}

/** Delivery keys embed caller-supplied identifiers; hashing keeps every byte storage-safe. */
function deliveryStorageKey(key: string): string {
  return `${DELIVERY_PREFIX}${createHash('sha256').update(key).digest('hex')}`;
}

/** The splitter's contender register for one delivery; the hex digest cannot collide with it. */
function contenderStorageKey(storageKey: string): string {
  return `${storageKey}:contender`;
}

function isDeliveryClaimRecord(value: unknown): value is DeliveryClaimRecord {
  return isRecord(value) && typeof value.claimedAt === 'string' && 'outcome' in value;
}

/** In-memory adapter used by embedded callers and tests; production Nitro routes use storage. */
export class MemoryTaskStore implements TaskStore {
  readonly records = new Map<string, StoredTask>();

  async get(id: string): Promise<StoredTask | undefined> {
    const value = this.records.get(id);
    return value ? structuredClone(value) : undefined;
  }

  async list(): Promise<StoredTask[]> {
    return Array.from(this.records.values(), (task) => structuredClone(task)).toSorted(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    );
  }

  async save(task: StoredTask): Promise<void> {
    this.records.set(task.id, sanitizeTask(task, secretValuesFromEnvironment()));
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

export interface SchedulerOptions {
  maxConcurrent: number;
  maxQueued: number;
  maxConcurrentPerRepository: number;
}

export interface SchedulerSnapshot {
  active: number;
  queued: number;
  capacity: number;
}

export class TaskQueueQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskQueueQuotaError';
  }
}

interface QueuedJob {
  repository: string;
  start: () => Promise<void>;
}

/** Bounded FIFO scheduler with a separate per-repository fairness quota. */
export class TaskScheduler {
  private active = 0;
  private readonly activeByRepository = new Map<string, number>();
  private readonly queue: QueuedJob[] = [];

  constructor(private readonly options: SchedulerOptions) {
    assertPositiveInteger(options.maxConcurrent, 'maxConcurrent');
    assertPositiveInteger(options.maxQueued, 'maxQueued');
    assertPositiveInteger(options.maxConcurrentPerRepository, 'maxConcurrentPerRepository');
  }

  schedule<T>(repository: string, run: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.options.maxQueued && !this.hasImmediateCapacity(repository))
      throw new TaskQueueQuotaError('Task queue capacity is exhausted');
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        repository,
        start: async () => {
          try {
            resolve(await run());
          } catch (error) {
            reject(error);
          }
        },
      });
      this.drain();
    });
  }

  snapshot(): SchedulerSnapshot {
    return {
      active: this.active,
      queued: this.queue.length,
      capacity: this.options.maxConcurrent,
    };
  }

  /**
   * Whether a new job for this repository would start synchronously in {@link drain}.
   *
   * Only jobs without immediate capacity occupy the queue, so `maxQueued` must bound exactly those:
   * a job blocked by its repository quota counts against the queue even while global capacity is
   * free, otherwise per-repository-blocked submissions could grow the queue without limit.
   */
  private hasImmediateCapacity(repository: string): boolean {
    return (
      this.active < this.options.maxConcurrent &&
      (this.activeByRepository.get(repository) ?? 0) < this.options.maxConcurrentPerRepository
    );
  }

  private drain(): void {
    while (this.active < this.options.maxConcurrent) {
      const index = this.queue.findIndex(
        (job) =>
          (this.activeByRepository.get(job.repository) ?? 0) <
          this.options.maxConcurrentPerRepository,
      );
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      if (!job) return;
      this.active += 1;
      this.activeByRepository.set(
        job.repository,
        (this.activeByRepository.get(job.repository) ?? 0) + 1,
      );
      void job.start().finally(() => {
        this.active -= 1;
        const repositoryActive = (this.activeByRepository.get(job.repository) ?? 1) - 1;
        if (repositoryActive === 0) this.activeByRepository.delete(job.repository);
        else this.activeByRepository.set(job.repository, repositoryActive);
        this.drain();
      });
    }
  }
}

function sanitizeTask(task: StoredTask, secrets: readonly string[]): StoredTask {
  const value = redactDeep(task, secrets);
  if (!isStoredTask(value)) throw new Error('Refusing to persist an invalid task record');
  return value;
}

/** Redact every string in a JSON-serialisable value before it is persisted. */
function redactDeep(value: unknown, secrets: readonly string[]): unknown {
  const serialized = JSON.stringify(value ?? null, (_key, entry: unknown) =>
    typeof entry === 'string' ? redactSecrets(entry, secrets) : entry,
  );
  return JSON.parse(serialized) as unknown;
}

function isStoredTask(value: unknown): value is StoredTask {
  if (!isRecord(value)) return false;
  const task = value;
  return (
    typeof task.id === 'string' &&
    typeof task.repository === 'string' &&
    typeof task.status === 'string' &&
    typeof task.createdAt === 'string' &&
    typeof task.updatedAt === 'string' &&
    Array.isArray(task.events)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}
