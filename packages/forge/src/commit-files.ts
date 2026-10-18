import type { ForgeProvider, RepoRef, Support } from 'forges';

/** One file of a commit: its complete new bytes, or `null` to delete it. */
export interface FileChange {
  path: string;
  content: Uint8Array | null;
}

/** The commit `contents.commitFiles()` makes, as forges.link documents it. */
export interface CommitFilesInput {
  branch: string;
  message: string;
  changes: FileChange[];
  /** Creates `branch` from this ref. The branch must not exist yet. */
  createFrom: string;
}

export type CommitFiles = (repo: RepoRef, input: CommitFilesInput) => Promise<unknown>;

function isCommitFiles(value: unknown): value is CommitFiles {
  return typeof value === 'function';
}

/**
 * The declared support of `contents.commitFiles`, read from the capabilities object.
 *
 * `forges` 0.1.x documents the verb but does not ship it: `can('contents.commitFiles')` throws an
 * unknown-verb error there. Reading the entry directly answers `false` today and the real level
 * once a release declares it, without a type assertion against a verb the types do not know.
 */
export function commitFilesSupport(provider: ForgeProvider): Support {
  const entry = Object.entries(provider.capabilities.contents).find(
    ([name]) => name === 'commitFiles',
  )?.[1];
  return entry ?? false;
}

/** The provider's `contents.commitFiles()`, or undefined while the release lacks it. */
export function commitFilesOf(provider: ForgeProvider): CommitFiles | undefined {
  if (commitFilesSupport(provider) === false) return undefined;
  const contents: object = provider.contents;
  const candidate: unknown = 'commitFiles' in contents ? contents.commitFiles : undefined;
  if (!isCommitFiles(candidate)) return undefined;
  return async (repo, input) => candidate.call(contents, repo, input);
}
