import type { NetworkPolicy } from '@code-zero/shared';

import type { BoundaryOptions, Runner } from './boundary.js';
import { ContainerRunner, type ContainerEngine, type ContainerOptions } from './container.js';
import { LocalRunner } from './local.js';

export {
  PathEscapeError,
  RepositoryBoundary,
  RunnerWriteDeniedError,
  type BoundaryOptions,
  type RepositoryContextOptions,
  type Runner,
} from './boundary.js';
export {
  ContainerRunner,
  DEFAULT_RESTRICTED_NETWORK,
  type ContainerEngine,
  type ContainerOptions,
} from './container.js';
export { LocalRunner } from './local.js';
export {
  assertSimpleCommand,
  CommandRejectedError,
  containerizedProcessArgv,
  execFileProcessRunner,
  spawnManagedProcess,
  splitCommand,
  type ManagedProcessContainerOptions,
  type ManagedProcessMount,
  type ManagedSpawnOptions,
  type ProcessOptions,
  type ProcessOutcome,
  type ProcessRunner,
} from './process.js';
export {
  RunnerPool,
  RunnerPoolQuotaError,
  type ProvisionedSandbox,
  type RunnerPoolOptions,
  type RunnerPoolSnapshot,
  type SandboxLease,
  type SandboxProvider,
  type SandboxRequest,
} from './sandbox.js';

export interface CreateRunnerOptions extends Omit<BoundaryOptions, 'network'> {
  isolation: 'local' | 'container';
  network: NetworkPolicy;
  container?: {
    engine: ContainerEngine;
    image: string;
    workdir: string;
    cpus?: string;
    memory?: string;
    networkName?: string;
    user?: string;
  };
}

export interface RunnerPolicyInput {
  permissions: { network: NetworkPolicy };
  runner: {
    isolation: 'local' | 'container';
    engine: ContainerEngine;
    image?: string;
    workdir: string;
    cpus?: string;
    memory?: string;
    network?: string;
    maxOutputBytes: number;
  };
}

export function runnerOptionsFromPolicy(
  policy: RunnerPolicyInput,
  writable: boolean,
): CreateRunnerOptions {
  const { runner } = policy;
  return {
    isolation: runner.isolation,
    network: policy.permissions.network,
    writable,
    maxOutputBytes: runner.maxOutputBytes,
    ...(runner.isolation === 'container' && runner.image
      ? {
          container: {
            engine: runner.engine,
            image: runner.image,
            workdir: runner.workdir,
            ...(runner.cpus === undefined ? {} : { cpus: runner.cpus }),
            ...(runner.memory === undefined ? {} : { memory: runner.memory }),
            ...(runner.network === undefined ? {} : { networkName: runner.network }),
          },
        }
      : {}),
  };
}

/**
 * Build the execution boundary for a run.
 *
 * Local execution is for trusted development. The container adapter remains a self-hosted
 * compatibility path; ViteHub Shell is the shared command-analysis layer for both, while hosted
 * isolation can move behind ViteHub Sandbox/Workspace without changing the Agent `Runner` contract.
 */
export function createRunner(root: string, options: CreateRunnerOptions): Runner {
  const { isolation, container, ...boundary } = options;
  if (isolation === 'local') return new LocalRunner(root, boundary);
  if (!container?.image)
    throw new Error('Container isolation requires an image; refusing to run without a sandbox');
  const containerOptions: ContainerOptions = {
    ...boundary,
    engine: container.engine,
    image: container.image,
    workdir: container.workdir,
    ...(container.cpus === undefined ? {} : { cpus: container.cpus }),
    ...(container.memory === undefined ? {} : { memory: container.memory }),
    ...(container.networkName === undefined ? {} : { networkName: container.networkName }),
    ...(container.user === undefined ? {} : { user: container.user }),
  };
  return new ContainerRunner(root, containerOptions);
}
