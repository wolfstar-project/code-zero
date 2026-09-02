import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  isRepositoryRelativePath,
  redactSecrets,
  secretValuesFromEnvironment,
  truncateHead,
  truncateTail,
  type CheckResult,
  type NetworkPolicy,
  type RunnerDescription,
} from '@code-zero/shared';

import { execFileProcessRunner, type ProcessOutcome, type ProcessRunner } from './process.js';

/** Raised when a path would address something outside the validated checkout. */
export class PathEscapeError extends Error {
  constructor(path: string, reason: string) {
    super(`Path escapes repository (${reason}): ${path}`);
    this.name = 'PathEscapeError';
  }
}

/** Raised when a write is attempted through a runner that policy created read-only. */
export class RunnerWriteDeniedError extends Error {
  constructor(path: string, reason: string) {
    super(`Write denied for ${path}: ${reason}`);
    this.name = 'RunnerWriteDeniedError';
  }
}

/**
 * The single boundary between the runtime and a target checkout.
 *
 * Everything that reads a file, writes a file, or executes a command passes through an
 * implementation of this interface. No other package may touch the checkout.
 */
export interface Runner {
  /** What this boundary is actually allowed to do, recorded in run evidence. */
  describe(): RunnerDescription;
  /** A bounded summary of the checkout for model context. */
  context(options?: RepositoryContextOptions): Promise<string>;
  /** Files in the working-tree or committed pull-request diff under review. */
  reviewFiles(options?: RepositoryContextOptions): Promise<string[]>;
  read(path: string): Promise<string>;
  /** The file's exact bytes, for content that must survive republication byte-for-byte. */
  readBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<void>;
  check(command: string, timeoutMs: number): Promise<CheckResult>;
  changedFiles(): Promise<string[]>;
}

/** Selects a committed pull-request diff instead of the default working-tree diff. */
export interface RepositoryContextOptions {
  baseSha?: string;
  headSha?: string;
}

export interface BoundaryOptions {
  /** When false, every write is refused. This is how `observe` is enforced mechanically. */
  writable: boolean;
  network: NetworkPolicy;
  maxOutputBytes?: number;
  process?: ProcessRunner;
  /** Extra literal values to redact from captured output. Defaults to the process environment. */
  secrets?: readonly string[];
}

const DEFAULT_MAX_OUTPUT_BYTES = 200_000;
const MAX_FILE_LIST = 30_000;
const MAX_DIFF = 100_000;
const GIT_TIMEOUT_MS = 30_000;
const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
// `diff --git` headers only ever start a line at column zero; every content line carries a
// one-character prefix, so this boundary cannot fire inside a patch body.
const FILE_PATCH_BOUNDARY = /\n(?=diff --git )/;
// Characters that would break a synthetic single-line `diff --git` header (see unavailablePatch).
const HEADER_UNSAFE = /[\n\r\t"\\]/;
// Not defined on every platform; opening still works there, the descriptor re-check remains.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_DIRECTORY = constants.O_DIRECTORY ?? 0;

/**
 * Shared filesystem and git behavior for every runner.
 *
 * File access is validated with path arithmetic, re-validated against resolved symlinks, and then
 * proven again on the open descriptor itself, so a link planted inside the checkout, even one
 * swapped in concurrently after validation, cannot be used to read or write outside it. Writes go
 * further: they are committed through a verified directory descriptor rather than a descriptor on
 * the target file, so containment holds for the mutation's full lifetime, not only at open time.
 * Subclasses decide only how repository commands are executed.
 */
export abstract class RepositoryBoundary implements Runner {
  protected readonly maxOutputBytes: number;
  protected readonly process: ProcessRunner;
  private readonly secrets: readonly string[];
  private resolvedRoot: string | undefined;

  protected constructor(
    protected readonly root: string,
    protected readonly options: BoundaryOptions,
  ) {
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.process = options.process ?? execFileProcessRunner;
    this.secrets = options.secrets ?? secretValuesFromEnvironment();
  }

  abstract describe(): RunnerDescription;
  abstract check(command: string, timeoutMs: number): Promise<CheckResult>;

  async read(path: string): Promise<string> {
    const handle = await this.openInside(path, constants.O_RDONLY);
    try {
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  }

  /**
   * Unlike {@link read}, no encoding is applied: invalid UTF-8 sequences survive untouched, so a
   * binary change captured through this method republishes with exactly the verified bytes.
   */
  async readBytes(path: string): Promise<Uint8Array> {
    const handle = await this.openInside(path, constants.O_RDONLY);
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(await this.resolveInside(path));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A write never mutates the target inode through a previously validated descriptor: a rename by
   * a concurrent task would carry that inode outside the checkout and the write would follow it.
   * Instead the parent directory is opened and proven to be inside the checkout, and the mutation
   * is committed through that held descriptor, whose inode no rename can substitute.
   */
  async write(path: string, content: string): Promise<void> {
    if (!this.options.writable)
      throw new RunnerWriteDeniedError(path, 'this runner was created read-only');
    const target = await this.resolveInside(path);
    await this.createDirectories(target, path);
    const root = await this.rootRealPath();
    const parent = await realpath(dirname(target));
    assertInside(root, parent, path);
    const dir = await open(parent, constants.O_RDONLY | O_DIRECTORY);
    try {
      assertInside(root, await descriptorPath(dir, parent, path), path);
      await this.replaceInside(dir, parent, basename(target), content, path);
    } finally {
      await dir.close();
    }
  }

  async context(options: RepositoryContextOptions = {}): Promise<string> {
    const diffRange = contextDiffRange(options);
    const files = await this.git(['ls-files']);
    const changedFiles = await this.reviewFiles(options);
    const patches =
      diffRange.length > 0
        ? splitFilePatches((await this.git(['diff', '--no-ext-diff', ...diffRange, '--'])).stdout)
        : await this.pendingPatches();
    return [
      'FILES',
      truncateTail(files.stdout, MAX_FILE_LIST),
      '',
      'CHANGED FILES',
      truncateTail(changedFiles.join('\n'), MAX_FILE_LIST),
      '',
      'DIFF',
      boundedDiff(patches, MAX_DIFF),
    ].join('\n');
  }

  async reviewFiles(options: RepositoryContextOptions = {}): Promise<string[]> {
    const diffRange = contextDiffRange(options);
    // A committed pull-request range fixes the reviewed set. Without one, the pending local
    // changes are the review target, and a plain `git diff` alone would silently omit index-only
    // changes and untracked files. Every listing is NUL-delimited (`-z`): newline-delimited git
    // output C-quotes names containing characters such as newlines or tabs, and that display
    // representation is not a filesystem path.
    const listings =
      diffRange.length > 0
        ? [await this.git(['diff', '--name-only', '-z', ...diffRange, '--'])]
        : [
            await this.git(['diff', '--name-only', '-z', '--cached', '--']),
            await this.git(['diff', '--name-only', '-z', '--']),
            await this.git(['ls-files', '-z', '--others', '--exclude-standard']),
          ];
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const listing of listings)
      for (const path of listing.stdout.split('\0')) {
        if (path.length === 0 || !isRepositoryRelativePath(path) || seen.has(path)) continue;
        seen.add(path);
        paths.push(path);
      }
    return paths;
  }

  /**
   * The full pending local diff, one final-state patch per file.
   *
   * A single HEAD-to-working-tree diff covers staged and unstaged edits together; joining the
   * `--cached` and working-tree layers instead would emit two overlapping patches for a
   * partially-staged file and expose the intermediate staged value as though it were a separate
   * edit. Untracked files appear in no git diff at all, so each one gets a synthetic
   * creation patch (see {@link untrackedPatches}).
   */
  private async pendingPatches(): Promise<string[]> {
    const tracked = await this.git(['diff', '--no-ext-diff', 'HEAD', '--']);
    const patches = splitFilePatches(
      tracked.exitCode === 0 ? tracked.stdout : await this.unbornDiff(),
    );
    patches.push(...(await this.untrackedPatches()));
    return patches;
  }

  /**
   * The pending diff of a repository whose HEAD is unborn (no commit to diff against).
   *
   * Joining the `--cached` and working-tree layers here would emit two overlapping patches for a
   * partially-staged file and expose the staged intermediate value as though it were a separate
   * edit. Diffing the empty tree against the working tree instead renders one final-state
   * creation patch per tracked file. The empty-tree id is computed rather than hardcoded so the
   * fallback also holds in SHA-256 repositories.
   */
  private async unbornDiff(): Promise<string> {
    const emptyTree = await this.git(['hash-object', '-t', 'tree', '/dev/null']);
    if (emptyTree.exitCode !== 0) return '';
    return (await this.git(['diff', '--no-ext-diff', emptyTree.stdout.trim(), '--'])).stdout;
  }

  /**
   * A synthetic creation patch for each untracked file included in a range-less review.
   *
   * {@link reviewFiles} lists untracked paths as review targets, so their content must reach the
   * reviewer too; `git diff --no-index` against `/dev/null` renders the same new-file patch a
   * commit would produce. The listing is NUL-delimited (`-z`) and parsed verbatim: git C-quotes
   * names containing characters such as newlines or tabs in newline-delimited output, and that
   * display representation would not open as a filesystem path. Every listed file is collected:
   * the diff budget is allocated per file by {@link boundedDiff}, so an early stop here would
   * silently drop later files' patches that the allocation would have kept while
   * {@link reviewFiles} still publishes their paths as review targets. For the same reason a
   * file whose diff fails or renders nothing gets an explicit stand-in patch (see
   * {@link unavailablePatch}) rather than a silent omission.
   */
  private async untrackedPatches(): Promise<string[]> {
    const listing = await this.git(['ls-files', '-z', '--others', '--exclude-standard']);
    const patches: string[] = [];
    for (const path of listing.stdout.split('\0')) {
      if (path.length === 0 || !isRepositoryRelativePath(path)) continue;
      // `--no-index` exits 1 when the paths differ, which is the expected outcome here; only
      // larger codes report a real failure.
      const outcome = await this.process(
        'git',
        ['diff', '--no-ext-diff', '--no-index', '--', '/dev/null', path],
        { cwd: this.root, timeoutMs: GIT_TIMEOUT_MS, maxOutputBytes: this.maxOutputBytes },
      );
      if (outcome.exitCode > 1) patches.push(unavailablePatch(path, 'git diff --no-index failed'));
      else if (outcome.stdout.length === 0)
        patches.push(unavailablePatch(path, 'git diff --no-index rendered no patch'));
      else patches.push(outcome.stdout);
    }
    return patches;
  }

  /**
   * The `owner/repo` identity recorded in the checkout's own git metadata.
   *
   * The `origin` remote URL is trusted local state: it was written when the checkout was created,
   * not supplied by a webhook. Callers use it to bind a checkout to the repository an event claims
   * to be about, so this fails closed: a checkout without exactly one parseable `origin` URL has
   * no identity and returns null rather than a guess.
   */
  async originRepository(): Promise<{ owner: string; repo: string } | null> {
    const outcome = await this.git(['remote', 'get-url', 'origin']);
    if (outcome.exitCode !== 0) return null;
    const urls = outcome.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const url = urls[0];
    if (urls.length !== 1 || url === undefined) return null;
    return parseRemoteRepository(url);
  }

  async changedFiles(): Promise<string[]> {
    const status = await this.git(['status', '--porcelain']);
    return status.stdout
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        // Renames are reported as `old -> new`; the new path is the one that exists now.
        const arrow = line.indexOf(' -> ');
        return arrow === -1 ? line : line.slice(arrow + 4);
      });
  }

  /** Turn a raw process outcome into bounded, credential-free evidence. */
  protected toCheckResult(
    command: string,
    outcome: ProcessOutcome,
    durationMs: number,
  ): CheckResult {
    return {
      command,
      exitCode: outcome.exitCode,
      stdout: this.clean(outcome.stdout),
      stderr: this.clean(outcome.stderr),
      durationMs,
    };
  }

  protected clean(text: string): string {
    return redactSecrets(truncateTail(text, this.maxOutputBytes), this.secrets);
  }

  /**
   * Git inspection runs in the trusting process because its argv is fixed by this package.
   *
   * Repository-supplied commands are the untrusted ones, and those are what an isolated runner
   * moves into a sandbox.
   */
  private async git(args: readonly string[]): Promise<ProcessOutcome> {
    const outcome = await this.process('git', args, {
      cwd: this.root,
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: this.maxOutputBytes,
    });
    // A checkout without git history is still inspectable; report the reason instead of failing the
    // whole run.
    if (outcome.exitCode !== 0)
      return { exitCode: outcome.exitCode, stdout: '', stderr: this.clean(outcome.stderr) };
    return outcome;
  }

  /**
   * Open a validated path and prove that the open descriptor itself is inside the checkout.
   *
   * Validation alone races the operation: a concurrent task can swap a validated component for a
   * symlink between the check and the open. The parent directory is therefore re-resolved
   * immediately before opening, the final component is opened with `O_NOFOLLOW`, and containment
   * is re-checked on the descriptor before any content moves through it. This is sufficient for
   * reads, whose content is fixed at open time; writes must not reuse it (see {@link write}).
   */
  private async openInside(path: string, flags: number): Promise<FileHandle> {
    const target = await this.resolveInside(path);
    const root = await this.rootRealPath();
    const parent = await realpath(dirname(target));
    assertInside(root, parent, path);
    const opened = join(parent, basename(target));
    const handle = await open(opened, flags | O_NOFOLLOW);
    try {
      assertInside(root, await descriptorPath(handle, opened, path), path);
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /**
   * Replace one entry of an already-verified directory descriptor with new content.
   *
   * Content is staged into a fresh, exclusively-created temporary inode and committed with an
   * atomic rename, and both names resolve through the held descriptor (`/proc/self/fd` on Linux),
   * never through re-walked path components. The target inode itself is never written, so a
   * concurrent rename carrying it outside the checkout after validation moves nothing but the
   * previous content. Platforms that cannot anchor the rename to the descriptor refuse the write
   * (see {@link directoryAnchor}).
   *
   * Protected so that tests can interleave an adversarial rename at exactly this point.
   */
  protected async replaceInside(
    directory: FileHandle,
    parent: string,
    targetName: string,
    content: string,
    original: string,
  ): Promise<void> {
    const anchor = await directoryAnchor(directory, original);
    const temporaryName = `.code-zero-${randomUUID()}.tmp`;
    const temporary = join(anchor, temporaryName);
    const target = join(anchor, targetName);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  /**
   * Create the missing directories above a write target, one validated component at a time.
   *
   * A recursive `mkdir` follows a symlink swapped into any component and builds the tree outside
   * the checkout, so each level is created individually and re-checked once it exists.
   */
  private async createDirectories(target: string, original: string): Promise<void> {
    const root = await this.rootRealPath();
    let current = root;
    for (const segment of relative(root, dirname(target)).replaceAll('\\', '/').split('/')) {
      if (segment.length === 0) continue;
      current = join(current, segment);
      try {
        await mkdir(current);
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
      if ((await lstat(current)).isSymbolicLink()) {
        const real = await realpath(current);
        assertInside(root, real, original);
        current = real;
      }
    }
  }

  /**
   * Resolve a repository-relative path, refusing anything that leaves the checkout.
   *
   * Three independent gates apply: the shared path predicate, path arithmetic against the resolved
   * root, and a realpath check on the closest existing ancestor so that symlinks cannot be used to
   * step outside. This is a pre-check; {@link openInside} couples containment to the operation.
   */
  protected async resolveInside(path: string): Promise<string> {
    if (!isRepositoryRelativePath(path))
      throw new PathEscapeError(path, 'not a repository-relative path');
    const root = await this.rootRealPath();
    const target = resolve(root, path);
    assertInside(root, target, path);
    assertInside(root, await closestRealPath(target), path);
    return target;
  }

  private async rootRealPath(): Promise<string> {
    this.resolvedRoot ??= await realpath(this.root);
    return this.resolvedRoot;
  }
}

function contextDiffRange(options: RepositoryContextOptions): string[] {
  const { baseSha, headSha } = options;
  if (baseSha === undefined && headSha === undefined) return [];
  if (!baseSha || !headSha || !COMMIT_SHA.test(baseSha) || !COMMIT_SHA.test(headSha))
    throw new Error('Repository context requires valid base and head commit SHAs');
  return [`${baseSha}...${headSha}`];
}

/** Split a multi-file git diff into one patch per file (see {@link FILE_PATCH_BOUNDARY}). */
function splitFilePatches(diff: string): string[] {
  if (diff.length === 0) return [];
  return diff.split(FILE_PATCH_BOUNDARY).filter((patch) => patch.length > 0);
}

/**
 * Join per-file patches under a shared budget without letting one file evict another.
 *
 * A single tail-keeping truncation of the joined diff would let one oversized patch push an
 * earlier file's patch out entirely while the changed-file list still names that file as a review
 * target. Instead the budget is allocated per patch: small patches keep everything and the
 * surplus is shared among the larger ones. Every rendered patch keeps at least its complete first
 * line (the `diff --git` header naming the file), because a fragment shorter than the header
 * could not be attributed to any changed-file entry. When the budget cannot fit every header, the
 * trailing patches lose their bodies but never their identity: each one still renders its
 * complete header line over an explicit omission marker, so every path the changed-file list
 * names stays attributable in the diff. That overrun is deliberate and bounded by the same
 * per-file header data the changed-file list already carries.
 */
function boundedDiff(patches: readonly string[], budget: number): string {
  if (patches.length === 0) return '';
  const joined = patches.join('\n');
  if (joined.length <= budget) return joined;
  const headers = patches.map((patch) => {
    const end = patch.indexOf('\n');
    return end === -1 ? patch.length : end;
  });
  // Retain the leading patches whose complete header lines all fit within the budget.
  let reserved = 0;
  let retained = 0;
  while (retained < patches.length) {
    const cost = (headers[retained] ?? 0) + (retained > 0 ? 1 : 0);
    if (reserved + cost > budget) break;
    reserved += cost;
    retained += 1;
  }
  const kept = patches.slice(0, retained);
  let remaining = budget - reserved;
  let left = retained;
  const allocations = kept.map((_, index) => headers[index] ?? 0);
  const bySize = kept
    .map((patch, index) => ({ length: patch.length, index }))
    .toSorted((a, b) => a.length - b.length);
  for (const { length, index } of bySize) {
    const extra = Math.min(
      Math.max(length - (allocations[index] ?? 0), 0),
      Math.floor(remaining / left),
    );
    allocations[index] = (allocations[index] ?? 0) + extra;
    remaining -= extra;
    left -= 1;
  }
  const rendered = kept.map((patch, index) => truncateHead(patch, allocations[index] ?? 0));
  for (let index = retained; index < patches.length; index += 1) {
    const header = (patches[index] ?? '').slice(0, headers[index] ?? 0);
    rendered.push(`${header}\n[file patch omitted beyond the diff budget]`);
  }
  return rendered.join('\n');
}

/**
 * An explicit stand-in patch for an untracked file whose synthetic diff could not be produced.
 *
 * {@link reviewFiles} publishes every untracked path as a review target, so silently skipping a
 * failed or empty `git diff --no-index` would leave a target selectable without any reviewable
 * content behind it. The stand-in keeps the `diff --git` header shape that {@link boundedDiff}
 * preserves for attribution and declares the omission instead of hiding it. A name containing
 * characters such as newlines is rendered in its quoted display form so the header stays a
 * single attributable line.
 */
function unavailablePatch(path: string, reason: string): string {
  const name = HEADER_UNSAFE.test(path) ? JSON.stringify(path) : path;
  return `diff --git a/${name} b/${name}\n[untracked file patch unavailable: ${reason}]`;
}

// The host and path portions of an scp-style git remote such as `git@github.com:owner/repo.git`.
const SCP_REMOTE = /^[\w.-]+@(?<host>[\w.-]+):(?<path>.+)$/u;
const GIT_SUFFIX = /\.git$/u;
// The only host whose remotes mint a repository identity. Callers bind this identity to GitHub
// webhook targets, so a remote on any other host must not resolve to an `owner/repo` at all:
// `https://attacker.example/acme/app.git` is not GitHub's `acme/app`.
const GITHUB_HOST = 'github.com';

/**
 * Extract `owner/repo` from a GitHub remote URL, or null when the URL names anything else.
 *
 * The remote host must be `github.com`: the identity approves publication to the GitHub
 * repository of the same name, so a checkout tracking another host has no GitHub identity and
 * fails closed. Exactly two path segments are required: a URL with more or fewer segments does
 * not identify a GitHub repository and is rejected rather than truncated into one.
 */
function parseRemoteRepository(url: string): { owner: string; repo: string } | null {
  let host: string;
  let path: string;
  const scp = SCP_REMOTE.exec(url);
  if (scp?.groups?.host !== undefined && scp.groups.path !== undefined) {
    host = scp.groups.host;
    path = scp.groups.path;
  } else {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  if (host.toLowerCase() !== GITHUB_HOST) return null;
  const segments = path
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0);
  const [owner, tail] = segments;
  if (segments.length !== 2 || !owner || !tail) return null;
  const repo = tail.replace(GIT_SUFFIX, '');
  if (repo.length === 0) return null;
  return { owner, repo };
}

function assertInside(root: string, candidate: string, original: string): void {
  const rel = relative(root, candidate);
  if (rel.length > 0 && (isAbsolute(rel) || rel.replaceAll('\\', '/').split('/').includes('..')))
    throw new PathEscapeError(original, 'resolves outside the checkout');
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/**
 * The filesystem location an open descriptor actually refers to.
 *
 * On Linux the kernel reports it directly through `/proc`, which no concurrent rename can falsify.
 * Elsewhere the path is re-resolved and must still name the very file that was opened.
 */
async function descriptorPath(
  handle: FileHandle,
  opened: string,
  original: string,
): Promise<string> {
  try {
    return await readlink(`/proc/self/fd/${handle.fd}`);
  } catch {
    const real = await realpath(opened);
    const [expected, current] = await Promise.all([handle.stat(), stat(real)]);
    if (expected.dev !== current.dev || expected.ino !== current.ino)
      throw new PathEscapeError(original, 'replaced while it was being opened');
    return real;
  }
}

/**
 * Resolve a stable path through the directory handle itself. Linux exposes descriptors under
 * `/proc/self/fd`, so renaming the directory cannot redirect the mutation through a different path.
 *
 * Platforms without that facility get no fallback: any pathname alternative re-walks mutable
 * components, so a concurrent task could swap the verified directory for a symlink between the
 * inode comparison and the rename and redirect the write outside the checkout. Node exposes no
 * descriptor-relative create or rename, so the write fails closed instead.
 */
async function directoryAnchor(directory: FileHandle, original: string): Promise<string> {
  const descriptor = `/proc/self/fd/${directory.fd}`;
  try {
    await lstat(descriptor);
    return descriptor;
  } catch {
    throw new RunnerWriteDeniedError(
      original,
      'descriptor-anchored writes are not supported on this platform',
    );
  }
}

/**
 * Resolve the closest existing ancestor of a target, following symlinks.
 *
 * A file that does not exist yet still has a parent directory, and that parent is what determines
 * where a write would actually land.
 */
async function closestRealPath(target: string): Promise<string> {
  let candidate = target;
  for (;;) {
    try {
      return await realpath(candidate);
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return candidate;
      candidate = parent;
    }
  }
}
