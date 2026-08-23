import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The checkout's own answer for a field no hosting provider supplied.
 *
 * This is a contributor build command, not a runtime one: it is read once while a bundle is being
 * produced, from the directory the build was started in, and never from a target repository. The
 * runner boundary that owns runtime command execution is not involved, and must not be — nothing
 * here may run inside a deployed bundle.
 *
 * `execFile` rather than `exec`: the arguments are a fixed array passed to `git` directly, with no
 * shell to reinterpret a branch or path that contains shell metacharacters.
 */
async function git(argv: readonly string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', [...argv], { cwd, windowsHide: true });
    return stdout.trim() || null;
  } catch {
    // Every caller has a fallback, and a build has no business failing because it ran outside a
    // checkout: a shallow clone, a source tarball, and a container build context all land here.
    return null;
  }
}

/** What the checkout can say about the commit being built. */
export interface GitMetadata {
  readonly branch: string | null;
  readonly commit: string | null;
}

/**
 * Reads the branch and commit from the checkout at `directory`.
 *
 * Only called for fields the environment left unresolved, so a hosted build never pays for two
 * subprocesses to rediscover what its provider already told it — and a detached checkout, which is
 * what most CI providers hand a build, never overrides the branch name the provider knows.
 */
export async function gitMetadata(directory: string): Promise<GitMetadata> {
  const [branch, commit] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD'], directory),
    git(['rev-parse', 'HEAD'], directory),
  ]);

  return {
    // `git rev-parse --abbrev-ref HEAD` answers `HEAD` on a detached checkout, which is not a
    // branch name and would be published as one.
    branch: branch === 'HEAD' ? null : branch,
    commit,
  };
}
