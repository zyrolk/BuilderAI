export const AGENT_LIFECYCLE_STEPS = [
  'Understand',
  'Plan',
  'Gate 2',
  'Execute',
  'Test',
  'Browser',
  'Diagnose',
  'Correct',
  'Verify',
  'Explain',
] as const;

export type AgentLifecycleStep = (typeof AGENT_LIFECYCLE_STEPS)[number];

export type AgentLifecycleStepState = 'pending' | 'active' | 'complete' | 'failed' | 'skipped';

export interface AgentLifecycleStepView {
  readonly label: AgentLifecycleStep;
  readonly state: AgentLifecycleStepState;
}

/** Map authoritative AgentRun phase/status to conceptual lifecycle display. */
export function buildAgentLifecycleSteps(input: {
  readonly phase: string;
  readonly status: string;
  readonly awaitingGate2: boolean;
  readonly hasCorrection?: boolean;
  readonly verificationStatus?: string | null;
}): readonly AgentLifecycleStepView[] {
  const activeIndex = activeStepIndex(input);
  const failed = input.status === 'FAILED' || input.phase === 'FAILED';
  const cancelled = input.status === 'CANCELLED' || input.phase === 'CANCELLED';
  const completed = input.status === 'COMPLETED' || input.phase === 'COMPLETED';

  return AGENT_LIFECYCLE_STEPS.map((label, index) => {
    if (completed) {
      return { label, state: 'complete' as const };
    }
    if (cancelled) {
      if (index < activeIndex) return { label, state: 'complete' as const };
      if (index === activeIndex) return { label, state: 'failed' as const };
      return { label, state: 'skipped' as const };
    }
    if (failed) {
      if (index < activeIndex) return { label, state: 'complete' as const };
      if (index === activeIndex) return { label, state: 'failed' as const };
      return { label, state: 'pending' as const };
    }
    if (index < activeIndex) return { label, state: 'complete' as const };
    if (index === activeIndex) return { label, state: 'active' as const };
    return { label, state: 'pending' as const };
  });
}

export function isAgentRunCancellable(phase: string, status: string): boolean {
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') return false;
  if (phase === 'COMPLETED' || phase === 'FAILED' || phase === 'CANCELLED') return false;
  return true;
}

export function agentPhaseHeadline(phase: string, awaitingGate2: boolean): string {
  if (awaitingGate2 || phase === 'AWAITING_GATE2') {
    return 'Paused at Gate 2 — explicit approval required';
  }
  switch (phase) {
    case 'UNDERSTANDING':
      return 'Understanding the project';
    case 'PLANNING':
      return 'Planning changes';
    case 'EXECUTING':
      return 'Executing approved changes';
    case 'VERIFYING':
      return 'Running verification';
    case 'DIAGNOSING':
      return 'Diagnosing verification failure';
    case 'CORRECTING':
      return 'Correction in progress — further Gate 2 approval may be required';
    case 'EXPLAINING':
      return 'Preparing explanation';
    case 'COMPLETED':
      return 'Agent run completed';
    case 'FAILED':
      return 'Agent run failed';
    case 'CANCELLED':
      return 'Agent run cancelled';
    default:
      return phase;
  }
}

function activeStepIndex(input: {
  readonly phase: string;
  readonly awaitingGate2: boolean;
  readonly hasCorrection?: boolean;
  readonly verificationStatus?: string | null;
}): number {
  if (input.awaitingGate2 || input.phase === 'AWAITING_GATE2') return 2;
  switch (input.phase) {
    case 'UNDERSTANDING':
      return 0;
    case 'PLANNING':
      return 1;
    case 'EXECUTING':
      return 3;
    case 'VERIFYING':
      return 4;
    case 'DIAGNOSING':
      return 6;
    case 'CORRECTING':
      return 7;
    case 'EXPLAINING':
      return 9;
    case 'COMPLETED':
      return AGENT_LIFECYCLE_STEPS.length - 1;
    case 'FAILED':
      return input.hasCorrection ? 6 : 4;
    case 'CANCELLED':
      return 2;
    default:
      return 0;
  }
}
