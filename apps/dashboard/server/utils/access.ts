import { accessFromEnvironment, type ControlPlaneAccess } from '@code-zero/api';

/**
 * Builds the once-resolved, self-healing cache described by {@link controlPlaneAccess} below.
 *
 * Takes the loader as a parameter rather than reaching for `deploymentConfig`/`process.env`
 * directly, so a test can drive a rejection and its recovery without a real config file — the same
 * reason `createOverviewBroadcaster` in `./overview.ts` takes its store as a parameter.
 */
export function createControlPlaneAccessCache(
  load: () => Promise<ControlPlaneAccess | undefined>,
): () => Promise<ControlPlaneAccess | undefined> {
  let pending: Promise<ControlPlaneAccess | undefined> | undefined;

  return function controlPlaneAccess(): Promise<ControlPlaneAccess | undefined> {
    pending ??= load().catch((error: unknown) => {
      // A transient failure to read the config must not wedge every request behind it for the
      // rest of the process's life: clearing the cache here is what lets the next call try again
      // instead of replaying this same rejection forever.
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

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
export const controlPlaneAccess: () => Promise<ControlPlaneAccess | undefined> =
  createControlPlaneAccessCache(() =>
    deploymentConfig().then((config) =>
      accessFromEnvironment(process.env.CODE_ZERO_CONTROL_PLANE_TOKENS, config.controlPlane.modes),
    ),
  );
