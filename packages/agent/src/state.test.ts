import type { TaskState } from '@code-zero/shared';
import { describe, expect, it } from 'vitest';

import { canTransition, isTerminal, LifecycleMachine, terminalStates } from './state.js';

describe('lifecycle transitions', () => {
  it('follows the documented happy path', () => {
    const machine = new LifecycleMachine();
    for (const state of [
      'discovering',
      'understanding',
      'validating',
      'planning',
      'executing',
      'verifying',
      'reviewing',
      'completed',
    ] satisfies TaskState[])
      expect(machine.to(state)).toBe(state);
    expect(isTerminal(machine.current)).toBe(true);
  });

  it('allows repair only from verification back to planning', () => {
    expect(canTransition('verifying', 'planning')).toBe(true);
    expect(canTransition('reviewing', 'planning')).toBe(false);
    expect(canTransition('executing', 'planning')).toBe(false);
  });

  it('cannot reach completion from execution without verifying', () => {
    expect(canTransition('executing', 'completed')).toBe(false);
    expect(canTransition('planning', 'reviewing')).toBe(false);
  });

  it('rejects an undefined move instead of silently accepting it', () => {
    const machine = new LifecycleMachine();
    expect(() => machine.to('verifying')).toThrow(
      'Invalid lifecycle transition: queued -> verifying',
    );
    expect(machine.current).toBe('queued');
  });

  it('can fail from any non-terminal state', () => {
    for (const state of [
      'queued',
      'discovering',
      'understanding',
      'validating',
      'planning',
      'executing',
      'verifying',
      'reviewing',
    ] satisfies TaskState[])
      expect(canTransition(state, 'failed')).toBe(true);
  });

  it('treats terminal states as final', () => {
    for (const state of terminalStates)
      for (const target of terminalStates) expect(canTransition(state, target)).toBe(false);
  });

  it('keeps the first terminal state when asked to finish twice', () => {
    const machine = new LifecycleMachine();
    machine.to('discovering');
    expect(machine.finish('failed')).toBe('failed');
    expect(machine.finish('completed')).toBe('failed');
  });
});
