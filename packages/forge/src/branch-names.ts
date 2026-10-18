/**
 * Git ref names Code Zero is willing to create.
 *
 * Deliberately stricter than git itself: alphanumeric segments joined by `.`, `_`, `-`, and `/`.
 * Everything a ref cannot carry — and several things it technically could — is refused, because a
 * branch name assembled from external input must never smuggle unexpected ref syntax.
 */
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

export function isSafeBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !name.includes('..') &&
    !name.endsWith('.lock') &&
    SAFE_BRANCH.test(name)
  );
}

export function assertSafeBranchName(name: string): void {
  if (!isSafeBranchName(name)) throw new Error(`Refusing to use unsafe branch name: ${name}`);
}

/**
 * The isolated branch a verified issue task publishes its changes on.
 *
 * The name is assembled only from operator policy (the prefix), the issue number, and the
 * runtime-generated task identifier — never from issue text — and is still validated as a whole
 * so no input combination can produce unexpected ref syntax.
 */
export function issueBranchName(
  prefix: string,
  issueNumber: number,
  taskIdentifier: string,
): string {
  const suffix = taskIdentifier
    .toLowerCase()
    .replaceAll(NON_ALPHANUMERIC, '-')
    .replaceAll(EDGE_DASHES, '');
  const name = `${prefix}issue-${String(issueNumber)}${suffix.length > 0 ? `-${suffix}` : ''}`;
  assertSafeBranchName(name);
  return name;
}
