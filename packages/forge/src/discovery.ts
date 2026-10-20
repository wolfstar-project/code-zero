import type { Cursor, Thread } from 'forges';

import type { ForgeRepository } from './contracts.js';
import { ForgeConfigurationError, guarded } from './errors.js';
import { repoRef } from './refs.js';
import { providerFor, providerSecrets, type ForgeRegistry } from './registry.js';
import { readNumber, readSha } from './untrusted.js';

/**
 * An open change request, reduced to what deciding whether to review it needs.
 *
 * Deliberately not the forge's thread: a caller reasons about the head commit and the identifiers,
 * and passing the library's object through would put an SDK shape into the runtime's vocabulary.
 */
export interface OpenChangeRequest {
  number: number;
  title: string;
  /** The commit under review. A new one is what makes a change request worth looking at again. */
  headSha: string;
  headRef: string;
  /** Absent when the forge's listing does not report it; a caller that needs it reads the thread. */
  baseSha?: string;
  url: string;
  draft: boolean;
}

export interface DiscoveryOptions {
  /**
   * Pages read at most. Caps one poll's worst case for a repository with an unbounded number of
   * open change requests rather than walking every page that exists.
   */
  maxPages?: number;
  perPage?: number;
}

export interface DiscoveryResult {
  changeRequests: OpenChangeRequest[];
  /** True when `maxPages` ran out before the forge's listing did. */
  truncated: boolean;
}

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_PER_PAGE = 100;

/**
 * Every open change request of a repository, most recently updated first.
 *
 * Read-only, and the only thing here that goes looking for work rather than publishing it. Pages
 * are walked rather than stopping at the first: sorted by update, a change request past page one
 * only reaches page one once something touches it again, so a poller that read one page could leave
 * an old, otherwise untouched change request unreviewed forever. A record without a number or a
 * commit-shaped head is skipped rather than raised, so one malformed entry does not cost the page.
 */
export async function listOpenChangeRequests(
  registry: ForgeRegistry,
  target: ForgeRepository,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  if (!Number.isInteger(maxPages) || maxPages < 1)
    throw new ForgeConfigurationError(target.forge, 'maxPages must be a positive integer');
  const provider = providerFor(registry, target);
  if (!provider.can('threads.listPage', 'pull_request'))
    throw new ForgeConfigurationError(target.forge, 'this connection cannot list change requests');

  const repo = repoRef(target);
  const changeRequests: OpenChangeRequest[] = [];
  let cursor: Cursor | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const query = {
      kind: 'pull_request' as const,
      state: 'open' as const,
      sort: 'updated' as const,
      direction: 'desc' as const,
      perPage,
      ...(cursor === undefined ? {} : { cursor }),
    };
    const result = await guarded(target.forge, providerSecrets(provider), 'listing', () =>
      provider.threads.listPage(repo, query),
    );
    for (const thread of result.items) {
      const open = openChangeRequest(thread);
      if (open) changeRequests.push(open);
    }
    cursor = result.cursor;
    if (cursor === undefined) return { changeRequests, truncated: false };
  }
  return { changeRequests, truncated: true };
}

function openChangeRequest(thread: Thread): OpenChangeRequest | undefined {
  const number = readNumber(thread.ref.number);
  const headSha = readSha(thread.branches?.head.sha);
  const headRef = thread.branches?.head.ref ?? '';
  if (number === undefined || headSha === undefined || headRef.length === 0) return undefined;
  const baseSha = readSha(thread.branches?.base.sha);
  return {
    number,
    title: thread.title,
    headSha,
    headRef,
    ...(baseSha === undefined ? {} : { baseSha }),
    url: thread.url ?? '',
    draft: thread.isDraft,
  };
}
