import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';

import type { RunMode } from '@code-zero/shared';

/**
 * How a principal proved its identity.
 *
 * Recorded on every authenticated request so an audit log can tell a machine caller presenting a
 * static operator token from a human signed into the dashboard: the two are granted different
 * execution modes and revoked through entirely different channels.
 */
export type PrincipalKind = 'token' | 'session';

/** An authenticated control-plane caller. Mutations record this identity, never a wire-supplied one. */
export interface Principal {
  name: string;
  /** How the caller authenticated. */
  kind: PrincipalKind;
  /** Execution modes this principal may request from `tasks.create`. */
  modes: readonly RunMode[];
  /**
   * Whether the caller may read surfaces reserved for an app-wide administrator, `audit.list`
   * being the one today.
   *
   * Carried explicitly rather than inferred from {@link Principal.modes}: the two grants answer
   * different questions — what a caller may run, and what a caller may see — and a reader of this
   * type should not have to learn that holding `autonomous` happens to imply the second.
   * Operator tokens are never administrators: the trail records who used them, so letting a token
   * read it back would let one audit itself.
   */
  admin: boolean;
}

/**
 * Static access policy for the control-plane transport.
 *
 * Mutating procedures fail closed: without configured principals no mutation is accepted, and task
 * creation additionally requires the target repository path to be allow-listed by the operator and
 * the requested execution mode to be granted to the authenticated principal.
 */
export interface ControlPlaneAccess {
  /** Bearer token to authenticated principal. */
  principals: ReadonlyMap<string, Principal>;
  /** Repository paths that `tasks.create` may target. */
  repositories: readonly string[];
}

const BEARER_PREFIX = 'Bearer ';

const RUN_MODES: ReadonlySet<string> = new Set([
  'observe',
  'suggest',
  'fix',
  'autonomous',
] satisfies RunMode[]);

/** Granted when a principal has no explicit mode entry; neither mode can produce a writable runner. */
const DEFAULT_MODES: readonly RunMode[] = ['observe', 'suggest'];

/** Every execution mode, including the two that produce a writable runner. */
const ADMIN_MODES: readonly RunMode[] = ['observe', 'suggest', 'fix', 'autonomous'];

function isRunMode(value: string): value is RunMode {
  return RUN_MODES.has(value);
}

/**
 * Parse the access policy from the environment.
 *
 * `CODE_ZERO_CONTROL_PLANE_TOKENS` holds comma-separated `name:token` pairs,
 * `CODE_ZERO_CONTROL_PLANE_REPOSITORIES` holds comma-separated repository paths, and
 * `CODE_ZERO_CONTROL_PLANE_MODES` holds comma-separated `name:mode|mode` grants. Principals
 * without a grant may only request the non-writable `observe` and `suggest` modes.
 *
 * Either variable is enough to produce a policy, because the two answer different questions. The
 * tokens decide who a machine caller is; the repositories decide what any authenticated caller may
 * target, including a person signed into the dashboard. Requiring tokens for the second left a
 * deployment that authenticates only browser sessions unable to create a task at all — the
 * allow-list it had configured did not exist, so every target failed closed.
 *
 * Returns `undefined` only when neither is configured, which keeps an unconfigured deployment
 * rejecting every mutation.
 */
export function accessFromEnvironment(
  tokens = process.env.CODE_ZERO_CONTROL_PLANE_TOKENS,
  repositories = process.env.CODE_ZERO_CONTROL_PLANE_REPOSITORIES,
  modes = process.env.CODE_ZERO_CONTROL_PLANE_MODES,
): ControlPlaneAccess | undefined {
  const allowedRepositories = (repositories ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path !== '');
  if ((tokens === undefined || tokens.trim() === '') && allowedRepositories.length === 0)
    return undefined;
  const grants = parseModeGrants(modes);
  const principals = new Map<string, Principal>();
  const names = new Set<string>();
  for (const entry of (tokens ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf(':');
    const name = separator > 0 ? trimmed.slice(0, separator).trim() : '';
    const token = separator > 0 ? trimmed.slice(separator + 1).trim() : '';
    if (name === '' || token === '')
      throw new Error('CODE_ZERO_CONTROL_PLANE_TOKENS entries must be name:token pairs');
    names.add(name);
    principals.set(token, {
      name,
      kind: 'token',
      modes: grants.get(name) ?? DEFAULT_MODES,
      // An operator token is a machine credential the trail records the use of; reading the trail
      // back is a person's surface, reached with a session.
      admin: false,
    });
  }
  if (principals.size === 0 && allowedRepositories.length === 0) return undefined;
  for (const name of grants.keys())
    if (!names.has(name))
      throw new Error(
        `CODE_ZERO_CONTROL_PLANE_MODES grants modes to an unknown principal: ${name}`,
      );
  return { principals, repositories: allowedRepositories };
}

/** Parse `name:mode|mode` grants, refusing unknown modes rather than silently widening or narrowing. */
function parseModeGrants(modes: string | undefined): Map<string, readonly RunMode[]> {
  const grants = new Map<string, readonly RunMode[]>();
  if (modes === undefined || modes.trim() === '') return grants;
  for (const entry of modes.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf(':');
    const name = separator > 0 ? trimmed.slice(0, separator).trim() : '';
    const granted = separator > 0 ? trimmed.slice(separator + 1).trim() : '';
    if (name === '' || granted === '')
      throw new Error('CODE_ZERO_CONTROL_PLANE_MODES entries must be name:mode|mode pairs');
    const parsed: RunMode[] = [];
    for (const candidate of granted.split('|')) {
      const mode = candidate.trim();
      if (mode === '') continue;
      if (!isRunMode(mode))
        throw new Error(`CODE_ZERO_CONTROL_PLANE_MODES grants an unknown mode: ${mode}`);
      parsed.push(mode);
    }
    if (parsed.length === 0)
      throw new Error('CODE_ZERO_CONTROL_PLANE_MODES entries must be name:mode|mode pairs');
    grants.set(name, parsed);
  }
  return grants;
}

/**
 * Parse the REST/OpenAPI transport's CORS allow-list from the environment.
 *
 * `CODE_ZERO_CONTROL_PLANE_ORIGINS` holds comma-separated origins. Defaults to none: `tasks.list`,
 * `tasks.get`, and `health` are unauthenticated by design, but a browser's ability to read their
 * responses cross-origin is a separate grant that has to be configured explicitly rather than
 * defaulting open.
 */
export function controlPlaneOriginsFromEnvironment(
  origins = process.env.CODE_ZERO_CONTROL_PLANE_ORIGINS,
): readonly string[] {
  return (origins ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/** Resolve the principal for an `Authorization` header using constant-time token comparison. */
export function authenticate(
  authorization: string | undefined,
  access: ControlPlaneAccess | undefined,
): Principal | undefined {
  if (!access || authorization === undefined || !authorization.startsWith(BEARER_PREFIX))
    return undefined;
  const presented = Buffer.from(authorization.slice(BEARER_PREFIX.length));
  for (const [token, principal] of access.principals) {
    const expected = Buffer.from(token);
    if (presented.length === expected.length && timingSafeEqual(presented, expected))
      return principal;
  }
  return undefined;
}

/**
 * Build the principal for a caller who authenticated with a dashboard session rather than a token.
 *
 * Session identities come from the authentication adapter, not from this package's static token
 * policy, so the composition root resolves the session and calls this to translate it into the
 * same {@link Principal} every procedure already reasons about. Only an app-wide administrator may
 * request the two writable modes; every other signed-in user is held to the same non-writable
 * {@link DEFAULT_MODES} an ungranted token gets. Repository targeting is a separate grant either
 * way — see {@link mayTargetRepository}.
 */
export function sessionPrincipal(name: string, isAdmin: boolean): Principal {
  return { name, kind: 'session', modes: isAdmin ? ADMIN_MODES : DEFAULT_MODES, admin: isAdmin };
}

/** Whether task creation may target this repository path. Fails closed without a policy. */
export function mayTargetRepository(
  repository: string,
  access: ControlPlaneAccess | undefined,
): boolean {
  if (!access) return false;
  const target = resolve(repository);
  return access.repositories.some((allowed) => resolve(allowed) === target);
}
