export {
  CodeZero,
  classifyChangeRisk,
  sanitizeAcceptanceCriteria,
  scopeChanges,
  type AgentDependencies,
} from './agent.js';
export {
  canTransition,
  InvalidTransitionError,
  isTerminal,
  LifecycleMachine,
  terminalStates,
} from './state.js';
export {
  quotedSpans,
  validateFinding,
  type ValidationOutcome,
  type ValidationProbe,
  type ValidationScope,
} from './validation.js';
