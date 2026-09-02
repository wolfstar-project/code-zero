import { destr } from 'destr';
import { anyOf, charIn, createRegExp, digit, letter } from 'magic-regexp';
import type { AgentName } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';

/** The repository-native check kinds a verified run is expected to execute. */
export const checkKinds = ['lint', 'typecheck', 'test', 'build'] as const;
export type CheckKind = (typeof checkKinds)[number];

/** Package managers Code Zero can invoke a repository script through. */
export type PackageManager = AgentName;

/** What the runtime observed about a checkout, used to derive its native check commands. */
export interface RepositoryProbe {
  /** Raw `package.json` contents, or null when the checkout has none. */
  packageJson: string | null;
  /** Lockfile names present at the checkout root. */
  lockfiles: readonly string[];
}

/** Script names accepted for each kind, in preference order. */
const scriptCandidates: Readonly<Record<CheckKind, readonly string[]>> = {
  lint: ['lint', 'lint:ci', 'eslint'],
  typecheck: ['typecheck', 'type-check', 'types', 'tsc'],
  test: ['test', 'test:unit', 'tests'],
  build: ['build'],
};

const lockfileManagers: readonly (readonly [string, PackageManager])[] = [
  ['aube-lock.yaml', 'aube'],
  ['aube-workspace.yaml', 'aube'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['pnpm-workspace.yaml', 'pnpm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['deno.lock', 'deno'],
  ['nub.lock', 'nub'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

/** Lockfiles worth probing for in a checkout, in the order they take precedence. */
export const knownLockfiles: readonly string[] = lockfileManagers.map(([lockfile]) => lockfile);

/** Script names Code Zero is willing to invoke. Anything else is untrusted repository content. */
const SAFE_SCRIPT_NAME = createRegExp(
  anyOf(letter, digit)
    .at.lineStart()
    .and(anyOf(letter, digit, charIn(':._-')).times.any())
    .at.lineEnd(),
);

const packageManagers = new Set<string>(['npm', 'yarn', 'pnpm', 'bun', 'deno', 'nub', 'aube']);
const PACKAGE_MANAGER_RANGE_PREFIX = /^\^/;

/** Identify the package manager a checkout pins, following package-manager-detector's signals. */
export function detectPackageManager(probe: RepositoryProbe): PackageManager {
  const manifestManager = packageManagerFromManifest(probe.packageJson);
  return manifestManager ?? packageManagerFromLockfiles(probe.lockfiles);
}

/** Identify the package manager from lockfiles alone, defaulting to npm. */
export function packageManagerFromLockfiles(lockfiles: readonly string[]): PackageManager {
  const present = new Set(lockfiles);
  for (const [lockfile, manager] of lockfileManagers) if (present.has(lockfile)) return manager;
  return 'npm';
}

/**
 * Derive the checkout's own lint, typecheck, test, and build commands.
 *
 * Only scripts the repository actually declares are returned, so a run never claims to have
 * executed a check the repository does not define. Script names that are not plain identifiers are
 * skipped rather than quoted, because the runner does not use a shell.
 */
export function discoverChecks(probe: RepositoryProbe): string[] {
  const scripts = readScripts(probe.packageJson);
  if (scripts.length === 0) return [];
  const manager = detectPackageManager(probe);
  const available = new Set(scripts);
  const commands: string[] = [];
  for (const kind of checkKinds) {
    const script = scriptCandidates[kind].find(
      (candidate) => available.has(candidate) && SAFE_SCRIPT_NAME.test(candidate),
    );
    if (script) commands.push(runScriptCommand(manager, script));
  }
  return commands;
}

/**
 * Choose the commands a run will verify with.
 *
 * Explicit configuration always wins. An empty list means "use whatever this repository defines",
 * which keeps Code Zero usable across checkouts without inventing commands.
 */
export function resolveChecks(configured: readonly string[], probe: RepositoryProbe): string[] {
  return configured.length > 0 ? [...configured] : discoverChecks(probe);
}

/**
 * Validate only the configuration-level invariant here.
 *
 * Command syntax and shell semantics are deliberately owned by `packages/runner`, where ViteHub
 * Shell performs the authoritative analysis immediately before execution. Keeping that decision in
 * one layer avoids the config and runner drifting into two subtly different shell parsers.
 */
export function assertExecutableCommand(command: string): void {
  if (command.trim().length === 0) throw new Error('Check commands must not be empty');
}

function readScripts(packageJson: string | null): string[] {
  if (!packageJson) return [];
  const parsed: unknown = destr(packageJson);
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return [];
  return Object.entries(parsed.scripts)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([name]) => name);
}

function packageManagerFromManifest(packageJson: string | null): PackageManager | undefined {
  if (!packageJson) return undefined;
  const parsed: unknown = destr(packageJson);
  if (!isRecord(parsed)) return undefined;

  const declared =
    typeof parsed.packageManager === 'string'
      ? parsed.packageManager
      : isRecord(parsed.devEngines) &&
          isRecord(parsed.devEngines.packageManager) &&
          typeof parsed.devEngines.packageManager.name === 'string'
        ? parsed.devEngines.packageManager.name
        : undefined;
  const name = declared?.replace(PACKAGE_MANAGER_RANGE_PREFIX, '').split('@')[0];
  return name !== undefined && isPackageManager(name) ? name : undefined;
}

function runScriptCommand(manager: PackageManager, script: string): string {
  const resolved = resolveCommand(manager, 'run', [script]);
  if (!resolved) throw new Error(`Could not resolve run command for ${manager}`);
  return [resolved.command, ...resolved.args].join(' ');
}

function isPackageManager(value: string): value is PackageManager {
  return packageManagers.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
