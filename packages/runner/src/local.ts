import type { CheckResult, RunnerDescription } from '@code-zero/shared';

import { RepositoryBoundary, type BoundaryOptions } from './boundary.js';
import { commandArgv } from './process.js';

/**
 * Runs repository commands directly in the host process tree.
 *
 * This runner is for trusted local development. It reports `isolated: false` so that no run can
 * claim sandboxed verification it did not have, and it cannot enforce the network policy it
 * carries. Production deployments must use an isolated execution provider.
 */
export class LocalRunner extends RepositoryBoundary {
  constructor(root: string, options: Partial<BoundaryOptions> = {}) {
    super(root, { writable: false, network: 'full', ...options });
  }

  describe(): RunnerDescription {
    return {
      kind: 'local',
      isolated: false,
      writable: this.options.writable,
      network: this.options.network,
    };
  }

  async check(command: string, timeoutMs: number): Promise<CheckResult> {
    const [program, args] = await commandArgv(command);
    const started = Date.now();
    const outcome = await this.process(program, args, {
      cwd: this.root,
      timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
    });
    return this.toCheckResult(command, outcome, Date.now() - started);
  }
}
