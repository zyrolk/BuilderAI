import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRunPanel } from '../agent-run-panel';
import type {
  AgentApproveSuccessResponse,
  AgentPlanResponse,
  AgentRunHttpView,
  AgentStartResponse,
  HttpAgentWorkflow,
} from '../http-agent-workflow';

const NOW = '2026-08-20T10:00:00.000Z';

const EMPTY_TOOL_LOOP = {
  evidence: [] as const,
  budget: {
    toolCalls: 0,
    providerTurns: 0,
    b4VerificationCalls: 0,
    browserObservationCalls: 0,
  },
};

function createRun(overrides: Partial<AgentRunHttpView> = {}): AgentRunHttpView {
  return {
    runId: 'agent-run-001',
    projectId: 'proj-1',
    goal: 'Add health endpoint',
    phase: 'UNDERSTANDING',
    status: 'RUNNING',
    createdAt: NOW,
    updatedAt: NOW,
    awaitingGate2: false,
    references: { investigationId: 'inv-1' },
    ...overrides,
  };
}

function createAgentApi(overrides: Partial<HttpAgentWorkflow> = {}): HttpAgentWorkflow {
  return {
    start: vi.fn(),
    getStatus: vi.fn(),
    getExplain: vi.fn(),
    plan: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
    toolTurn: vi.fn(),
    providerToolTurn: vi.fn(),
    ...overrides,
  } as unknown as HttpAgentWorkflow;
}

function createGate2PlanResponse(overrides: Partial<AgentPlanResponse> = {}): AgentPlanResponse {
  return {
    run: createRun({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
      references: { investigationId: 'inv-1', preparationId: 'prep-1' },
    }),
    preparationId: 'prep-1',
    expiresAt: NOW,
    awaitingGate2: true,
    gate2Review: {
      schemaVersion: 1,
      totalCharacterCount: 120,
      truncated: false,
      operationCount: 2,
    },
    ...overrides,
  };
}

async function submitGoal(goal = 'Add health endpoint'): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Agent goal/i), {
    target: { value: goal },
  });
  fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
  await waitFor(() => {
    expect(screen.getByText(/Goal:/)).toBeInTheDocument();
  });
}

async function clickPlan(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /^Plan$/i }));
  await screen.findByText(/Paused at Gate 2/i);
}

describe('AgentRunPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts an agent run in UNDERSTANDING without auto-planning', async () => {
    const started: AgentStartResponse = {
      run: createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' }),
      investigationId: 'inv-1',
    };
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue(started),
      getStatus: vi.fn().mockResolvedValue({
        run: started.run,
        toolLoop: EMPTY_TOOL_LOOP,
      }),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal();

    expect(agentApi.start).toHaveBeenCalledWith('Add health endpoint');
    expect(agentApi.plan).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /Investigate before plan/i })).toBeInTheDocument();
    expect(screen.getByText(/Understanding the project/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Tool evidence/i })).toBeInTheDocument();
    expect(screen.getByText(/No digests yet/i)).toBeInTheDocument();
    expect(agentApi.getStatus).toHaveBeenCalledWith('agent-run-001');
  });

  it('plans to Gate 2 only after explicit Plan action', async () => {
    const started: AgentStartResponse = {
      run: createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' }),
      investigationId: 'inv-1',
    };
    const planned = createGate2PlanResponse({
      planningProvenance: {
        schemaVersion: 1,
        hasP0Context: true,
        hasOperatorContext: false,
        p0PathHintCount: 1,
        operatorPathHintCount: 0,
        mergedPathHintCount: 1,
        plannedOperationCount: 2,
        plannedPathOverlapCount: 1,
        unmatchedMergedHintCount: 0,
        p0OnlyPathHints: ['src/p0.ts'],
        operatorOnlyPathHints: [],
        mergedPathHints: ['src/p0.ts'],
        matchedPlannedPaths: ['src/p0.ts'],
        unmatchedMergedPathHints: [],
        truncated: false,
        verification: {
          hasVerificationContext: true,
          baselineStatus: 'FAIL',
          consideredCommandCount: 1,
          failedCommandIds: ['npm-run-build'],
          blockedCommandIds: [],
          timedOutCommandIds: [],
          cancelledCommandIds: [],
          succeededCommandIds: [],
        },
      },
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue(started),
      getStatus: vi.fn().mockResolvedValue({
        run: started.run,
        toolLoop: EMPTY_TOOL_LOOP,
      }),
      plan: vi.fn().mockResolvedValue(planned),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal();
    await clickPlan();

    expect(agentApi.plan).toHaveBeenCalledWith('agent-run-001');
    expect(screen.getAllByText(/Planned operations: 2/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Planning provenance \(read-only\)/i)).toBeInTheDocument();
    expect(screen.getByText(/P0 investigation: Yes/i)).toBeInTheDocument();
    expect(screen.getByText(/Baseline verification considered/i)).toBeInTheDocument();
    expect(screen.getByText(/Build — FAILED/i)).toBeInTheDocument();
    expect(screen.getByText(/Status: FAIL/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve and execute/i })).toBeDisabled();
    expect(agentApi.approve).not.toHaveBeenCalled();
  });

  it('runs investigate → tool turn → explicit plan → Gate 2', async () => {
    const understanding = createRun({
      phase: 'UNDERSTANDING',
      status: 'RUNNING',
      goal: 'Goal',
    });
    const toolTurn = vi.fn().mockResolvedValue({
      run: understanding,
      budget: {
        toolCalls: 1,
        providerTurns: 0,
        b4VerificationCalls: 0,
        browserObservationCalls: 0,
      },
      evidence: [
        {
          toolId: 'retrieve_relevant_context',
          intentId: 'ui-intent-1',
          phase: 'UNDERSTANDING',
          status: 'SUCCEEDED',
          recordedAt: NOW,
          summaryDigest: 'contextdigest012345',
        },
      ],
      turn: { toolId: 'retrieve_relevant_context', status: 'SUCCEEDED' },
    });
    const planned = createGate2PlanResponse();
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({
        run: understanding,
        toolLoop: EMPTY_TOOL_LOOP,
      }),
      toolTurn,
      plan: vi.fn().mockResolvedValue(planned),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');

    fireEvent.change(screen.getByLabelText(/^Tool$/i), {
      target: { value: 'retrieve_relevant_context' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run tool turn/i }));

    await waitFor(() => {
      expect(toolTurn).toHaveBeenCalledTimes(1);
    });
    expect(toolTurn).toHaveBeenCalledWith(
      'agent-run-001',
      expect.objectContaining({
        intent: expect.objectContaining({
          toolId: 'retrieve_relevant_context',
          arguments: { goal: 'Goal' },
        }),
      }),
    );
    expect(screen.getByText(/contextdigest01/i)).toBeInTheDocument();
    expect(agentApi.plan).not.toHaveBeenCalled();

    await clickPlan();
    expect(agentApi.plan).toHaveBeenCalledWith('agent-run-001');
    expect(screen.getByText(/Planned operations: 2/i)).toBeInTheDocument();
  });

  it('shows loading and error states without auto-approving', async () => {
    const agentApi = createAgentApi({
      start: vi.fn().mockRejectedValue(new Error('Provider unavailable')),
    });
    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Broken goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
    });
    expect(agentApi.approve).not.toHaveBeenCalled();
  });

  it('refreshes status from the server', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({
        run: createRun({
          phase: 'EXECUTING',
          status: 'RUNNING',
          awaitingGate2: false,
          references: { preparationId: 'prep-1', workflowId: 'wf-1' },
        }),
      }),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');

    fireEvent.click(screen.getByRole('button', { name: /Refresh status/i }));
    await waitFor(() => {
      expect(screen.getByText(/Executing approved changes/i)).toBeInTheDocument();
    });
    expect(agentApi.getStatus).toHaveBeenCalledWith('agent-run-001');
  });

  it('requires explicit approval and uses /approve', async () => {
    const awaiting = createRun({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
      references: { preparationId: 'prep-1' },
    });
    const approved: AgentApproveSuccessResponse = {
      run: createRun({
        phase: 'COMPLETED',
        status: 'COMPLETED',
        awaitingGate2: false,
        references: { preparationId: 'prep-1', workflowId: 'wf-1' },
      }),
      applyStatus: 'APPLIED',
      verificationStatus: 'PASSED',
      explanation: {
        summary: 'Applied health endpoint changes.',
        applyStatus: 'APPLIED',
        verificationStatus: 'PASSED',
      },
      explain: {
        schemaVersion: 1,
        runId: 'agent-run-001',
        projectId: 'proj-1',
        goal: 'Add health endpoint',
        generatedAt: NOW,
        understood: {
          availability: { status: 'AVAILABLE' },
          goal: 'Add health endpoint',
          investigationId: 'inv-1',
        },
        plan: {
          availability: { status: 'AVAILABLE' },
          preparationId: 'prep-1',
          preparationOutcome: 'READY_FOR_REVIEW',
          plannedOperationCount: 1,
        },
        changes: {
          availability: { status: 'AVAILABLE' },
          applyStatus: 'APPLIED',
          updatedFiles: ['src/health.ts'],
        },
        verification: {
          availability: { status: 'AVAILABLE' },
          overallStatus: 'PASSED',
          stages: [{ stage: 'TEST_VALIDATION', status: 'PASSED' }],
        },
        browserVerification: {
          availability: { status: 'UNAVAILABLE', reason: 'not performed' },
        },
        failures: [],
        corrections: {
          availability: { status: 'UNAVAILABLE', reason: 'none' },
        },
        approvals: { availability: { status: 'AVAILABLE' }, gate2CyclesObserved: 1 },
        toolLoop: {
          availability: { status: 'UNAVAILABLE', reason: 'No tool digests.' },
        },
        finalResult: {
          runPhase: 'COMPLETED',
          runStatus: 'COMPLETED',
          applyStatus: 'APPLIED',
          verificationStatus: 'PASSED',
        },
        evidence: { preparationId: 'prep-1', workflowId: 'wf-1' },
        summary: 'Applied health endpoint changes.',
      },
    };
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: createRun(), investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({ run: createRun(), toolLoop: EMPTY_TOOL_LOOP }),
      plan: vi.fn().mockResolvedValue({
        run: awaiting,
        preparationId: 'prep-1',
        expiresAt: NOW,
        awaitingGate2: true,
        gate2Review: {
          schemaVersion: 1,
          totalCharacterCount: 10,
          truncated: false,
          operationCount: 1,
        },
        applyAuthorizationToken: 'token-xyz',
      }),
      approve: vi.fn().mockResolvedValue(approved),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await clickPlan();

    const approveButton = screen.getByRole('button', { name: /Approve and execute/i });
    expect(approveButton).toBeDisabled();
    fireEvent.click(approveButton);
    expect(agentApi.approve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/I reviewed the planned changes/i));
    expect(approveButton).toBeEnabled();
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(agentApi.approve).toHaveBeenCalledWith('agent-run-001', {
        approved: true,
        applyAuthorizationToken: 'token-xyz',
      });
    });
    expect(screen.getByText(/Applied health endpoint changes/i)).toBeInTheDocument();
    expect(screen.getByText(/Explain artifact/i)).toBeInTheDocument();
    expect(screen.getByText(/Gate 2 cycles observed: 1/i)).toBeInTheDocument();
  });

  it('surfaces approve failures without inventing success', async () => {
    const awaiting = createRun({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: createRun(), investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({
        run: createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' }),
        toolLoop: EMPTY_TOOL_LOOP,
      }),
      plan: vi.fn().mockResolvedValue({
        run: awaiting,
        preparationId: 'prep-1',
        expiresAt: NOW,
        awaitingGate2: true,
        gate2Review: {
          schemaVersion: 1,
          totalCharacterCount: 10,
          truncated: false,
          operationCount: 1,
        },
      }),
      approve: vi.fn().mockRejectedValue(new Error('Approval rejected by server')),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await clickPlan();
    fireEvent.click(screen.getByLabelText(/I reviewed the planned changes/i));
    fireEvent.click(screen.getByRole('button', { name: /Approve and execute/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Approval rejected by server');
    });
    expect(screen.queryByText(/Result summary/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Explain artifact/i)).not.toBeInTheDocument();
  });

  it('cancels a cancellable run via the cancel API', async () => {
    const awaiting = createRun({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: createRun(), investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({
        run: createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' }),
        toolLoop: EMPTY_TOOL_LOOP,
      }),
      plan: vi.fn().mockResolvedValue({
        run: awaiting,
        preparationId: 'prep-1',
        expiresAt: NOW,
        awaitingGate2: true,
        gate2Review: {
          schemaVersion: 1,
          totalCharacterCount: 10,
          truncated: false,
          operationCount: 1,
        },
      }),
      cancel: vi.fn().mockResolvedValue({
        run: createRun({
          phase: 'CANCELLED',
          status: 'CANCELLED',
          awaitingGate2: false,
        }),
      }),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await clickPlan();
    fireEvent.click(screen.getByRole('button', { name: /Cancel run/i }));

    await waitFor(() => {
      expect(agentApi.cancel).toHaveBeenCalled();
      expect(screen.getByText(/Agent run cancelled/i)).toBeInTheDocument();
    });
  });

  it('shows failed and correction state without auto-apply', async () => {
    const awaiting = createRun({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
    });
    const correction: AgentApproveSuccessResponse = {
      run: createRun({
        phase: 'CORRECTING',
        status: 'FAILED',
        awaitingGate2: false,
        references: { correctionWorkflowId: 'corr-1', preparationId: 'prep-1' },
      }),
      applyStatus: 'APPLIED',
      verificationStatus: 'FAILED',
      correctionWorkflowId: 'corr-1',
      canPrepareCorrection: true,
      awaitingCorrectionApproval: true,
      explain: {
        schemaVersion: 1,
        runId: 'agent-run-001',
        projectId: 'proj-1',
        goal: 'Add health endpoint',
        generatedAt: NOW,
        understood: { availability: { status: 'PARTIAL' }, goal: 'Add health endpoint' },
        plan: { availability: { status: 'PARTIAL' }, preparationId: 'prep-1' },
        changes: { availability: { status: 'AVAILABLE' }, applyStatus: 'APPLIED' },
        verification: { availability: { status: 'AVAILABLE' }, overallStatus: 'FAILED' },
        browserVerification: {
          availability: { status: 'UNAVAILABLE', reason: 'absent' },
        },
        failures: [{ source: 'VERIFICATION', code: 'FAILED', message: 'Verification failed' }],
        corrections: {
          availability: { status: 'AVAILABLE' },
          correctionWorkflowId: 'corr-1',
          state: 'CORRECTION_DIAGNOSING',
        },
        approvals: { availability: { status: 'AVAILABLE' }, gate2CyclesObserved: 1 },
        toolLoop: {
          availability: { status: 'UNAVAILABLE', reason: 'No tool digests.' },
        },
        finalResult: {
          runPhase: 'CORRECTING',
          runStatus: 'FAILED',
          applyStatus: 'APPLIED',
          verificationStatus: 'FAILED',
        },
        evidence: { correctionWorkflowId: 'corr-1', preparationId: 'prep-1' },
        summary: 'Correction required after verification failure.',
      },
    };
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: createRun(), investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({
        run: createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' }),
        toolLoop: EMPTY_TOOL_LOOP,
      }),
      plan: vi.fn().mockResolvedValue({
        run: awaiting,
        preparationId: 'prep-1',
        expiresAt: NOW,
        awaitingGate2: true,
        gate2Review: {
          schemaVersion: 1,
          totalCharacterCount: 10,
          truncated: false,
          operationCount: 1,
        },
      }),
      approve: vi.fn().mockResolvedValue(correction),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await clickPlan();
    fireEvent.click(screen.getByLabelText(/I reviewed the planned changes/i));
    fireEvent.click(screen.getByRole('button', { name: /Approve and execute/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Correction required/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/nothing was auto-applied/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Explain artifact/i })).toBeInTheDocument();
    expect(agentApi.approve).toHaveBeenCalledTimes(1);
  });

  it('never calls apply endpoints or auto-approves on mount', () => {
    const agentApi = createAgentApi();
    render(<AgentRunPanel agentApi={agentApi} />);
    expect(agentApi.start).not.toHaveBeenCalled();
    expect(agentApi.plan).not.toHaveBeenCalled();
    expect(agentApi.approve).not.toHaveBeenCalled();
    expect(agentApi.cancel).not.toHaveBeenCalled();
    expect(agentApi.toolTurn).not.toHaveBeenCalled();
    expect(agentApi.providerToolTurn).not.toHaveBeenCalled();
  });

  it('renders durable structured verification status from GET/reload toolLoop', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    const getStatus = vi.fn().mockResolvedValue({
      run: understanding,
      toolLoop: {
        budget: {
          toolCalls: 1,
          providerTurns: 0,
          b4VerificationCalls: 1,
          browserObservationCalls: 0,
        },
        evidence: [
          {
            toolId: 'run_verification_command',
            intentId: 'verify-1',
            phase: 'UNDERSTANDING',
            status: 'FAILED',
            recordedAt: NOW,
            summaryDigest: 'verifydigest0123456789',
            verificationEvidence: {
              evidenceSchemaVersion: 1 as const,
              commandId: 'npm-run-build',
              stage: 'BUILD_VALIDATION',
              executionStatus: 'FAILED',
              exitCode: 1,
              timedOut: false,
              cancelled: false,
              policyBlocked: false,
              outputLimited: false,
            },
          },
          {
            toolId: 'search_repository',
            intentId: 'search-1',
            phase: 'UNDERSTANDING',
            status: 'SUCCEEDED',
            recordedAt: NOW,
            summaryDigest: 'searchdigest0123456789',
          },
        ],
      },
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    fireEvent.click(screen.getByRole('button', { name: /Refresh status/i }));

    await waitFor(() => {
      expect(screen.getByText(/Build — FAILED — exit 1/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/search_repository/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ignore previous/i)).not.toBeInTheDocument();
  });

  it('renders PASSED / TIMEOUT / BLOCKED verification status lines from reload', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    const getStatus = vi.fn().mockResolvedValue({
      run: understanding,
      toolLoop: {
        budget: {
          toolCalls: 3,
          providerTurns: 0,
          b4VerificationCalls: 3,
          browserObservationCalls: 0,
        },
        evidence: [
          {
            toolId: 'run_verification_command',
            intentId: 'v-pass',
            phase: 'UNDERSTANDING',
            status: 'SUCCEEDED',
            recordedAt: NOW,
            summaryDigest: 'passdigest0123456789',
            verificationEvidence: {
              evidenceSchemaVersion: 1 as const,
              commandId: 'npm-run-test',
              stage: 'TEST_VALIDATION',
              executionStatus: 'SUCCEEDED',
              exitCode: 0,
              timedOut: false,
              cancelled: false,
              policyBlocked: false,
              outputLimited: false,
            },
          },
          {
            toolId: 'run_verification_command',
            intentId: 'v-timeout',
            phase: 'UNDERSTANDING',
            status: 'TIMEOUT',
            recordedAt: NOW,
            summaryDigest: 'timedigestdigest0123',
            verificationEvidence: {
              evidenceSchemaVersion: 1 as const,
              commandId: 'npm-run-lint',
              stage: 'LINT_VALIDATION',
              executionStatus: 'TIMEOUT',
              exitCode: null,
              timedOut: true,
              cancelled: false,
              policyBlocked: false,
              outputLimited: true,
            },
          },
          {
            toolId: 'run_verification_command',
            intentId: 'v-block',
            phase: 'UNDERSTANDING',
            status: 'REJECTED_BY_POLICY',
            recordedAt: NOW,
            summaryDigest: 'blockdigest012345678',
            verificationEvidence: {
              evidenceSchemaVersion: 1 as const,
              commandId: 'npm-run-format',
              stage: 'UNKNOWN',
              executionStatus: 'REJECTED_BY_POLICY',
              exitCode: null,
              timedOut: false,
              cancelled: false,
              policyBlocked: true,
              policyBlockCode: 'SCRIPT_UNAVAILABLE',
              outputLimited: false,
            },
          },
        ],
      },
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    fireEvent.click(screen.getByRole('button', { name: /Refresh status/i }));

    await waitFor(() => {
      expect(screen.getByText(/Test — PASSED/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Lint — TIMEOUT/i)).toBeInTheDocument();
    expect(screen.getByText(/Format — BLOCKED — SCRIPT_UNAVAILABLE/i)).toBeInTheDocument();
  });

  it('invokes authorized tool turns only via toolTurn API with runId binding', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    const toolTurn = vi.fn().mockResolvedValue({
      run: understanding,
      budget: {
        toolCalls: 1,
        providerTurns: 0,
        b4VerificationCalls: 0,
        browserObservationCalls: 0,
      },
      evidence: [
        {
          toolId: 'search_repository',
          intentId: 'ui-intent-1',
          phase: 'UNDERSTANDING',
          status: 'SUCCEEDED',
          recordedAt: NOW,
          summaryDigest: 'abcdef0123456789digest',
        },
      ],
      turn: { toolId: 'search_repository', status: 'SUCCEEDED' },
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({ run: understanding, toolLoop: EMPTY_TOOL_LOOP }),
      toolTurn,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await screen.findByRole('heading', { name: /Investigate — bounded tool turn/i });

    fireEvent.change(screen.getByLabelText(/Search query/i), {
      target: { value: 'health' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run tool turn/i }));

    await waitFor(() => {
      expect(toolTurn).toHaveBeenCalledTimes(1);
    });
    expect(toolTurn).toHaveBeenCalledWith(
      'agent-run-001',
      expect.objectContaining({
        intent: expect.objectContaining({
          toolId: 'search_repository',
          arguments: { query: 'health' },
        }),
      }),
    );
    const body = toolTurn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('approved');
    expect(body).not.toHaveProperty('applyAuthorizationToken');
    expect(body).not.toHaveProperty('operatorApproved');
    expect(body).not.toHaveProperty('changePlan');
    expect(body).not.toHaveProperty('phase');
    expect(body).not.toHaveProperty('projectId');
    expect(screen.getByText(/search_repository/i)).toBeInTheDocument();
    expect(screen.getByText(/abcdef0123456789/i)).toBeInTheDocument();
    expect(screen.queryByText(/unifiedDiff/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ChangePlan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/storageState/i)).not.toBeInTheDocument();
  });

  it('prevents concurrent tool-turn submissions and does not auto-loop', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    let resolveTurn: ((value: unknown) => void) | undefined;
    const toolTurn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTurn = resolve;
        }),
    );
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({ run: understanding, toolLoop: EMPTY_TOOL_LOOP }),
      toolTurn,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await screen.findByRole('heading', { name: /Investigate — bounded tool turn/i });
    fireEvent.change(screen.getByLabelText(/Search query/i), {
      target: { value: 'health' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run tool turn/i }));
    await screen.findByRole('button', { name: /Running tool turn/i });
    fireEvent.click(screen.getByRole('button', { name: /Running tool turn/i }));
    expect(toolTurn).toHaveBeenCalledTimes(1);

    resolveTurn?.({
      run: understanding,
      budget: {
        toolCalls: 1,
        providerTurns: 0,
        b4VerificationCalls: 0,
        browserObservationCalls: 0,
      },
      evidence: [],
      turn: {},
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Run tool turn$/i })).toBeEnabled();
    });
    expect(toolTurn).toHaveBeenCalledTimes(1);
  });

  it('hides tool turns in EXECUTING and does not call toolTurn from status refresh', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus: vi
        .fn()
        .mockResolvedValueOnce({ run: understanding, toolLoop: EMPTY_TOOL_LOOP })
        .mockResolvedValueOnce({
          run: createRun({
            phase: 'EXECUTING',
            status: 'RUNNING',
            awaitingGate2: false,
          }),
        }),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await screen.findByRole('heading', { name: /Investigate — bounded tool turn/i });
    fireEvent.click(screen.getByRole('button', { name: /Refresh status/i }));
    await waitFor(() => {
      expect(screen.getByText(/Executing approved changes/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', { name: /Investigate — bounded tool turn/i }),
    ).not.toBeInTheDocument();
    expect(agentApi.toolTurn).not.toHaveBeenCalled();
  });

  it('keeps browser observation approval distinct from Gate2 and never invents it', async () => {
    const diagnosing = createRun({
      phase: 'DIAGNOSING',
      status: 'RUNNING',
      awaitingGate2: false,
    });
    const toolTurn = vi.fn().mockResolvedValue({
      run: diagnosing,
      budget: {
        toolCalls: 0,
        providerTurns: 0,
        b4VerificationCalls: 0,
        browserObservationCalls: 0,
      },
      evidence: [],
      turn: {},
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: createRun(), investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({ run: diagnosing, toolLoop: EMPTY_TOOL_LOOP }),
      toolTurn,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await screen.findByRole('heading', { name: /^Bounded tool turn$/i });

    fireEvent.change(screen.getByLabelText(/^Tool$/i), {
      target: { value: 'run_local_browser_observation' },
    });
    const browserCheckbox = await screen.findByLabelText(/explicitly approve localhost browser/i);
    expect(browserCheckbox).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Run tool turn/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/distinct from Gate 2 and Git/i);
    });
    expect(toolTurn).not.toHaveBeenCalled();

    fireEvent.click(browserCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /Run tool turn/i }));
    await waitFor(() => {
      expect(toolTurn).toHaveBeenCalledTimes(1);
    });
    expect(toolTurn).toHaveBeenCalledWith(
      'agent-run-001',
      expect.objectContaining({
        browserObservationApproved: true,
        intent: expect.objectContaining({
          toolId: 'run_local_browser_observation',
        }),
      }),
    );
    expect(screen.queryByLabelText(/I reviewed the planned changes/i)).not.toBeInTheDocument();
  });

  it('does not offer FileApply, shell, Git write, WEB, or MCP tools in the UI', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({ run: understanding, toolLoop: EMPTY_TOOL_LOOP }),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await screen.findByRole('heading', { name: /Investigate — bounded tool turn/i });
    const options = Array.from(screen.getByLabelText(/^Tool$/i).querySelectorAll('option')).map(
      (option) => option.getAttribute('value'),
    );
    expect(options).toEqual([
      'inspect_verification_catalog',
      'run_verification_command',
      'search_repository',
      'inspect_readiness',
      'retrieve_relevant_context',
      'find_related_files',
      'inspect_file_outline',
      'inspect_imports',
    ]);
    expect(options).not.toContain('file_apply');
    expect(options).not.toContain('approve_and_apply');
    expect(options).not.toContain('commit_git_snapshot');
    expect(options).not.toContain('stage_git_paths');
    expect(options).not.toContain('shell');
    expect(options).not.toContain('mcp');
    expect(options).not.toContain('web');
  });

  it('surfaces tool-turn rejection without inventing success digests', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({ run: understanding, toolLoop: EMPTY_TOOL_LOOP }),
      toolTurn: vi.fn().mockRejectedValue(new Error('PHASE_TOOLS_FORBIDDEN')),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await screen.findByRole('heading', { name: /Investigate — bounded tool turn/i });
    fireEvent.change(screen.getByLabelText(/Search query/i), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run tool turn/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('PHASE_TOOLS_FORBIDDEN');
    });
    expect(screen.getByRole('heading', { name: /Tool evidence/i })).toBeInTheDocument();
    expect(screen.getByText(/No digests yet/i)).toBeInTheDocument();
  });

  it('invokes provider-assisted tool turn via providerToolTurn without client intents', async () => {
    const understanding = createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' });
    const providerToolTurn = vi.fn().mockResolvedValue({
      run: understanding,
      budget: {
        toolCalls: 1,
        providerTurns: 1,
        b4VerificationCalls: 0,
        browserObservationCalls: 0,
      },
      evidence: [
        {
          toolId: 'search_repository',
          intentId: 'psi-1',
          phase: 'UNDERSTANDING',
          status: 'SUCCEEDED',
          recordedAt: NOW,
          summaryDigest: 'providerdigest0123',
        },
      ],
      turn: {},
      emission: {
        source: 'provider-structured-intent',
        toolCalling: false,
        proposedCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
        rejections: [],
      },
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: understanding, investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({ run: understanding, toolLoop: EMPTY_TOOL_LOOP }),
      providerToolTurn,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await screen.findByRole('heading', { name: /Investigate — bounded tool turn/i });
    fireEvent.click(screen.getByRole('button', { name: /Run provider-assisted tool turn/i }));

    await waitFor(() => {
      expect(providerToolTurn).toHaveBeenCalledTimes(1);
    });
    expect(providerToolTurn).toHaveBeenCalledWith('agent-run-001', {});
    expect(agentApi.toolTurn).not.toHaveBeenCalled();
    expect(screen.getByText(/providerdigest01/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Tool evidence/i })).toBeInTheDocument();
    expect(screen.getByText(/Proposed 1 · accepted 1 · rejected 0/i)).toBeInTheDocument();
  });

  it('surfaces bounded provider-assisted rejections without auto-retry', async () => {
    const awaiting = createRun({
      phase: 'UNDERSTANDING',
      status: 'RUNNING',
    });
    const { WorkspaceWorkflowError } = await import('../workspace.types');
    const providerToolTurn = vi.fn().mockRejectedValue(
      new WorkspaceWorkflowError('INVALID_GOAL', 'intents[] must not be empty.', {
        source: 'provider-structured-intent',
        toolCalling: false,
        proposedCount: 0,
        acceptedCount: 0,
        rejectedCount: 1,
        rejections: [
          {
            code: 'EMPTY_INTENTS',
            message: 'intents[] must not be empty.',
            operatorAction: 'RETRY_PROVIDER_ASSISTED',
          },
        ],
      }),
    );
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: awaiting, investigationId: 'inv-1' }),
      getStatus: vi.fn().mockResolvedValue({ run: awaiting, toolLoop: EMPTY_TOOL_LOOP }),
      providerToolTurn,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    await submitGoal('Goal');
    await screen.findByRole('heading', { name: /Investigate — bounded tool turn/i });
    fireEvent.click(screen.getByRole('button', { name: /Run provider-assisted tool turn/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/must not be empty/i);
    });
    expect(screen.getByText(/EMPTY_INTENTS/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /Run provider-assisted tool turn/i }),
    ).toHaveLength(1);
    expect(providerToolTurn).toHaveBeenCalledTimes(1);
  });
});
