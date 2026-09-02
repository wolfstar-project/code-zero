import { createHash } from 'node:crypto';

import { CodeZero } from '@code-zero/agent';
import { loadConfig, mayModifyRepository } from '@code-zero/config';
import { isSubscriptionProviderEnabled, modelFromEnvironment } from '@code-zero/models';
import {
  createRunner,
  LocalRunner,
  runnerOptionsFromPolicy,
  type Runner,
  type RunnerPool,
} from '@code-zero/runner';
import {
  evidenceFromResult,
  now,
  redactSecrets,
  renderEvidenceMarkdown,
  secretValuesFromEnvironment,
  taskId,
  type IssueRef,
  type ReviewInput,
  type TaskResult,
} from '@code-zero/shared';
import {
  createProvider,
  GitHubIssueComments,
  GitHubPullRequests,
  issueBranchName,
  issueInputFromTask,
  parseIssueTask,
  prepareIssuePullRequest,
  prepareIssueValidationComment,
  providerForDelivery,
  readHeader,
  reviewInputFromEvent,
  type BranchFile,
  type ChangeRequestRef,
  type IssueTask,
  type ProviderKind,
  type WebhookHeaders,
} from '@code-zero/source-control';
import { z } from 'zod';

import {
  MemoryTaskStore,
  TaskScheduler,
  type ApprovalDecision,
  type ChangedFileSnapshot,
  type DeliveryClaimStore,
  type StoredTask,
  type TaskStore,
} from './control-plane.js';
import { claudeCodeProcessSpawner, claudeCodeRefusalReason } from './subscription-isolation.js';

const TRAILING_SLASH = /\/$/u;

const defaultStore = new MemoryTaskStore();
const defaultScheduler = new TaskScheduler({
  maxConcurrent: 4,
  maxQueued: 100,
  maxConcurrentPerRepository: 1,
});

/** Backwards-compatible inspection hook for embedded callers and tests. */
export const tasks = defaultStore.records;

export const taskInput = z
  .object({
    repository: z.string().min(1),
    feedback: z.string().min(1).optional(),
    trigger: z.enum(['feedback', 'proactive']).default('feedback'),
    mode: z.enum(['observe', 'suggest', 'fix', 'autonomous']),
    source: z.string().optional(),
    files: z.array(z.string()).optional(),
  })
  .superRefine((input, context) => {
    if (input.trigger !== 'proactive' && input.feedback === undefined)
      context.addIssue({ code: 'custom', path: ['feedback'], message: 'Feedback is required' });
  });

/** The actor is never accepted from the wire; the transport derives it from the authenticated principal. */
export const approvalInput = z.object({
  taskId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(2_000).optional(),
});

export function health() {
  return { status: 'ok' as const, service: 'code-zero', version: '0.4.0' };
}

export async function listTasks(store: TaskStore = defaultStore) {
  return { tasks: await store.list() };
}

export async function getStoredTask(
  id: string,
  store: TaskStore = defaultStore,
): Promise<StoredTask | undefined> {
  return store.get(id);
}

export async function getTask(
  id: string,
  store: TaskStore = defaultStore,
): Promise<TaskResult | undefined> {
  return (await store.get(id))?.result;
}

/** The rendered evidence report for a finished run. */
export async function getTaskEvidence(
  id: string,
  store: TaskStore = defaultStore,
): Promise<string | undefined> {
  const task = await store.get(id);
  return task?.evidence ? renderEvidenceMarkdown(task.evidence) : undefined;
}

export async function createTask(
  input: z.infer<typeof taskInput>,
  store: TaskStore = defaultStore,
  scheduler: TaskScheduler = defaultScheduler,
): Promise<TaskResult> {
  return runTask(
    {
      repository: input.repository,
      mode: input.mode,
      trigger: input.trigger,
      ...(input.feedback ? { feedback: input.feedback } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.files ? { files: input.files } : {}),
    },
    { store, scheduler },
  );
}

export interface RunTaskOptions {
  store?: TaskStore;
  scheduler?: TaskScheduler;
  /** Optional hosted execution pool; its leases still expose only the Runner boundary. */
  runnerPool?: RunnerPool;
}

/**
 * Queue and run one unit of work, persisting its structured lifecycle and evidence.
 *
 * This composition root resolves policy and constructs the only execution boundary. Neither the
 * transport, persistence adapter, scheduler, nor dashboard can execute repository commands.
 */
export async function runTask(
  input: ReviewInput,
  options: RunTaskOptions = {},
): Promise<TaskResult> {
  const store = options.store ?? defaultStore;
  const scheduler = options.scheduler ?? defaultScheduler;
  const identifier = taskId();
  const timestamp = now();
  const record: StoredTask = {
    id: identifier,
    repository: repositoryLabel(input),
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    events: [],
  };
  await store.save(record);

  try {
    return await scheduler.schedule(input.repository, async () => {
      record.status = 'running';
      record.updatedAt = now();
      await store.save(record);

      const config = await loadConfig(input.repository);
      let eventWrites = Promise.resolve();
      const writable = mayModifyRepository(config, input.mode);
      const lease = options.runnerPool
        ? await options.runnerPool.acquire({
            taskId: identifier,
            repository: input.repository,
            mode: input.mode,
            writable,
            network: config.permissions.network,
            leaseMs: config.agent.timeoutMs,
          })
        : undefined;
      const runner =
        lease?.runner ?? createRunner(input.repository, runnerOptionsFromPolicy(config, writable));
      // Refuses claude-code under container isolation when no CLI container image is configured,
      // and outright under a RunnerPool lease regardless of runner.isolation: SandboxProvider
      // (vitehub/cloudflare/vercel/custom) returns only a bounded-command Runner, never a live
      // process handle, so there is no way to route the CLI's duplex spawn through the same hosted
      // boundary the lease already gives repository commands — spawning it on the control-plane
      // host instead would bypass exactly the isolation, lifecycle, quota, and audit controls an
      // operator configured RunnerPool for. Reported to modelFromEnvironment as a refusal reason,
      // not by disabling the enable flag: the flag would also skip fallback selection, turning a
      // configured CODE_ZERO_MODEL_FALLBACK_PROVIDER into a run that fails outright instead of
      // degrading to it.
      const refusalReason =
        config.model.provider !== 'claude-code'
          ? undefined
          : lease
            ? 'A RunnerPool lease is active for this task; the claude-code CLI process cannot be ' +
              "routed through an arbitrary SandboxProvider's boundary, so it cannot honor the " +
              'isolation the lease provides for repository commands.'
            : claudeCodeRefusalReason(config, process.env);
      const spawnClaudeCodeProcess =
        config.model.provider === 'claude-code' &&
        refusalReason === undefined &&
        isSubscriptionProviderEnabled('claude-code', process.env)
          ? claudeCodeProcessSpawner(config, process.env)
          : undefined;
      const agent = new CodeZero({
        model: modelFromEnvironment(
          config.model,
          process.env,
          spawnClaudeCodeProcess,
          refusalReason,
        ),
        runner,
        config,
        taskIdentifier: identifier,
        onEvent: (event) => {
          record.events.push(event);
          record.updatedAt = event.timestamp;
          eventWrites = eventWrites.then(() => store.save(record));
        },
      });
      let result: TaskResult;
      let snapshot: ChangedFileSnapshot[] | undefined;
      try {
        result = await agent.run(input);
        // Captured through the run's own boundary before the lease is released, so publication
        // later reads exactly what the run verified, never whatever the checkout holds by then.
        if (result.changedFiles.length > 0)
          snapshot = await snapshotChangedFiles(runner, result.changedFiles);
      } finally {
        if (lease) await options.runnerPool?.release(lease.id);
      }
      await eventWrites;
      record.status = result.state;
      record.updatedAt = now();
      record.result = result;
      record.evidence = evidenceFromResult(result, input);
      if (snapshot) record.changedFileSnapshot = snapshot;
      await store.save(record);
      return result;
    });
  } catch (error) {
    record.status = 'failed';
    record.updatedAt = now();
    record.events.push({
      state: 'failed',
      message: redactSecrets(error instanceof Error ? error.message : String(error)),
      timestamp: record.updatedAt,
    });
    await store.save(record);
    throw error;
  }
}

export async function decideApproval(
  taskIdentifier: string,
  decision: ApprovalDecision,
  actor: string,
  comment: string | undefined,
  store: TaskStore = defaultStore,
): Promise<StoredTask> {
  const record = await store.get(taskIdentifier);
  if (!record) throw new Error(`Unknown task: ${taskIdentifier}`);
  if (record.status !== 'needs-human')
    throw new Error('Only tasks awaiting human review can receive an approval decision');
  const timestamp = now();
  record.approval = {
    decision,
    actor: redactSecrets(actor, secretValuesFromEnvironment()),
    comment: comment ? redactSecrets(comment, secretValuesFromEnvironment()) : null,
    decidedAt: timestamp,
  };
  record.updatedAt = timestamp;
  await store.save(record);
  return record;
}

export interface WebhookRequest {
  /** The raw request body, exactly as received; signatures verify these bytes. */
  body: string;
  headers: WebhookHeaders;
}

/** One source-control provider a deployment accepts webhooks from, with its own secret. */
export interface ProviderWebhookConfig {
  kind: ProviderKind;
  secret: string;
}

export interface WebhookOptions {
  /** Providers this deployment listens to. One deployment may connect several. */
  providers: readonly ProviderWebhookConfig[];
  checkoutPath: string;
  ignoreAuthors?: readonly string[];
  store?: TaskStore;
  scheduler?: TaskScheduler;
  /** Credentials for publishing a GitHub issue run's verified changes as a pull request. */
  github?: { token: string | undefined; fetch?: typeof globalThis.fetch };
  /** In-flight delivery-key claims for issue events; defaults to a process-wide registry. */
  deliveries?: Map<string, Promise<WebhookOutcome>>;
  /**
   * Durable delivery claims shared across restarts and instances. Without one, redelivery
   * deduplication only spans this process's lifetime and its bounded in-memory registry.
   */
  deliveryClaims?: DeliveryClaimStore;
}

export type WebhookOutcome =
  | { status: 'rejected'; reason: string }
  | { status: 'ignored'; reason: string }
  | {
      status: 'accepted';
      result: TaskResult;
      provider: ProviderKind;
      changeRequest: ChangeRequestRef;
    }
  | {
      status: 'accepted';
      result: TaskResult;
      issue: IssueRef;
      /** The pull request the verified changes were published as, when one was earned. */
      openedPullRequest: { number: number; url: string } | null;
      /** Why no pull request was opened. Null when one was. */
      pullRequestReason: string | null;
      /** Whether the validation verdict was reported back on the issue, and why not otherwise. */
      validationComment: { posted: boolean; reason: string | null };
    };

/**
 * The GitHub issue-to-PR workflow currently only exists on the GitHub adapter: it depends on the
 * Git data API for branch and pull-request creation and has no equivalent implemented for the
 * other providers yet. It is dispatched here, ahead of the provider-neutral review-event path,
 * because it is not part of the shared `SourceControlProvider` review-event contract.
 */
export async function ingestWebhook(
  request: WebhookRequest,
  options: WebhookOptions,
): Promise<WebhookOutcome> {
  const kinds = options.providers.map((provider) => provider.kind);
  const provider = providerForDelivery(request.headers, kinds);
  if (!provider)
    return { status: 'rejected', reason: 'No configured provider recognizes this delivery' };
  const secret = options.providers.find((entry) => entry.kind === provider.kind)?.secret ?? '';

  if (!provider.verifyWebhook({ body: request.body, headers: request.headers }, secret))
    return { status: 'rejected', reason: 'Invalid webhook signature' };

  const eventName = provider.eventName(request.headers);
  if (eventName === undefined) return { status: 'ignored', reason: 'The delivery names no event' };

  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    return { status: 'rejected', reason: 'Webhook body is not valid JSON' };
  }

  if (provider.kind === 'github' && eventName === 'issues')
    return ingestIssueEvent(request, eventName, payload, options);

  const event = provider.parseReviewEvent(
    eventName,
    payload,
    options.ignoreAuthors ? { ignoreAuthors: options.ignoreAuthors } : {},
  );
  if (!event) return { status: 'ignored', reason: 'No actionable review feedback in this event' };

  let mode: ReviewInput['mode'] = 'observe';
  if (event.trigger === 'proactive') {
    const config = await loadConfig(options.checkoutPath);
    if (!config.proactive.enabled)
      return { status: 'ignored', reason: 'Proactive review is disabled by repository policy' };
    mode = config.mode;
  }

  const runOptions: RunTaskOptions = {
    ...(options.store ? { store: options.store } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
  };
  const result = await runTask(
    reviewInputFromEvent(event, { checkoutPath: options.checkoutPath, mode }),
    runOptions,
  );
  return {
    status: 'accepted',
    result,
    provider: provider.kind,
    changeRequest: event.changeRequest,
  };
}

/** Process-wide issue delivery claims, bounded so redelivery tracking cannot grow without limit. */
const defaultDeliveries = new Map<string, Promise<WebhookOutcome>>();
const MAX_DELIVERY_CLAIMS = 10_000;

/**
 * Run one scoped GitHub issue task and, when the run earns it, publish the result as a pull
 * request.
 *
 * The issue text is untrusted input: it becomes feedback for the runtime to validate, the run mode
 * comes only from repository policy, and policy must opt in (`issues.enabled` plus the required
 * label) before any model call happens. Before any work starts, the issue's claimed repository is
 * bound to the checkout's own git identity, and the delivery is claimed atomically so a GitHub
 * redelivery observes the recorded outcome instead of starting a second run. A failed publication
 * never fails the run — the evidence is already persisted — it is reported as the reason no pull
 * request exists.
 */
async function ingestIssueEvent(
  request: WebhookRequest,
  eventName: string,
  payload: unknown,
  options: WebhookOptions,
): Promise<WebhookOutcome> {
  const config = await loadConfig(options.checkoutPath);
  if (!config.issues.enabled)
    return { status: 'ignored', reason: 'Issue tasks are disabled by repository policy' };

  const task = parseIssueTask(eventName, payload, {
    requireLabel: config.issues.requireLabel,
    ...(options.ignoreAuthors ? { ignoreAuthors: options.ignoreAuthors } : {}),
  });
  if (!task) return { status: 'ignored', reason: 'No actionable issue task in this event' };

  const identity = await new LocalRunner(options.checkoutPath).originRepository();
  const mismatch = checkoutRepositoryMismatch(identity, task.issue);
  if (mismatch) return { status: 'rejected', reason: mismatch };

  // The claim is registered before the work starts, so a concurrent redelivery shares the
  // in-flight outcome rather than racing a second run past the check above.
  const deliveries = options.deliveries ?? defaultDeliveries;
  const key = issueDeliveryKey(request, eventName);
  const claimed = deliveries.get(key);
  if (claimed) return claimed;

  // The durable claim is also taken before the work starts, so a redelivery after a process
  // restart, on another instance, or after the in-memory claim above was evicted observes the
  // recorded outcome instead of starting a duplicate run.
  if (options.deliveryClaims) {
    const claim = await options.deliveryClaims.claim(key);
    if (!claim.claimed) {
      if (isRecordedWebhookOutcome(claim.outcome)) return claim.outcome;
      return {
        status: 'ignored',
        reason: 'This delivery is already claimed by an in-flight run',
      };
    }
  }

  if (deliveries.size >= MAX_DELIVERY_CLAIMS) {
    const oldest = deliveries.keys().next().value;
    if (oldest !== undefined) deliveries.delete(oldest);
  }
  const outcome = runIssueTask(
    task,
    { mode: config.mode, validationComment: config.issues.validationComment },
    options,
  );
  deliveries.set(key, outcome);
  try {
    const settled = await outcome;
    // Best effort: a lost outcome write must not fail the finished run, and the standing claim
    // marker still stops a duplicate; the redelivery is then declined instead of replayed.
    await options.deliveryClaims?.complete(key, settled).catch(() => undefined);
    return settled;
  } catch (error) {
    // A transport-level failure recorded no outcome worth replaying; let a redelivery retry.
    deliveries.delete(key);
    await options.deliveryClaims?.release(key).catch(() => undefined);
    throw error;
  }
}

/**
 * Narrow a durably recorded delivery outcome back to the webhook contract. Anything else in the
 * record (an in-flight marker's null, or a corrupted value) replays nothing.
 */
function isRecordedWebhookOutcome(value: unknown): value is WebhookOutcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value.status === 'rejected' || value.status === 'ignored' || value.status === 'accepted')
  );
}

async function runIssueTask(
  task: IssueTask,
  policy: { mode: ReviewInput['mode']; validationComment: boolean },
  options: WebhookOptions,
): Promise<WebhookOutcome> {
  const runOptions: RunTaskOptions = {
    ...(options.store ? { store: options.store } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
  };
  const result = await runTask(
    issueInputFromTask(task, { checkoutPath: options.checkoutPath, mode: policy.mode }),
    runOptions,
  );

  let validationComment: { posted: boolean; reason: string | null } = {
    posted: false,
    reason: 'Validation comments are disabled by repository policy',
  };
  if (policy.validationComment) {
    try {
      const report = await publishIssueValidation(result.id, {
        token: options.github?.token,
        ...(options.github?.fetch ? { fetch: options.github.fetch } : {}),
        ...(options.store ? { store: options.store } : {}),
      });
      validationComment = report.posted
        ? { posted: true, reason: null }
        : { posted: false, reason: report.reason };
    } catch (error) {
      validationComment = {
        posted: false,
        reason: redactSecrets(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  let openedPullRequest: { number: number; url: string } | null = null;
  let pullRequestReason: string | null = null;
  try {
    const publication = await openIssuePullRequest(result.id, {
      token: options.github?.token,
      checkoutPath: options.checkoutPath,
      ...(options.github?.fetch ? { fetch: options.github.fetch } : {}),
      ...(options.store ? { store: options.store } : {}),
    });
    if (publication.opened)
      openedPullRequest = { number: publication.number, url: publication.url };
    else pullRequestReason = publication.reason;
  } catch (error) {
    pullRequestReason = redactSecrets(error instanceof Error ? error.message : String(error));
  }
  return {
    status: 'accepted',
    result,
    issue: task.issue,
    openedPullRequest,
    pullRequestReason,
    validationComment,
  };
}

export interface PublishIssueValidationOptions {
  token: string | undefined;
  fetch?: typeof globalThis.fetch;
  store?: TaskStore;
}

export type IssueValidationOutcome =
  | { posted: true; commentId: number }
  | { posted: false; reason: string };

/**
 * Report a finished issue run's validation verdict back on its issue.
 *
 * Whether there is a verdict to report — and what it says — is decided by
 * `prepareIssueValidationComment` from the persisted evidence alone; this composition root only
 * supplies the stored bundle and posts the composed comment. Report-only: nothing here can label,
 * edit, close, or otherwise act on the issue.
 */
export async function publishIssueValidation(
  taskIdentifier: string,
  options: PublishIssueValidationOptions,
): Promise<IssueValidationOutcome> {
  const task = await (options.store ?? defaultStore).get(taskIdentifier);
  const evidence = task?.evidence;
  if (!evidence) return { posted: false, reason: `Unknown task: ${taskIdentifier}` };

  const comment = prepareIssueValidationComment(evidence);
  if (!comment.ready) return { posted: false, reason: comment.reason };
  const issue = evidence.issue;
  if (!issue)
    return { posted: false, reason: 'The run does not reference the issue it worked on.' };
  if (!options.token) return { posted: false, reason: 'GITHUB_TOKEN is not configured' };

  const commentId = await new GitHubIssueComments({
    token: options.token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  }).create(issue, comment.body);
  return { posted: true, commentId };
}

/**
 * The idempotency key for one issue delivery. GitHub's delivery identifier is preferred; without
 * one, a redelivered event still carries a byte-identical body, so its digest recognizes it.
 */
function issueDeliveryKey(request: WebhookRequest, eventName: string): string {
  const delivery = readHeader(request.headers, 'x-github-delivery');
  if (delivery !== undefined && delivery.length > 0) return `delivery:${delivery}`;
  return `payload:${createHash('sha256').update(`${eventName}\n${request.body}`).digest('hex')}`;
}

export interface OpenIssuePullRequestOptions {
  token: string | undefined;
  checkoutPath: string;
  fetch?: typeof globalThis.fetch;
  store?: TaskStore;
}

export type IssuePullRequestOutcome =
  | { opened: true; number: number; url: string }
  | { opened: false; reason: string };

/**
 * Publish a finished issue run as an isolated branch and review-ready pull request.
 *
 * Whether the run has earned a pull request is decided by `prepareIssuePullRequest` alone; this
 * composition root only supplies the stored evidence and the immutable snapshot captured when the
 * run finished, and hands both to the GitHub adapter. The live checkout is never re-read, so a
 * mutation after verification cannot be published under the run's evidence, and the target
 * repository must match the checkout's own git identity before anything is sent. The default
 * branch is never pushed to: changes land on a fresh `issues.branchPrefix` branch whose name
 * contains no issue text.
 */
export async function openIssuePullRequest(
  taskIdentifier: string,
  options: OpenIssuePullRequestOptions,
): Promise<IssuePullRequestOutcome> {
  const task = await (options.store ?? defaultStore).get(taskIdentifier);
  const evidence = task?.evidence;
  if (!evidence) return { opened: false, reason: `Unknown task: ${taskIdentifier}` };

  const readiness = prepareIssuePullRequest(evidence);
  if (!readiness.ready) return { opened: false, reason: readiness.reason };
  const issue = evidence.issue;
  if (!issue)
    return { opened: false, reason: 'The run does not reference the issue it worked on.' };
  if (!options.token) return { opened: false, reason: 'GITHUB_TOKEN is not configured' };

  const identity = await new LocalRunner(options.checkoutPath).originRepository();
  const mismatch = checkoutRepositoryMismatch(identity, issue);
  if (mismatch) return { opened: false, reason: mismatch };

  const snapshot = new Map(
    task.changedFileSnapshot?.map((file) => [file.path, file.contentBase64]),
  );
  const files: BranchFile[] = [];
  for (const path of evidence.changedFiles) {
    const contentBase64 = snapshot.get(path);
    if (contentBase64 === undefined)
      return {
        opened: false,
        reason: 'No immutable snapshot of the verified changes covers every changed file.',
      };
    files.push({ path, contentBase64 });
  }

  const config = await loadConfig(options.checkoutPath);

  const pulls = new GitHubPullRequests({
    token: options.token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const target = { owner: issue.owner, repo: issue.repo };
  const base = await pulls.defaultBranch(target);
  const branch = issueBranchName(config.issues.branchPrefix, issue, taskIdentifier);
  await pulls.publishBranch(target, {
    branch,
    baseSha: base.sha,
    message: `${readiness.title}\n\nCloses #${String(issue.number)}.`,
    files,
  });
  const opened = await pulls.openPullRequest(target, {
    title: readiness.title,
    body: readiness.body,
    head: branch,
    base: base.name,
  });
  return { opened: true, ...opened };
}

export interface PublishOptions {
  token: string | undefined;
  /** API base URL, required for self-hosted providers. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  store?: TaskStore;
}

const statusTokenVariables: Record<ProviderKind, string> = {
  github: 'GITHUB_TOKEN',
  gitlab: 'GITLAB_TOKEN',
  'bitbucket-cloud': 'BITBUCKET_CLOUD_TOKEN',
  'bitbucket-data-center': 'BITBUCKET_DATA_CENTER_TOKEN',
  gitea: 'GITEA_TOKEN',
};

/** The status credential for one provider, from its fixed environment variable. */
export function statusTokenFromEnvironment(kind: ProviderKind): string | undefined {
  return process.env[statusTokenVariables[kind]];
}

export function githubTokenFromEnvironment(): string | undefined {
  return statusTokenFromEnvironment('github');
}

export async function publishEvidence(
  target: ChangeRequestRef,
  taskIdentifier: string,
  options: PublishOptions,
): Promise<{ published: boolean; reason?: string }> {
  if (!options.token)
    return {
      published: false,
      reason: `${statusTokenVariables[target.provider]} is not configured`,
    };
  const task = await (options.store ?? defaultStore).get(taskIdentifier);
  if (!task?.evidence) return { published: false, reason: `Unknown task: ${taskIdentifier}` };
  const publisher = createProvider(target.provider).statusPublisher({
    token: options.token,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const publication = await publisher.publish(target, task.evidence);
  return { published: true, ...(publication.degraded ? { reason: publication.degraded } : {}) };
}

/**
 * Why an issue's claimed repository cannot be served by this checkout, or null when it can.
 *
 * The webhook payload names its own owner and repository, so those fields alone must never select
 * a publication target: a token authorized for several repositories would happily write one
 * checkout's content into another. The checkout's git identity is the trusted side, and an absent
 * or ambiguous identity fails closed.
 */
function checkoutRepositoryMismatch(
  identity: { owner: string; repo: string } | null,
  issue: IssueRef,
): string | null {
  if (!identity)
    return 'The checkout does not declare a single trusted origin repository, so the issue cannot be bound to it.';
  if (
    identity.owner.toLowerCase() !== issue.owner.toLowerCase() ||
    identity.repo.toLowerCase() !== issue.repo.toLowerCase()
  )
    return `The event claims repository ${issue.owner}/${issue.repo}, but the checkout tracks ${identity.owner}/${identity.repo}.`;
  return null;
}

/**
 * Read each changed file's final content through the run's own boundary.
 *
 * The snapshot is captured the moment a run finishes, while the runner's lease is still held, so a
 * later publication reads exactly what the run verified rather than whatever the checkout holds by
 * the time someone gets around to publishing it — a window where the working tree could have been
 * mutated and the change would be published with corrupted contents.
 */
async function snapshotChangedFiles(
  runner: Runner,
  paths: readonly string[],
): Promise<ChangedFileSnapshot[]> {
  const files: ChangedFileSnapshot[] = [];
  for (const path of paths)
    files.push(
      (await runner.exists(path))
        ? { path, contentBase64: Buffer.from(await runner.readBytes(path)).toString('base64') }
        : { path, contentBase64: null },
    );
  return files;
}

function repositoryLabel(input: ReviewInput): string {
  if (input.pullRequest) return `${input.pullRequest.owner}/${input.pullRequest.repo}`;
  const normalized = input.repository.replaceAll('\\', '/').replace(TRAILING_SLASH, '');
  return redactSecrets(normalized.split('/').at(-1) || 'repository');
}
