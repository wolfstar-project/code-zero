import type { Principal } from '../access.js';
import type { AuditActor } from '../audit.js';

/**
 * The audited identity of an authenticated caller; never the name the request asked to use.
 *
 * The two authentication sources stay distinguishable in the trail: a dashboard session is a
 * person, an operator token is a machine, and they are revoked through different channels. A
 * record that called both `principal` would leave a reader unable to tell which one to go turn
 * off — the same reason `AuditActorKind` carries `user` at all.
 */
export function principalActor(principal: Principal): AuditActor {
  return { type: principal.kind === 'session' ? 'user' : 'api', id: principal.name };
}
