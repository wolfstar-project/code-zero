import { accessFromEnvironment, type ControlPlaneAccess } from '@code-zero/api';

/**
 * Who may call the control plane as a machine, composed from the two places its halves belong.
 *
 * The tokens are secrets and stay in `CODE_ZERO_CONTROL_PLANE_TOKENS`, beside the database
 * password. What each of them may run is policy and comes from `code-zero.deployment.yml`, where
 * it is a readable map instead of the `name:mode|mode` string it used to be squeezed into.
 *
 * Resolved once: both halves are fixed for the life of the process, and re-reading them per
 * request would only move the same answer around.
 */
let pending: Promise<ControlPlaneAccess | undefined> | undefined;

export function controlPlaneAccess(): Promise<ControlPlaneAccess | undefined> {
  pending ??= deploymentConfig().then((config) =>
    accessFromEnvironment(process.env.CODE_ZERO_CONTROL_PLANE_TOKENS, config.controlPlane.modes),
  );
  return pending;
}
