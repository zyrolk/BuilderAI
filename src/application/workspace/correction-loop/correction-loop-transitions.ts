import type { CorrectionLoopSession } from './correction-loop.types';

const VALID_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  CORRECTION_NOT_STARTED: ['CORRECTION_DIAGNOSING', 'CORRECTION_BLOCKED', 'CORRECTION_CANCELLED'],
  CORRECTION_DIAGNOSING: [
    'CORRECTION_PREPARING',
    'CORRECTION_BLOCKED',
    'CORRECTION_CANCELLED',
    'CORRECTION_FAILED',
    'CORRECTION_LOOP_DETECTED',
  ],
  CORRECTION_PREPARING: [
    'CORRECTION_READY_FOR_REVIEW',
    'CORRECTION_WAITING_FOR_APPROVAL',
    'CORRECTION_FAILED',
    'CORRECTION_CANCELLED',
    'CORRECTION_LOOP_DETECTED',
    'CORRECTION_BLOCKED',
  ],
  CORRECTION_READY_FOR_REVIEW: ['CORRECTION_WAITING_FOR_APPROVAL', 'CORRECTION_CANCELLED'],
  CORRECTION_WAITING_FOR_APPROVAL: [
    'CORRECTION_APPLYING',
    'CORRECTION_CANCELLED',
    'CORRECTION_FAILED',
  ],
  CORRECTION_APPLYING: [
    'CORRECTION_VERIFYING',
    'CORRECTION_FAILED',
    'CORRECTION_BLOCKED',
    'CORRECTION_CANCELLED',
  ],
  CORRECTION_VERIFYING: [
    'CORRECTION_PASSED',
    'CORRECTION_FAILED',
    'CORRECTION_EXHAUSTED',
    'CORRECTION_DIAGNOSING',
    'CORRECTION_BLOCKED',
    'CORRECTION_LOOP_DETECTED',
    'CORRECTION_CANCELLED',
  ],
};

export class CorrectionLoopTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid correction transition from ${from} to ${to}.`);
    this.name = 'CorrectionLoopTransitionError';
  }
}

export function assertCorrectionTransition(
  session: CorrectionLoopSession,
  nextState: CorrectionLoopSession['state'],
): void {
  const allowed = VALID_TRANSITIONS[session.state];
  if (allowed === undefined || !allowed.includes(nextState)) {
    throw new CorrectionLoopTransitionError(session.state, nextState);
  }
}

export function isTerminalCorrectionState(state: CorrectionLoopSession['state']): boolean {
  return (
    state === 'CORRECTION_PASSED' ||
    state === 'CORRECTION_FAILED' ||
    state === 'CORRECTION_EXHAUSTED' ||
    state === 'CORRECTION_CANCELLED' ||
    state === 'CORRECTION_BLOCKED' ||
    state === 'CORRECTION_LOOP_DETECTED'
  );
}
