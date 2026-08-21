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
    ...overrides,
  } as unknown as HttpAgentWorkflow;
}

describe('AgentRunPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts an agent run and plans to Gate 2', async () => {
    const started: AgentStartResponse = {
      run: createRun({ phase: 'UNDERSTANDING', status: 'RUNNING' }),
      investigationId: 'inv-1',
    };
    const planned: AgentPlanResponse = {
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
    };
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue(started),
      plan: vi.fn().mockResolvedValue(planned),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Add health endpoint' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));

    await waitFor(() => {
      expect(screen.getByText(/Paused at Gate 2/i)).toBeInTheDocument();
    });
    expect(agentApi.start).toHaveBeenCalledWith('Add health endpoint');
    expect(agentApi.plan).toHaveBeenCalledWith('agent-run-001');
    expect(screen.getByText(/Planned operations: 2/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve and execute/i })).toBeDisabled();
    expect(agentApi.approve).not.toHaveBeenCalled();
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
    const awaiting = createRun({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
      references: { preparationId: 'prep-1' },
    });
    const agentApi = createAgentApi({
      start: vi.fn().mockResolvedValue({ run: createRun(), investigationId: 'inv-1' }),
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
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByText(/Paused at Gate 2/i);

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
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByText(/Paused at Gate 2/i);

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
      getStatus: vi.fn().mockResolvedValue({ run: awaiting }),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByText(/Paused at Gate 2/i);
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
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByText(/Paused at Gate 2/i);
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
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByText(/Paused at Gate 2/i);
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
  });
});
