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
    toolTurn: vi.fn(),
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
    expect(agentApi.toolTurn).not.toHaveBeenCalled();
  });

  it('invokes authorized tool turns only via toolTurn API with runId binding', async () => {
    const awaiting = createRun({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
      references: { preparationId: 'prep-1' },
    });
    const toolTurn = vi.fn().mockResolvedValue({
      run: awaiting,
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
          phase: 'AWAITING_GATE2',
          status: 'SUCCEEDED',
          recordedAt: NOW,
          summaryDigest: 'abcdef0123456789digest',
        },
      ],
      turn: { toolId: 'search_repository', status: 'SUCCEEDED' },
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
      toolTurn,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByRole('heading', { name: /Bounded tool turn/i });

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
    const awaiting = createRun({
      phase: 'AWAITING_GATE2',
      status: 'AWAITING_GATE2',
      awaitingGate2: true,
    });
    let resolveTurn: ((value: unknown) => void) | undefined;
    const toolTurn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTurn = resolve;
        }),
    );
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
      toolTurn,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByRole('heading', { name: /Bounded tool turn/i });
    fireEvent.change(screen.getByLabelText(/Search query/i), {
      target: { value: 'health' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run tool turn/i }));
    await screen.findByRole('button', { name: /Running tool turn/i });
    fireEvent.click(screen.getByRole('button', { name: /Running tool turn/i }));
    expect(toolTurn).toHaveBeenCalledTimes(1);

    resolveTurn?.({
      run: awaiting,
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
      getStatus: vi.fn().mockResolvedValue({
        run: createRun({
          phase: 'EXECUTING',
          status: 'RUNNING',
          awaitingGate2: false,
        }),
      }),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByRole('heading', { name: /Bounded tool turn/i });
    fireEvent.click(screen.getByRole('button', { name: /Refresh status/i }));
    await waitFor(() => {
      expect(screen.getByText(/Executing approved changes/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: /Bounded tool turn/i })).not.toBeInTheDocument();
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
      plan: vi.fn().mockResolvedValue({
        run: diagnosing,
        preparationId: 'prep-1',
        expiresAt: NOW,
        awaitingGate2: false,
        gate2Review: {
          schemaVersion: 1,
          totalCharacterCount: 0,
          truncated: false,
          operationCount: 0,
        },
      }),
      toolTurn,
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByRole('heading', { name: /Bounded tool turn/i });

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
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByRole('heading', { name: /Bounded tool turn/i });
    const options = Array.from(screen.getByLabelText(/^Tool$/i).querySelectorAll('option')).map(
      (option) => option.getAttribute('value'),
    );
    expect(options).toEqual(['search_repository', 'inspect_readiness']);
    expect(options).not.toContain('file_apply');
    expect(options).not.toContain('approve_and_apply');
    expect(options).not.toContain('commit_git_snapshot');
    expect(options).not.toContain('stage_git_paths');
    expect(options).not.toContain('shell');
    expect(options).not.toContain('mcp');
    expect(options).not.toContain('web');
  });

  it('surfaces tool-turn rejection without inventing success digests', async () => {
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
      toolTurn: vi.fn().mockRejectedValue(new Error('PHASE_TOOLS_FORBIDDEN')),
      getStatus: vi.fn().mockResolvedValue({ run: awaiting }),
    });

    render(<AgentRunPanel agentApi={agentApi} />);
    fireEvent.change(screen.getByLabelText(/Agent goal/i), {
      target: { value: 'Goal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start agent run/i }));
    await screen.findByRole('heading', { name: /Bounded tool turn/i });
    fireEvent.change(screen.getByLabelText(/Search query/i), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run tool turn/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('PHASE_TOOLS_FORBIDDEN');
    });
    expect(screen.queryByText(/Tool evidence/i)).not.toBeInTheDocument();
  });
});
