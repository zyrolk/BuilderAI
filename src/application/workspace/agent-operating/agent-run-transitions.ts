import {
  AGENT_RUN_TERMINAL_PHASES,
  AgentRunError,
  type AgentRunPhase,
  type AgentRunStatus,
  type AgentRunTerminalPhase,
} from './agent-run.types';

const TERMINAL = new Set<string>(AGENT_RUN_TERMINAL_PHASES);

/**
 * Allowed phase transitions for AgentRun orchestration metadata.
 * AWAITING_GATE2 is a real stop: leaving it requires an explicit later orchestrator step
 * (never automatic approval/APPLY).
 */
const ALLOWED: Readonly<Record<AgentRunPhase, readonly AgentRunPhase[]>> = {
  UNDERSTANDING: ['PLANNING', 'FAILED', 'CANCELLED'],
  PLANNING: ['AWAITING_GATE2', 'FAILED', 'CANCELLED'],
  AWAITING_GATE2: ['EXECUTING', 'PLANNING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['EXPLAINING', 'DIAGNOSING', 'FAILED', 'CANCELLED'],
  DIAGNOSING: ['CORRECTING', 'EXPLAINING', 'FAILED', 'CANCELLED'],
  CORRECTING: ['AWAITING_GATE2', 'FAILED', 'CANCELLED'],
  EXPLAINING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isAgentRunTerminalPhase(phase: AgentRunPhase): phase is AgentRunTerminalPhase {
  return TERMINAL.has(phase);
}

export function canTransitionAgentRunPhase(from: AgentRunPhase, to: AgentRunPhase): boolean {
  if (from === to) return false;
  if (isAgentRunTerminalPhase(from)) return false;
  return ALLOWED[from].includes(to);
}

export function assertCanTransitionAgentRunPhase(from: AgentRunPhase, to: AgentRunPhase): void {
  if (!canTransitionAgentRunPhase(from, to)) {
    if (isAgentRunTerminalPhase(from)) {
      throw new AgentRunError(
        'TERMINAL_STATE',
        `AgentRun phase ${from} is terminal and cannot transition.`,
      );
    }
    throw new AgentRunError('INVALID_TRANSITION', `Invalid AgentRun transition ${from} → ${to}.`);
  }
}

/** Derive overall status from lifecycle phase. */
export function statusForAgentRunPhase(phase: AgentRunPhase): AgentRunStatus {
  switch (phase) {
    case 'AWAITING_GATE2':
      return 'AWAITING_GATE2';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'RUNNING';
  }
}
