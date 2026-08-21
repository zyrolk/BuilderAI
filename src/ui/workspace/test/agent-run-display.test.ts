import { describe, expect, it } from 'vitest';

import {
  agentPhaseHeadline,
  buildAgentLifecycleSteps,
  isAgentRunCancellable,
} from '../agent-run-display';

describe('agent-run-display', () => {
  it('maps AWAITING_GATE2 to Gate 2 active without fabricating later steps', () => {
    const steps = buildAgentLifecycleSteps({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
    });
    expect(steps.find((step) => step.label === 'Understand')?.state).toBe('complete');
    expect(steps.find((step) => step.label === 'Plan')?.state).toBe('complete');
    expect(steps.find((step) => step.label === 'Gate 2')?.state).toBe('active');
    expect(steps.find((step) => step.label === 'Execute')?.state).toBe('pending');
  });

  it('marks completed runs as fully complete', () => {
    const steps = buildAgentLifecycleSteps({
      phase: 'COMPLETED',
      status: 'COMPLETED',
      awaitingGate2: false,
    });
    expect(steps.every((step) => step.state === 'complete')).toBe(true);
  });

  it('does not treat terminal runs as cancellable', () => {
    expect(isAgentRunCancellable('COMPLETED', 'COMPLETED')).toBe(false);
    expect(isAgentRunCancellable('FAILED', 'FAILED')).toBe(false);
    expect(isAgentRunCancellable('CANCELLED', 'CANCELLED')).toBe(false);
    expect(isAgentRunCancellable('AWAITING_GATE2', 'AWAITING_GATE2')).toBe(true);
  });

  it('surfaces Gate 2 pause headline from server flags', () => {
    expect(agentPhaseHeadline('AWAITING_GATE2', true)).toMatch(/Paused at Gate 2/);
  });
});
