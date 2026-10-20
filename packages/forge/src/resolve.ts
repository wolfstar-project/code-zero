import type { ForgeProvider, Thread, ThreadRef } from 'forges';

import type { ChangeRequestRef, ForgeKind, IssueEvent } from './contracts.js';
import { guarded } from './errors.js';
import { providerSecrets } from './registry.js';
import {
  MAX_ISSUE_BODY,
  MAX_ISSUE_TITLE,
  readBody,
  readNumber,
  readSha,
  refuseAuthor,
  type AuthorFilter,
} from './untrusted.js';

export type Resolved<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Reads each thread once per delivery.
 *
 * A delivery names a thread but not its commits, so the forge's own record is read for them; that
 * record is also what a run should trust over the payload that announced it.
 */
export class ThreadReader {
  private readonly threads = new Map<string, Promise<Thread>>();

  constructor(
    private readonly kind: ForgeKind,
    private readonly provider: ForgeProvider,
  ) {}

  read(ref: ThreadRef): Promise<Thread> {
    const key = `${ref.kind}:${ref.repo.owner}/${ref.repo.name}#${ref.number ?? ''}`;
    let thread = this.threads.get(key);
    if (!thread) {
      thread = guarded(this.kind, providerSecrets(this.provider), 'thread read', () =>
        this.provider.threads.get(ref),
      );
      this.threads.set(key, thread);
    }
    return thread;
  }
}

/** The change request a thread describes, with the commits a review reads. */
export function changeRequestFrom(kind: ForgeKind, thread: Thread): Resolved<ChangeRequestRef> {
  const number = readNumber(thread.ref.number);
  const headSha = readSha(thread.branches?.head.sha);
  if (number === undefined || headSha === undefined)
    return { ok: false, reason: 'the change request has no readable number or head commit' };
  if (thread.state !== 'open')
    return { ok: false, reason: `the change request is ${thread.state}` };
  const baseSha = readSha(thread.branches?.base.sha);
  return {
    ok: true,
    value: {
      forge: kind,
      instance: thread.ref.instance,
      owner: thread.ref.repo.owner,
      repo: thread.ref.repo.name,
      number,
      headSha,
      ...(baseSha === undefined ? {} : { baseSha }),
    },
  };
}

/**
 * The issue task a thread describes, when policy lets it become one.
 *
 * Scoping is explicit: an issue that does not carry `requireLabel` is ignored, so arbitrary issue
 * text can never start a run. The author filter applies to the issue's author, who wrote the text,
 * rather than to whoever happened to label it.
 */
export function issueFrom(
  kind: ForgeKind,
  thread: Thread,
  requireLabel: string,
  filter: AuthorFilter,
): Resolved<IssueEvent> {
  const number = readNumber(thread.ref.number);
  if (thread.kind !== 'issue' || number === undefined)
    return { ok: false, reason: 'the thread is not a readable issue' };
  if (thread.state !== 'open') return { ok: false, reason: `the issue is ${thread.state}` };
  const labels = thread.labels.map((label) => label.name).filter((name) => name.length > 0);
  const required = requireLabel.trim().toLowerCase();
  if (!labels.some((label) => label.toLowerCase() === required))
    return { ok: false, reason: `the issue does not carry the ${requireLabel} label` };
  const refused = refuseAuthor(thread.author, filter);
  if (refused !== null) return { ok: false, reason: refused };
  const title = readBody(thread.title, MAX_ISSUE_TITLE);
  if (title === null) return { ok: false, reason: 'the issue has no title' };
  return {
    ok: true,
    value: {
      forge: kind,
      trigger: 'issue',
      instance: thread.ref.instance,
      issue: { owner: thread.ref.repo.owner, repo: thread.ref.repo.name, number },
      title,
      body: readBody(thread.body, MAX_ISSUE_BODY) ?? '',
      author: thread.author?.login ?? '',
      labels,
    },
  };
}
