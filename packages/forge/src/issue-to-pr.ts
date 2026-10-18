import { isRepositoryRelativePath, type EvidenceBundle } from '@code-zero/shared';

import { assertSafeBranchName, issueBranchName } from './branch-names.js';
import { commitFilesOf, type FileChange } from './commit-files.js';
import type { ForgeRepository } from './contracts.js';
import { guarded } from './errors.js';
import { prepareIssuePullRequest } from './issue-gate.js';
import { issueThread, repoRef } from './refs.js';
import { providerFor, providerSecrets, type ForgeRegistry } from './registry.js';
import { readNumber } from './untrusted.js';

/**
 * One file of the published change set. `contentBase64` carries the complete new file bytes as
 * base64, so binary files survive; `null` records a deletion.
 */
export interface BranchFile {
  path: string;
  contentBase64: string | null;
}

export interface IssuePullRequestRequest {
  repository: ForgeRepository;
  /** The finished run. Its issue, verdict, and verification decide whether anything is published. */
  bundle: EvidenceBundle;
  /** Operator policy, normally `issues.branchPrefix`. */
  branchPrefix: string;
  /** The runtime-generated task identifier, so a re-run gets a branch of its own. */
  taskIdentifier: string;
  /** The verified contents of every changed file, read through a read-only runner. */
  files: readonly BranchFile[];
  /** The branch to start from and target. The repository's default branch when omitted. */
  base?: string;
}

export type IssuePullRequestOutcome =
  | { status: 'opened'; branch: string; number: number; url?: string }
  | { status: 'not-ready' | 'unsupported'; reason: string };

// Standard base64 with optional padding; anything else is a caller bug, refused before any request.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Publish a verified issue run as a commit on a fresh branch and a pull request against the base.
 *
 * `prepareIssuePullRequest` decides first, so nothing is published for a run that has not earned
 * it. The branch is created by the commit itself (`createFrom`), which fails when it already
 * exists, so a re-run never rewrites a branch that may be under review and the base branch is
 * never committed to. Each forge operation is checked with the provider before it is attempted,
 * and a forge or a `forges` release that lacks one is an explicit `unsupported` outcome.
 */
export async function publishIssuePullRequest(
  registry: ForgeRegistry,
  request: IssuePullRequestRequest,
): Promise<IssuePullRequestOutcome> {
  const { bundle, repository } = request;
  const provider = providerFor(registry, repository);
  const issue = bundle.issue;
  const reference = issue
    ? provider.referenceTo(issueThread({ ...repository, issue }), { from: repoRef(repository) })
    : undefined;
  const readiness = prepareIssuePullRequest(bundle, reference);
  if (!readiness.ready || !issue)
    return {
      status: 'not-ready',
      reason: readiness.ready ? 'The run has no issue.' : readiness.reason,
    };

  const branch = issueBranchName(request.branchPrefix, issue.number, request.taskIdentifier);
  const changes = fileChanges(request.files);

  const commitFiles = commitFilesOf(provider);
  if (!commitFiles)
    return {
      status: 'unsupported',
      reason: `${repository.forge} cannot commit files through this forges release (contents.commitFiles)`,
    };
  if (!provider.can('threads.create', 'pull_request'))
    return { status: 'unsupported', reason: `${repository.forge} cannot open pull requests here` };

  const secrets = providerSecrets(provider);
  const repo = repoRef(repository);
  const base = request.base ?? (await defaultBranch(registry, repository));
  if (base === undefined)
    return { status: 'unsupported', reason: `${repository.forge} reported no default branch` };
  assertSafeBranchName(base);
  if (base === branch) throw new Error('Refusing to publish onto the base branch');

  await guarded(repository.forge, secrets, 'commit', () =>
    commitFiles(repo, {
      branch,
      createFrom: base,
      message: `${readiness.title}\n\nCloses ${reference ?? `#${String(issue.number)}`}.`,
      changes,
    }),
  );
  const thread = await guarded(repository.forge, secrets, 'pull request creation', () =>
    provider.threads.create(repo, {
      kind: 'pull_request',
      title: readiness.title,
      body: readiness.body,
      head: branch,
      base,
    }),
  );
  const number = readNumber(thread.ref.number);
  if (number === undefined) throw new Error(`${repository.forge} did not return the pull request`);
  return {
    status: 'opened',
    branch,
    number,
    ...(thread.url === undefined ? {} : { url: thread.url }),
  };
}

function fileChanges(files: readonly BranchFile[]): FileChange[] {
  if (files.length === 0) throw new Error('Refusing to publish a branch with no changed files');
  return files.map((file) => {
    if (!isRepositoryRelativePath(file.path))
      throw new Error(`Changed path is not inside the repository: ${file.path}`);
    if (file.contentBase64 === null) return { path: file.path, content: null };
    if (!BASE64.test(file.contentBase64))
      throw new Error(`Changed file content is not base64: ${file.path}`);
    return { path: file.path, content: Buffer.from(file.contentBase64, 'base64') };
  });
}

async function defaultBranch(
  registry: ForgeRegistry,
  repository: ForgeRepository,
): Promise<string | undefined> {
  const provider = providerFor(registry, repository);
  if (!provider.can('repos.get')) return undefined;
  const repo = await guarded(repository.forge, providerSecrets(provider), 'repository read', () =>
    provider.repos.get(repoRef(repository)),
  );
  return repo.defaultBranch;
}
