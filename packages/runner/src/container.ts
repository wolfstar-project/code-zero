import type { CheckResult, RunnerDescription } from '@code-zero/shared';

import { RepositoryBoundary, type BoundaryOptions } from './boundary.js';
import { commandArgv } from './process.js';

/** Container engines the isolated runner knows how to drive. */
export type ContainerEngine = 'docker' | 'podman';

export interface ContainerOptions extends BoundaryOptions {
  engine: ContainerEngine;
  image: string;
  workdir: string;
  cpus?: string;
  memory?: string;
  networkName?: string;
  user?: string;
}

export const DEFAULT_RESTRICTED_NETWORK = 'code-zero';

/**
 * Compatibility isolation adapter for self-hosted Docker/Podman deployments.
 *
 * ViteHub owns the shared command preflight before this adapter receives argv. Hosted production
 * can move to ViteHub Sandbox/Workspace behind the same Runner contract without duplicating command
 * parsing or policy in each execution adapter.
 */
export class ContainerRunner extends RepositoryBoundary {
  private readonly container: ContainerOptions;

  constructor(root: string, options: ContainerOptions) {
    super(root, options);
    this.container = options;
  }

  describe(): RunnerDescription {
    return {
      kind: 'container',
      isolated: true,
      writable: this.options.writable,
      network: this.options.network,
    };
  }

  async check(command: string, timeoutMs: number): Promise<CheckResult> {
    const [program, args] = await commandArgv(command);
    const started = Date.now();
    const outcome = await this.process(
      this.container.engine,
      [...this.engineArguments(), this.container.image, program, ...args],
      { cwd: this.root, timeoutMs, maxOutputBytes: this.maxOutputBytes },
    );
    return this.toCheckResult(command, outcome, Date.now() - started);
  }

  engineArguments(): string[] {
    const { workdir } = this.container;
    const args = [
      'run',
      '--rm',
      '--init',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--network',
      this.networkArgument(),
      '--workdir',
      workdir,
      '--volume',
      `${this.root}:${workdir}${this.options.writable ? '' : ':ro'}`,
    ];
    if (this.container.user) args.push('--user', this.container.user);
    if (this.container.cpus) args.push('--cpus', this.container.cpus);
    if (this.container.memory) args.push('--memory', this.container.memory);
    return args;
  }

  private networkArgument(): string {
    if (this.options.network === 'none') return 'none';
    if (this.options.network === 'full') return 'bridge';
    return this.container.networkName ?? DEFAULT_RESTRICTED_NETWORK;
  }
}
