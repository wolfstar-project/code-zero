import type { TaskState, TerminalState } from '@code-zero/shared';

/** Raised when a run attempts a lifecycle transition the machine does not define. */
export class InvalidTransitionError extends Error {
  constructor(from: TaskState, to: TaskState) {
    super(`Invalid lifecycle transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export const terminalStates: readonly TerminalState[] = ['completed', 'needs-human', 'failed'];

/**
 * The lifecycle, written out in full.
 *
 * `discover -> understand -> validate -> plan -> execute -> verify -> review`, with the repair edge
 * from `verifying` back to `planning`. Every state can reach `failed`, because an unexpected error
 * must surface as a failure rather than as a partial success. No state can skip `verifying` on the
 * way to `completed` once changes have been executed.
 */
const allowedTransitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  queued: ['discovering', 'failed'],
  discovering: ['understanding', 'failed'],
  understanding: ['validating', 'failed'],
  validating: ['planning', 'completed', 'needs-human', 'failed'],
  planning: ['executing', 'completed', 'needs-human', 'failed'],
  executing: ['verifying', 'needs-human', 'failed'],
  verifying: ['reviewing', 'planning', 'needs-human', 'failed'],
  reviewing: ['completed', 'needs-human', 'failed'],
  completed: [],
  'needs-human': [],
  failed: [],
};

export function isTerminal(state: TaskState): state is TerminalState {
  return allowedTransitions[state].length === 0;
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return allowedTransitions[from].includes(to);
}

/**
 * Tracks the current lifecycle state and refuses undefined moves.
 *
 * Using a machine rather than ad-hoc bookkeeping is what makes the terminal state of a run
 * deterministic and testable: an implementation mistake becomes a thrown error instead of an
 * unverified result that looks finished.
 */
export class LifecycleMachine {
  private state: TaskState = 'queued';

  get current(): TaskState {
    return this.state;
  }

  to(next: TaskState): TaskState {
    if (!canTransition(this.state, next)) throw new InvalidTransitionError(this.state, next);
    this.state = next;
    return next;
  }

  /** Move to a terminal state from wherever the run currently is. */
  finish(next: TerminalState): TerminalState {
    const current = this.state;
    if (isTerminal(current)) return current;
    this.to(next);
    return next;
  }
}
