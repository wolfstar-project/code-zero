import { timingSafeEqual } from 'node:crypto';

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
 * Who may call the control plane as a machine, and what each of them may run.
 *
 * Identity only. Which checkout a run may target is a separate grant the composition root answers
 * from the deployment's own store (`RpcContext.mayTargetRepository`), because that list changes
 * while the process runs and this one does not: a token is a credential, a repository is data.
 */
export interface ControlPlaneAccess {
  /** Bearer token to authenticated principal. */
  principals: ReadonlyMap<string, Principal>;
}

const BEARER_PREFIX = 'Bearer ';

/** Granted when a principal has no explicit mode entry; neither mode can produce a writable runner. */
const DEFAULT_MODES: readonly RunMode[] = ['observe', 'suggest'];

/** Every execution mode, including the two that produce a writable runner. */
const ADMIN_MODES: readonly RunMode[] = ['observe', 'suggest', 'fix', 'autonomous'];

/**
 * Resolve the operator tokens a machine caller may present.
 *
 * The token is a credential, so it stays in the environment beside the database password and the
 * signing secret rather than moving into the deployment's configuration file or its store: a
 * secret belongs where the deployment already keeps secrets. The grants that go with it —
 * which execution modes each principal may request — are policy, and come from the deployment
 * configuration instead.
 *
 * Returns `undefined` when no token is configured, which keeps a deployment that authenticates
 * only browser sessions from accepting any machine caller at all.
 */
export function accessFromEnvironment(
  tokens = process.env.CODE_ZERO_CONTROL_PLANE_TOKENS,
  grants: ReadonlyMap<string, readonly RunMode[]> = new Map(),
): ControlPlaneAccess | undefined {
  if (tokens === undefined || tokens.trim() === '') return undefined;
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
  if (principals.size === 0) return undefined;
  for (const name of grants.keys())
    if (!names.has(name))
      throw new Error(`control_plane.modes grants modes to an unknown principal: ${name}`);
  return { principals };
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
 * way, answered by the composition root against the deployment's store.
 */
export function sessionPrincipal(name: string, isAdmin: boolean): Principal {
  return { name, kind: 'session', modes: isAdmin ? ADMIN_MODES : DEFAULT_MODES, admin: isAdmin };
}
