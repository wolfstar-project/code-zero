import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { RunnerPool, type Runner, type SandboxProvider } from '@code-zero/runner';
import type { EvidenceBundle } from '@code-zero/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  PersistentDeliveryClaimStore,
  type DeliveryClaimStore,
  type KeyValueStorage,
} from './control-plane.js';
import {
  decideApproval,
  getStoredTask,
  getTask,
  getTaskEvidence,
  health,
  ingestWebhook,
  listTasks,
  openIssuePullRequest,
  publishEvidence,
  publishIssueValidation,
  runTask,
  statusTokenFromEnvironment,
  taskInput,
  tasks,
  type WebhookOutcome,
} from './operations.js';

const secret = 'webhook-secret-value';
const MODE_ERROR = /mode/i;

function sign(body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** A GitHub delivery for the router: raw body plus the headers GitHub would send. */
function githubDelivery(event: string, body: string, signature = sign(body)) {
  return {
    body,
    headers: { 'x-github-event': event, 'x-hub-signature-256': signature },
  };
}

function reviewPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'submitted',
    repository: { name: 'app', owner: { login: 'acme' } },
    pull_request: {
      number: 7,
      base: { sha: 'b'.repeat(40) },
      head: { sha: 'a'.repeat(40) },
    },
    review: {
      id: 1,
      body: 'load() can return null',
      state: 'changes_requested',
      user: { login: 'alice', type: 'User' },
      ...overrides,
    },
  });
}

let checkout: string;

const git = promisify(execFile);

/** Give the checkout the trusted git identity that binds it to a publication target. */
async function bindCheckout(url = 'https://github.com/acme/app.git'): Promise<void> {
  await git('git', ['init', '--quiet'], { cwd: checkout });
  await git('git', ['remote', 'add', 'origin', url], { cwd: checkout });
}

/** A minimal hosted sandbox provider: leases a Runner that never actually gets used in this test. */
function sandboxProvider(): SandboxProvider {
  const runner: Runner = {
    describe: () => ({ kind: 'container', isolated: true, writable: false, network: 'none' }),
    context: async () => '',
    reviewFiles: async () => [],
    read: async () => '',
    readBytes: async () => new Uint8Array(),
    exists: async () => false,
    write: async () => undefined,
    check: async (command) => ({ command, exitCode: 0, stdout: '', stderr: '', durationMs: 0 }),
    changedFiles: async () => [],
  };
  return {
    kind: 'vitehub',
    provision: async (request) => ({ externalId: `remote-${request.taskId}`, runner }),
    stop: async () => undefined,
  };
}

beforeEach(async () => {
  tasks.clear();
  checkout = await mkdtemp(join(tmpdir(), 'code-zero-server-'));
  await writeFile(join(checkout, 'package.json'), JSON.stringify({ scripts: {} }), 'utf8');
});

describe('server task API', () => {
  it('exposes health metadata for Nitro handlers', () => {
    expect(health()).toMatchObject({ status: 'ok', service: 'code-zero' });
  });

  it('starts with an empty task collection', async () => {
    await expect(listTasks()).resolves.toEqual({ tasks: [] });
  });

  it('keeps task input validation independent from HTTP transport', () => {
    expect(
      taskInput.parse({ repository: '.', feedback: 'Check error handling', mode: 'observe' }),
    ).toMatchObject({ repository: '.', mode: 'observe' });
  });

  it('rejects an unknown mode at the transport edge', () => {
    expect(() => taskInput.parse({ repository: '.', feedback: 'x', mode: 'yolo' })).toThrow(
      MODE_ERROR,
    );
  });

  it('records a human approval only for a task awaiting review', async () => {
    const timestamp = new Date(0).toISOString();
    tasks.set('cz_approval', {
      id: 'cz_approval',
      repository: 'acme/app',
      status: 'needs-human',
      createdAt: timestamp,
      updatedAt: timestamp,
      events: [],
    });

    await expect(
      decideApproval('cz_approval', 'approved', 'release-manager', 'Reviewed evidence'),
    ).resolves.toMatchObject({
      status: 'needs-human',
      approval: {
        decision: 'approved',
        actor: 'release-manager',
        comment: 'Reviewed evidence',
      },
    });
    await expect(getStoredTask('cz_approval')).resolves.toMatchObject({
      approval: { decision: 'approved' },
    });
  });
});

describe('runTask', () => {
  it('stores the result and its evidence together', async () => {
    const result = await runTask({
      repository: checkout,
      feedback: 'load() is wrong',
      mode: 'observe',
    });
    await expect(getTask(result.id)).resolves.toEqual(result);
    await expect(getTaskEvidence(result.id)).resolves.toContain('## Code Zero');
    await expect(listTasks()).resolves.toMatchObject({ tasks: [expect.any(Object)] });
  });

  it('produces a read-only boundary for an observe run', async () => {
    const result = await runTask({
      repository: checkout,
      feedback: 'load() is wrong',
      mode: 'observe',
    });
    expect(result.runner.writable).toBe(false);
    expect(result.changedFiles).toEqual([]);
  });

  it('keeps the boundary read-only in fix mode while policy disables autofix', async () => {
    const result = await runTask({
      repository: checkout,
      feedback: 'load() is wrong',
      mode: 'fix',
    });
    expect(result.runner.writable).toBe(false);
  });

  it('reports an unverified conclusion when no model is configured', async () => {
    const result = await runTask({
      repository: checkout,
      feedback: 'load() is wrong',
      mode: 'observe',
    });
    expect(result.verified).toBe(false);
    expect(result.verdict).toBe('rejected');
  });

  it('refuses claude-code under a RunnerPool lease instead of spawning it unisolated on the host', async () => {
    // SandboxProvider (vitehub/cloudflare/vercel/custom) returns only a bounded-command Runner,
    // never a live process handle — there is no way to route the CLI's duplex spawn through the
    // same hosted boundary the lease gives repository commands, so a lease refuses the transport
    // outright rather than silently falling back to a host spawn that bypasses it.
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nmode: observe\nmodel:\n  provider: claude-code\n  name: sonnet\n',
      'utf8',
    );
    const original = process.env.CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER;
    process.env.CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER = 'true';
    try {
      const pool = new RunnerPool(sandboxProvider(), {
        maxActive: 1,
        maxActivePerRepository: 1,
        // At least defaultConfig.agent.timeoutMs (1_800_000): runTask requests that as leaseMs.
        maxLeaseMs: 2_000_000,
      });
      const result = await runTask(
        { repository: checkout, feedback: 'load() is wrong', mode: 'observe' },
        { runnerPool: pool },
      );
      // No CODE_ZERO_MODEL_FALLBACK_PROVIDER is configured in this test, so the refusal has
      // nothing to degrade to and the run fails outright rather than spawning the CLI unisolated
      // on the host. `modelFromEnvironment` proves the companion guarantee — that a configured
      // fallback IS honored here instead of being skipped — at the unit level in
      // packages/models/src/index.test.ts ("preserves a configured fallback when a composition
      // root refuses the transport"), since exercising a real fallback provider end to end here
      // would require a live model call.
      expect(result.state).toBe('failed');
      expect(result.finding).toBeNull();
      expect(result.verified).toBe(false);
    } finally {
      if (original === undefined) delete process.env.CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER;
      else process.env.CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER = original;
    }
  });
});

describe('ingestWebhook', () => {
  const options = () => ({
    providers: [{ kind: 'github' as const, secret }],
    checkoutPath: checkout,
  });

  it('rejects a delivery no configured provider recognizes', async () => {
    const body = reviewPayload();
    await expect(
      ingestWebhook({ body, headers: { 'x-gitlab-event': 'Note Hook' } }, options()),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'No configured provider recognizes this delivery',
    });
    expect(tasks.size).toBe(0);
  });

  it('rejects a forged signature before parsing the payload', async () => {
    const body = reviewPayload();
    await expect(
      ingestWebhook(githubDelivery('pull_request_review', body, 'sha256=deadbeef'), options()),
    ).resolves.toEqual({ status: 'rejected', reason: 'Invalid webhook signature' });
    expect(tasks.size).toBe(0);
  });

  it('rejects a body that is not JSON', async () => {
    const outcome = await ingestWebhook(
      githubDelivery('pull_request_review', 'not json'),
      options(),
    );
    expect(outcome).toEqual({ status: 'rejected', reason: 'Webhook body is not valid JSON' });
  });

  it('ignores an event that carries no claim to validate', async () => {
    const outcome = await ingestWebhook(
      githubDelivery('pull_request_review', reviewPayload({ state: 'approved' })),
      options(),
    );
    expect(outcome.status).toBe('ignored');
    expect(tasks.size).toBe(0);
  });

  it('ignores its own account so a run cannot answer itself', async () => {
    const outcome = await ingestWebhook(
      githubDelivery('pull_request_review', reviewPayload({ user: { login: 'code-zero[bot]' } })),
      { ...options(), ignoreAuthors: ['code-zero[bot]'] },
    );
    expect(outcome.status).toBe('ignored');
  });

  it('runs an authenticated review in observe mode and never writes', async () => {
    const outcome = await ingestWebhook(
      githubDelivery('pull_request_review', reviewPayload()),
      options(),
    );
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted' || !('changeRequest' in outcome)) return;
    expect(outcome.provider).toBe('github');
    expect(outcome.changeRequest).toEqual({
      provider: 'github',
      owner: 'acme',
      repo: 'app',
      number: 7,
      baseSha: 'b'.repeat(40),
      headSha: 'a'.repeat(40),
    });
    expect(outcome.result.runner.writable).toBe(false);
    expect(outcome.result.changedFiles).toEqual([]);
    expect(outcome.result.summary).toContain('github:acme/app#7');
  });

  it('accepts deliveries from a second configured provider in the same deployment', async () => {
    const body = JSON.stringify({
      object_kind: 'note',
      user: { username: 'alice' },
      project: { path_with_namespace: 'acme/app' },
      object_attributes: {
        id: 11,
        note: 'load() can return null',
        noteable_type: 'MergeRequest',
      },
      merge_request: { iid: 7, last_commit: { id: 'a'.repeat(40) } },
    });
    const outcome = await ingestWebhook(
      { body, headers: { 'x-gitlab-event': 'Note Hook', 'x-gitlab-token': secret } },
      { ...options(), providers: [...options().providers, { kind: 'gitlab' as const, secret }] },
    );
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted' || !('changeRequest' in outcome)) return;
    expect(outcome.provider).toBe('gitlab');
    expect(outcome.changeRequest.baseSha).toBeUndefined();
    expect(outcome.result.summary).toContain('gitlab:acme/app!7');
  });

  it('ignores proactive pull-request events until repository policy enables them', async () => {
    const body = JSON.stringify({
      action: 'synchronize',
      repository: { name: 'app', owner: { login: 'acme' } },
      pull_request: {
        number: 7,
        base: { sha: 'b'.repeat(40) },
        head: { sha: 'a'.repeat(40) },
      },
    });
    await expect(ingestWebhook(githubDelivery('pull_request', body), options())).resolves.toEqual({
      status: 'ignored',
      reason: 'Proactive review is disabled by repository policy',
    });
  });

  it('runs an enabled proactive pull-request review in repository mode', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nproactive:\n  enabled: true\nmode: observe\n',
      'utf8',
    );
    const body = JSON.stringify({
      action: 'opened',
      repository: { name: 'app', owner: { login: 'acme' } },
      pull_request: {
        number: 7,
        base: { sha: 'b'.repeat(40) },
        head: { sha: 'a'.repeat(40) },
      },
    });
    const outcome = await ingestWebhook(githubDelivery('pull_request', body), options());
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted') return;
    expect(outcome.result.runner.writable).toBe(false);
    await expect(getTaskEvidence(outcome.result.id)).resolves.toContain('proactive finding');
  });
});

function issuePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'labeled',
    repository: { name: 'app', owner: { login: 'acme' } },
    issue: {
      number: 12,
      state: 'open',
      title: 'Guard the null return in the loader',
      body: 'load() returns null and callers dereference it.',
      user: { login: 'dev', type: 'User' },
      labels: [{ name: 'code-zero' }],
      ...overrides,
    },
  });
}

/** A GitHub `issues` delivery, optionally carrying a delivery identifier for dedup tests. */
function issuesDelivery(body: string, delivery?: string) {
  return {
    body,
    headers: {
      'x-github-event': 'issues',
      'x-hub-signature-256': sign(body),
      ...(delivery ? { 'x-github-delivery': delivery } : {}),
    },
  };
}

describe('ingestWebhook issue tasks', () => {
  const options = () => ({
    providers: [{ kind: 'github' as const, secret }],
    checkoutPath: checkout,
    deliveries: new Map<string, Promise<WebhookOutcome>>(),
  });

  it('ignores issue events until repository policy enables them', async () => {
    const body = issuePayload();
    await expect(ingestWebhook(issuesDelivery(body), options())).resolves.toEqual({
      status: 'ignored',
      reason: 'Issue tasks are disabled by repository policy',
    });
    expect(tasks.size).toBe(0);
  });

  it('ignores an enabled repository issue without the required label', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n',
      'utf8',
    );
    const body = issuePayload({ labels: [{ name: 'bug' }] });
    await expect(ingestWebhook(issuesDelivery(body), options())).resolves.toEqual({
      status: 'ignored',
      reason: 'No actionable issue task in this event',
    });
    expect(tasks.size).toBe(0);
  });

  it('runs a labeled issue task in repository mode and withholds the pull request', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n',
      'utf8',
    );
    await bindCheckout();
    const body = issuePayload();
    const outcome = await ingestWebhook(issuesDelivery(body), options());
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted' || !('issue' in outcome)) return;
    expect(outcome.issue).toEqual({ owner: 'acme', repo: 'app', number: 12 });
    // No model is configured, so the task is rejected, stays unverified, and must not produce a
    // pull request; the reason is reported instead of a fabricated success.
    expect(outcome.result.verified).toBe(false);
    expect(outcome.openedPullRequest).toBeNull();
    expect(outcome.pullRequestReason).toContain('not accepted');
    // The validation verdict still wants to reach the issue; only the missing token stops it.
    expect(outcome.validationComment).toEqual({
      posted: false,
      reason: 'GITHUB_TOKEN is not configured',
    });
    await expect(getTaskEvidence(outcome.result.id)).resolves.toContain('issue task');
  });

  it('keeps the validation comment off when repository policy disables it', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n  validationComment: false\n',
      'utf8',
    );
    await bindCheckout();
    const body = issuePayload();
    const outcome = await ingestWebhook(issuesDelivery(body), {
      ...options(),
      github: { token: 'ghs_token_value' },
    });
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted' || !('validationComment' in outcome)) return;
    expect(outcome.validationComment).toEqual({
      posted: false,
      reason: 'Validation comments are disabled by repository policy',
    });
  });

  it('rejects an issue event whose checkout tracks a different repository', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n',
      'utf8',
    );
    await bindCheckout('https://github.com/donor/library.git');
    const body = issuePayload();
    const outcome = await ingestWebhook(issuesDelivery(body), options());
    expect(outcome).toEqual({
      status: 'rejected',
      reason: expect.stringContaining('checkout tracks donor/library') as unknown,
    });
    expect(tasks.size).toBe(0);
  });

  it('rejects an issue event when the checkout declares no trusted identity', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n',
      'utf8',
    );
    const body = issuePayload();
    const outcome = await ingestWebhook(issuesDelivery(body), options());
    expect(outcome).toEqual({
      status: 'rejected',
      reason: expect.stringContaining('trusted origin repository') as unknown,
    });
    expect(tasks.size).toBe(0);
  });

  it('returns the recorded outcome for a redelivered issue event instead of a second run', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n',
      'utf8',
    );
    await bindCheckout();
    const body = issuePayload();
    const shared = options();
    const request = issuesDelivery(body, 'delivery-guid-1');
    const first = await ingestWebhook(request, shared);
    const second = await ingestWebhook(request, shared);
    expect(first.status).toBe('accepted');
    expect(second).toBe(first);
    expect(tasks.size).toBe(1);
  });

  it('deduplicates a redelivery by payload when no delivery identifier is supplied', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n',
      'utf8',
    );
    await bindCheckout();
    const body = issuePayload();
    const shared = options();
    const first = await ingestWebhook(issuesDelivery(body), shared);
    const second = await ingestWebhook(issuesDelivery(body), shared);
    expect(second).toBe(first);
    expect(tasks.size).toBe(1);
  });

  it('replays the durably recorded outcome after a restart discards in-process claims', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n',
      'utf8',
    );
    await bindCheckout();
    const deliveryClaims = new PersistentDeliveryClaimStore(memoryStorage(), []);
    const body = issuePayload();
    const request = issuesDelivery(body, 'delivery-guid-2');
    const first = await ingestWebhook(request, { ...options(), deliveryClaims });
    // A fresh in-process registry simulates a restarted or different server instance.
    const second = await ingestWebhook(request, { ...options(), deliveryClaims });
    expect(first.status).toBe('accepted');
    expect(second).toEqual(JSON.parse(JSON.stringify(first)));
    expect(tasks.size).toBe(1);
  });

  it('declines a redelivery while another instance holds the durable claim', async () => {
    await writeFile(
      join(checkout, '.code-zero.yml'),
      'version: 1\nissues:\n  enabled: true\n',
      'utf8',
    );
    await bindCheckout();
    const deliveryClaims: DeliveryClaimStore = {
      claim: async () => ({ claimed: false, outcome: null }),
      complete: async () => undefined,
      release: async () => undefined,
    };
    const body = issuePayload();
    const outcome = await ingestWebhook(issuesDelivery(body, 'delivery-guid-3'), {
      ...options(),
      deliveryClaims,
    });
    expect(outcome).toEqual({
      status: 'ignored',
      reason: 'This delivery is already claimed by an in-flight run',
    });
    expect(tasks.size).toBe(0);
  });
});

/** Deterministic in-memory storage with the atomic conditional write a KV driver would offer. */
function memoryStorage(): KeyValueStorage {
  const values = new Map<string, unknown>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, structuredClone(value));
    },
    getKeys: async (base = '') => [...values.keys()].filter((key) => key.startsWith(base)),
    removeItem: async (key) => {
      values.delete(key);
    },
    setItemIfAbsent: async (key, value) => {
      if (values.has(key)) return false;
      values.set(key, structuredClone(value));
      return true;
    },
  };
}

const issueBaseSha = 'b'.repeat(40);

function issueEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    taskId: 'cz_fixture',
    state: 'completed',
    verdict: 'accepted',
    verified: true,
    mode: 'fix',
    trigger: 'issue',
    source: 'github:acme/app#12',
    issue: { owner: 'acme', repo: 'app', number: 12 },
    runner: { kind: 'container', isolated: true, writable: true, network: 'none' },
    finding: {
      id: 'cz_fixture_finding',
      changeRisk: 'behavioral',
      title: 'Guard the null return in the loader',
      explanation: 'load() returns null but callers dereference it.',
      severity: 'high',
      confidence: 0.92,
      valid: true,
      evidence: ['`return null;` in src/user.ts'],
      files: ['src/user.ts'],
      verdict: 'accepted',
      rejectionReasons: [],
    },
    plan: ['Guard the null return'],
    acceptanceCriteria: ['load() never returns null'],
    changedFiles: ['src/user.ts'],
    checks: [{ command: 'pnpm run test', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 10 }],
    attempts: 1,
    transitions: [],
    summary: 'Fixed and verified: Guard the null return in the loader',
    ...overrides,
  };
}

const VERIFIED_CONTENT = 'export const load = (): object => ({});\n';
const VERIFIED_CONTENT_BASE64 = Buffer.from(VERIFIED_CONTENT).toString('base64');

function storeIssueTask(
  evidence: EvidenceBundle,
  snapshot: { path: string; contentBase64: string | null }[] | null = evidence.changedFiles.map(
    (path) => ({ path, contentBase64: VERIFIED_CONTENT_BASE64 }),
  ),
): void {
  const timestamp = new Date(0).toISOString();
  tasks.set(evidence.taskId, {
    id: evidence.taskId,
    repository: 'acme/app',
    status: evidence.state,
    createdAt: timestamp,
    updatedAt: timestamp,
    events: [],
    evidence,
    ...(snapshot ? { changedFileSnapshot: snapshot } : {}),
  });
}

/** A deterministic GitHub Git-data API double for the publication flow. */
function fakeGitHubApi(): {
  fetch: typeof globalThis.fetch;
  requests: { method: string; path: string; body: unknown }[];
} {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const responses: Record<string, unknown> = {
    '/repos/acme/app': { default_branch: 'main' },
    '/repos/acme/app/git/ref/heads%2Fmain': { object: { sha: issueBaseSha } },
    [`/repos/acme/app/git/commits/${issueBaseSha}`]: { tree: { sha: 't'.repeat(40) } },
    '/repos/acme/app/git/blobs': { sha: 'f'.repeat(40) },
    '/repos/acme/app/git/trees': { sha: 'e'.repeat(40) },
    '/repos/acme/app/git/commits': { sha: 'c'.repeat(40) },
    '/repos/acme/app/git/refs': { ref: 'created' },
    '/repos/acme/app/pulls': { number: 41, html_url: 'https://github.com/acme/app/pull/41' },
  };
  const handler: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(
      typeof input === 'string' ? input : 'url' in input ? input.url : input.href,
    ).pathname;
    requests.push({
      method: init?.method ?? 'GET',
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    if (!(path in responses)) return new Response('{"message":"missing"}', { status: 404 });
    return new Response(JSON.stringify(responses[path]), { status: 200 });
  };
  return { fetch: handler, requests };
}

describe('openIssuePullRequest', () => {
  it('publishes a verified issue run as an isolated branch and pull request', async () => {
    storeIssueTask(issueEvidence());
    await bindCheckout();

    const github = fakeGitHubApi();
    const outcome = await openIssuePullRequest('cz_fixture', {
      token: 'ghs_token_value',
      checkoutPath: checkout,
      fetch: github.fetch,
    });
    expect(outcome).toEqual({
      opened: true,
      number: 41,
      url: 'https://github.com/acme/app/pull/41',
    });

    // The published contents are the stored verified snapshot, never a fresh checkout read: the
    // checkout holds no such file at all, exactly as after a post-verification mutation. The
    // bytes travel as a base64 blob, so content that is not valid UTF-8 survives unchanged.
    const blob = github.requests.find((request) => request.path === '/repos/acme/app/git/blobs');
    expect(blob?.body).toEqual({ content: VERIFIED_CONTENT_BASE64, encoding: 'base64' });
    const tree = github.requests.find((request) => request.path === '/repos/acme/app/git/trees');
    expect(tree?.body).toMatchObject({
      tree: [{ path: 'src/user.ts', sha: 'f'.repeat(40) }],
    });
    const ref = github.requests.find((request) => request.path === '/repos/acme/app/git/refs');
    expect(ref?.body).toMatchObject({ ref: 'refs/heads/code-zero/issue-12-cz-fixture' });
    const pull = github.requests.find((request) => request.path === '/repos/acme/app/pulls');
    expect(pull?.body).toMatchObject({
      head: 'code-zero/issue-12-cz-fixture',
      base: 'main',
      body: expect.stringContaining('Closes #12.') as unknown,
    });
    // The default branch itself is never updated: the only ref write creates the new branch.
    expect(
      github.requests.filter(
        (request) => request.method !== 'GET' && request.path.includes('heads%2Fmain'),
      ),
    ).toEqual([]);
  });

  it('refuses to publish into a repository the checkout does not track', async () => {
    storeIssueTask(issueEvidence({ taskId: 'cz_confused' }));
    await bindCheckout('https://github.com/donor/library.git');
    const github = fakeGitHubApi();
    await expect(
      openIssuePullRequest('cz_confused', {
        token: 'ghs_token_value',
        checkoutPath: checkout,
        fetch: github.fetch,
      }),
    ).resolves.toMatchObject({
      opened: false,
      reason: expect.stringContaining('checkout tracks donor/library') as unknown,
    });
    expect(github.requests).toEqual([]);
  });

  it('refuses to publish when the checkout has no trusted identity', async () => {
    storeIssueTask(issueEvidence({ taskId: 'cz_unbound' }));
    const github = fakeGitHubApi();
    await expect(
      openIssuePullRequest('cz_unbound', {
        token: 'ghs_token_value',
        checkoutPath: checkout,
        fetch: github.fetch,
      }),
    ).resolves.toMatchObject({
      opened: false,
      reason: expect.stringContaining('trusted origin repository') as unknown,
    });
    expect(github.requests).toEqual([]);
  });

  it('refuses to publish a run that stored no immutable snapshot', async () => {
    storeIssueTask(issueEvidence({ taskId: 'cz_snapshotless' }), null);
    await bindCheckout();
    const github = fakeGitHubApi();
    await expect(
      openIssuePullRequest('cz_snapshotless', {
        token: 'ghs_token_value',
        checkoutPath: checkout,
        fetch: github.fetch,
      }),
    ).resolves.toMatchObject({
      opened: false,
      reason: expect.stringContaining('snapshot') as unknown,
    });
    expect(github.requests).toEqual([]);
  });

  it('refuses to publish an unverified run and sends nothing to GitHub', async () => {
    storeIssueTask(issueEvidence({ taskId: 'cz_unverified', verified: false }));
    const github = fakeGitHubApi();
    await expect(
      openIssuePullRequest('cz_unverified', {
        token: 'ghs_token_value',
        checkoutPath: checkout,
        fetch: github.fetch,
      }),
    ).resolves.toMatchObject({ opened: false, reason: expect.stringContaining('not verified') });
    expect(github.requests).toEqual([]);
  });

  it('reports a missing token instead of publishing anonymously', async () => {
    storeIssueTask(issueEvidence({ taskId: 'cz_tokenless' }));
    const github = fakeGitHubApi();
    await expect(
      openIssuePullRequest('cz_tokenless', {
        token: undefined,
        checkoutPath: checkout,
        fetch: github.fetch,
      }),
    ).resolves.toEqual({ opened: false, reason: 'GITHUB_TOKEN is not configured' });
    expect(github.requests).toEqual([]);
  });

  it('reports an unknown task instead of inventing evidence', async () => {
    const github = fakeGitHubApi();
    await expect(
      openIssuePullRequest('cz_ghost', {
        token: 'ghs_token_value',
        checkoutPath: checkout,
        fetch: github.fetch,
      }),
    ).resolves.toMatchObject({ opened: false, reason: expect.stringContaining('Unknown task') });
    expect(github.requests).toEqual([]);
  });
});

function commentRecorder(): {
  fetch: typeof globalThis.fetch;
  requests: { path: string; body: unknown }[];
} {
  const requests: { path: string; body: unknown }[] = [];
  const handler: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(
      typeof input === 'string' ? input : 'url' in input ? input.url : input.href,
    ).pathname;
    requests.push({
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return new Response('{"id": 7001}', { status: 201 });
  };
  return { fetch: handler, requests };
}

describe('publishIssueValidation', () => {
  it('posts the verdict back on the issue, for rejection as much as confirmation', async () => {
    storeIssueTask(
      issueEvidence({
        taskId: 'cz_rejected',
        verdict: 'rejected',
        verified: false,
        changedFiles: [],
        summary: 'Rejected the report with evidence',
      }),
    );
    const github = commentRecorder();
    await expect(
      publishIssueValidation('cz_rejected', { token: 'ghs_token_value', fetch: github.fetch }),
    ).resolves.toEqual({ posted: true, commentId: 7001 });
    expect(github.requests[0]?.path).toBe('/repos/acme/app/issues/12/comments');
    expect(github.requests[0]?.body).toMatchObject({
      body: expect.stringContaining('**Not confirmed.**') as unknown,
    });
  });

  it('stays silent for a run that failed before reaching a verdict', async () => {
    storeIssueTask(issueEvidence({ taskId: 'cz_broken', state: 'failed' }));
    const github = commentRecorder();
    await expect(
      publishIssueValidation('cz_broken', { token: 'ghs_token_value', fetch: github.fetch }),
    ).resolves.toMatchObject({ posted: false });
    expect(github.requests).toEqual([]);
  });

  it('reports a missing token instead of posting anonymously', async () => {
    storeIssueTask(issueEvidence({ taskId: 'cz_comment_tokenless' }));
    const github = commentRecorder();
    await expect(
      publishIssueValidation('cz_comment_tokenless', { token: undefined, fetch: github.fetch }),
    ).resolves.toEqual({ posted: false, reason: 'GITHUB_TOKEN is not configured' });
    expect(github.requests).toEqual([]);
  });
});

type FetchArguments = Parameters<typeof globalThis.fetch>;

function readBody(body: NonNullable<FetchArguments[1]>['body']): Record<string, unknown> {
  if (typeof body !== 'string') return {};
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? { ...parsed }
    : {};
}

/** Records what would have been sent to GitHub, so no test needs the network. */
function recordingFetch(): {
  fetch: typeof globalThis.fetch;
  bodies: Record<string, unknown>[];
} {
  const bodies: Record<string, unknown>[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    bodies.push(readBody(init?.body));
    return new Response(JSON.stringify({ id: 99 }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, bodies };
}

describe('publishEvidence', () => {
  const target = {
    provider: 'github' as const,
    owner: 'acme',
    repo: 'app',
    number: 7,
    baseSha: 'b'.repeat(40),
    headSha: 'a'.repeat(40),
  };

  it('skips publishing rather than faking a check without a token', async () => {
    const result = await runTask({ repository: checkout, feedback: 'x', mode: 'observe' });
    const { fetch, bodies } = recordingFetch();
    await expect(publishEvidence(target, result.id, { token: undefined, fetch })).resolves.toEqual({
      published: false,
      reason: 'GITHUB_TOKEN is not configured',
    });
    expect(bodies).toEqual([]);
  });

  it('reports an unknown task instead of publishing an empty report', async () => {
    const { fetch, bodies } = recordingFetch();
    await expect(
      publishEvidence(target, 'cz_missing', { token: 'ghs_token_value', fetch }),
    ).resolves.toMatchObject({ published: false });
    expect(bodies).toEqual([]);
  });

  it('publishes the stored evidence without claiming an unverified run passed', async () => {
    const result = await runTask({ repository: checkout, feedback: 'x', mode: 'observe' });
    const { fetch, bodies } = recordingFetch();
    await expect(
      publishEvidence(target, result.id, { token: 'ghs_token_value', fetch }),
    ).resolves.toEqual({ published: true });
    expect(bodies[0]).toMatchObject({ head_sha: target.headSha, status: 'completed' });
    expect(bodies[0]?.conclusion).not.toBe('success');
  });

  it('surfaces an explicit degradation on a provider without a neutral state', async () => {
    const result = await runTask({ repository: checkout, feedback: 'x', mode: 'observe' });
    const { fetch, bodies } = recordingFetch();
    const outcome = await publishEvidence({ ...target, provider: 'gitlab' as const }, result.id, {
      token: 'glpat_token_value',
      fetch,
    });
    expect(outcome.published).toBe(true);
    expect(outcome.reason).toContain('no neutral state');
    expect(bodies[0]?.state).toBe('success');
  });

  it('resolves independent credentials for the two Bitbucket products', () => {
    const originalCloud = process.env.BITBUCKET_CLOUD_TOKEN;
    const originalDataCenter = process.env.BITBUCKET_DATA_CENTER_TOKEN;
    try {
      process.env.BITBUCKET_CLOUD_TOKEN = 'cloud-credential';
      process.env.BITBUCKET_DATA_CENTER_TOKEN = 'data-center-credential';
      expect(statusTokenFromEnvironment('bitbucket-cloud')).toBe('cloud-credential');
      expect(statusTokenFromEnvironment('bitbucket-data-center')).toBe('data-center-credential');
    } finally {
      if (originalCloud === undefined) delete process.env.BITBUCKET_CLOUD_TOKEN;
      else process.env.BITBUCKET_CLOUD_TOKEN = originalCloud;
      if (originalDataCenter === undefined) delete process.env.BITBUCKET_DATA_CENTER_TOKEN;
      else process.env.BITBUCKET_DATA_CENTER_TOKEN = originalDataCenter;
    }
  });
});
