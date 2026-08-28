import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRunError } from '../../../../application/workspace/agent-operating';
import { WorkspaceRuntimeError } from '../../../../application/workspace';

const startRun = vi.fn();
const getRun = vi.fn();
const plan = vi.fn();
const pauseAtGate2 = vi.fn();
const executeAfterApproval = vi.fn();
const explain = vi.fn();
const getExplainArtifact = vi.fn();
const getToolEvidence = vi.fn();
const cancel = vi.fn();
const whenReady = vi.fn(async () => undefined);

vi.mock('../../../../infrastructure/workspace/local-feature-workflow-runtime', () => ({
  getReadyLocalAgentOperatingService: async () => ({
    whenReady,
    startRun,
    getRun,
    plan,
    pauseAtGate2,
    executeAfterApproval,
    explain,
    getExplainArtifact,
    getToolEvidence,
    cancel,
  }),
  getLocalWorkspaceSecurityConfiguration: () => ({
    profile: 'TRUSTED_LOCAL',
    projectId: 'builder-ai',
    principalId: 'local-operator',
  }),
}));

function baseRun(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    projectId: 'builder-ai',
    goal: 'Add banner',
    phase: 'UNDERSTANDING',
    status: 'RUNNING',
    references: { investigationId: 'inv-1' },
    createdAt: '2026-08-21T10:00:00.000Z',
    updatedAt: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  importRoute: () => Promise<{ POST: (...args: never[]) => Promise<Response> }>,
  context?: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { POST } = await importRoute();
  const request = new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  // Route handlers differ by whether they require Next.js params.
  const invoke = POST as unknown as (
    request: Request,
    context?: { params: Promise<{ runId: string }> },
  ) => Promise<Response>;
  return context === undefined ? invoke(request) : invoke(request, context);
}

describe('Agent Operating HTTP API', () => {
  beforeEach(() => {
    startRun.mockReset();
    getRun.mockReset();
    plan.mockReset();
    pauseAtGate2.mockReset();
    executeAfterApproval.mockReset();
    explain.mockReset();
    getExplainArtifact.mockReset();
    getToolEvidence.mockReset();
    getToolEvidence.mockResolvedValue({ evidence: [] });
    cancel.mockReset();
    whenReady.mockClear();
  });

  it('starts a run', async () => {
    startRun.mockResolvedValueOnce({
      run: baseRun(),
      investigation: { investigationId: 'inv-1' },
    });
    const response = await postJson(
      '/api/workspace/agent/run',
      { goal: 'Add banner' },
      () => import('./run/route'),
    );
    const payload = (await response.json()) as {
      run: { runId: string; phase: string };
      investigationId: string;
    };
    expect(response.status).toBe(200);
    expect(payload.run.runId).toBe('run-1');
    expect(payload.run.phase).toBe('UNDERSTANDING');
    expect(payload.investigationId).toBe('inv-1');
    expect(startRun).toHaveBeenCalledWith('Add banner');
  });

  it('rejects unauthorized start (non-loopback origin)', async () => {
    const { POST } = await import('./run/route');
    const response = await POST(
      new Request('http://localhost:3000/api/workspace/agent/run', {
        method: 'POST',
        headers: {
          origin: 'http://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ goal: 'x' }),
      }),
    );
    expect(response.status).toBe(403);
    expect(startRun).not.toHaveBeenCalled();
  });

  it('gets run status', async () => {
    getRun.mockResolvedValueOnce(baseRun({ phase: 'AWAITING_GATE2', status: 'AWAITING_GATE2' }));
    const { GET } = await import('./run/[runId]/route');
    const response = await GET(
      new Request('http://localhost:3000/api/workspace/agent/run/run-1', {
        method: 'GET',
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    const payload = (await response.json()) as {
      run: { awaitingGate2: boolean; phase: string };
    };
    expect(response.status).toBe(200);
    expect(payload.run.phase).toBe('AWAITING_GATE2');
    expect(payload.run.awaitingGate2).toBe(true);
  });

  it('returns 404 for unknown run', async () => {
    getRun.mockRejectedValueOnce(new AgentRunError('NOT_FOUND', 'missing'));
    const { GET } = await import('./run/[runId]/route');
    const response = await GET(
      new Request('http://localhost:3000/api/workspace/agent/run/missing', {
        method: 'GET',
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'missing' }) },
    );
    expect(response.status).toBe(404);
  });

  it('plans and reaches AWAITING_GATE2 without mutating via client ChangePlan', async () => {
    getRun.mockResolvedValue(baseRun({ phase: 'UNDERSTANDING' }));
    plan.mockResolvedValueOnce({
      run: baseRun({ phase: 'PLANNING', references: { preparationId: 'prep-1' } }),
      preparationId: 'prep-1',
      expiresAt: 't',
      gate2Review: {
        schemaVersion: 1,
        operationDiffs: [{ operationId: 'op-1' }],
        totalCharacterCount: 10,
        truncated: false,
      },
    });
    pauseAtGate2.mockResolvedValueOnce({
      run: baseRun({
        phase: 'AWAITING_GATE2',
        status: 'AWAITING_GATE2',
        references: { preparationId: 'prep-1' },
      }),
      preparationId: 'prep-1',
      expiresAt: 't',
      gate2Review: {
        schemaVersion: 1,
        operationDiffs: [{ operationId: 'op-1', logicalPath: 'src/a.ts' }],
        totalCharacterCount: 10,
        truncated: false,
      },
      planningProvenance: {
        schemaVersion: 1,
        hasP0Context: true,
        hasOperatorContext: true,
        p0PathHintCount: 1,
        operatorPathHintCount: 1,
        mergedPathHintCount: 2,
        plannedOperationCount: 1,
        plannedPathOverlapCount: 1,
        unmatchedMergedHintCount: 1,
        p0OnlyPathHints: ['src/p0.ts'],
        operatorOnlyPathHints: ['src/op.ts'],
        mergedPathHints: ['src/p0.ts', 'src/op.ts'],
        matchedPlannedPaths: ['src/a.ts'],
        unmatchedMergedPathHints: ['src/unmatched.ts'],
        truncated: false,
      },
    });
    const response = await postJson(
      '/api/workspace/agent/run/run-1/plan',
      {},
      () => import('./run/[runId]/plan/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    const payload = (await response.json()) as {
      run: { phase: string; awaitingGate2?: boolean };
      awaitingGate2: boolean;
      gate2Review: { operationCount: number };
      planningProvenance?: {
        hasP0Context: boolean;
        operatorOnlyPathHints: string[];
        matchedPlannedPaths: string[];
      };
    };
    expect(response.status).toBe(200);
    expect(payload.run.phase).toBe('AWAITING_GATE2');
    expect(payload.awaitingGate2).toBe(true);
    expect(payload.gate2Review.operationCount).toBe(1);
    expect(payload.planningProvenance?.hasP0Context).toBe(true);
    expect(payload.planningProvenance?.operatorOnlyPathHints).toEqual(['src/op.ts']);
    expect(payload.planningProvenance?.matchedPlannedPaths).toEqual(['src/a.ts']);
    const bodyText = JSON.stringify(payload);
    expect(bodyText).not.toMatch(/unifiedDiff|fileContents|applyAuthorizationToken|changePlan/i);
    expect(plan).toHaveBeenCalled();
    expect(pauseAtGate2).toHaveBeenCalled();
  });

  it('rejects client-supplied planningProvenance on plan', async () => {
    const response = await postJson(
      '/api/workspace/agent/run/run-1/plan',
      { planningProvenance: { hasP0Context: true } },
      () => import('./run/[runId]/plan/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(400);
    expect(plan).not.toHaveBeenCalled();
  });

  it('rejects client-injected ChangePlan on plan', async () => {
    const response = await postJson(
      '/api/workspace/agent/run/run-1/plan',
      { changePlan: { evil: true } },
      () => import('./run/[runId]/plan/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(400);
    expect(plan).not.toHaveBeenCalled();
  });

  it('rejects client-injected diff/baseline on approve', async () => {
    const response = await postJson(
      '/api/workspace/agent/run/run-1/approve',
      { approved: true, baselineDigest: 'forged', diff: 'x' },
      () => import('./run/[runId]/approve/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(400);
    expect(executeAfterApproval).not.toHaveBeenCalled();
  });

  it('approve before Gate2 returns 409', async () => {
    getRun.mockResolvedValueOnce(baseRun({ phase: 'PLANNING' }));
    executeAfterApproval.mockRejectedValueOnce(
      new AgentRunError('INVALID_TRANSITION', 'requires AWAITING_GATE2'),
    );
    const response = await postJson(
      '/api/workspace/agent/run/run-1/approve',
      { approved: true },
      () => import('./run/[runId]/approve/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(409);
  });

  it('approve requires explicit operator intent', async () => {
    getRun.mockResolvedValueOnce(baseRun({ phase: 'AWAITING_GATE2', status: 'AWAITING_GATE2' }));
    const response = await postJson(
      '/api/workspace/agent/run/run-1/approve',
      { approved: false },
      () => import('./run/[runId]/approve/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(400);
    expect(executeAfterApproval).not.toHaveBeenCalled();
  });

  it('approved execution reaches executeAfterApproval and explain', async () => {
    getRun.mockResolvedValue(
      baseRun({
        phase: 'AWAITING_GATE2',
        status: 'AWAITING_GATE2',
        references: { preparationId: 'prep-1' },
      }),
    );
    executeAfterApproval.mockResolvedValueOnce({
      run: baseRun({
        phase: 'VERIFYING',
        references: { preparationId: 'prep-1', workflowId: 'prep-1' },
      }),
      completion: {
        applyResult: { status: 'APPLIED' },
        verificationReport: { status: 'PASSED' },
      },
    });
    explain.mockResolvedValueOnce({
      run: baseRun({ phase: 'COMPLETED', status: 'COMPLETED' }),
      explanation: {
        summary: 'done',
        applyStatus: 'APPLIED',
        verificationStatus: 'PASSED',
      },
    });
    const response = await postJson(
      '/api/workspace/agent/run/run-1/approve',
      { approved: true },
      () => import('./run/[runId]/approve/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    const payload = (await response.json()) as {
      run: { phase: string };
      applyStatus: string;
    };
    expect(response.status).toBe(200);
    expect(payload.run.phase).toBe('COMPLETED');
    expect(payload.applyStatus).toBe('APPLIED');
    expect(executeAfterApproval).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ approved: true }),
    );
    expect(explain).toHaveBeenCalledWith('run-1');
  });

  it('cancels without APPLY', async () => {
    getRun.mockResolvedValueOnce(baseRun());
    cancel.mockResolvedValueOnce({
      run: baseRun({ phase: 'CANCELLED', status: 'CANCELLED' }),
    });
    const response = await postJson(
      '/api/workspace/agent/run/run-1/cancel',
      { reason: 'stop' },
      () => import('./run/[runId]/cancel/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    const payload = (await response.json()) as { run: { phase: string } };
    expect(response.status).toBe(200);
    expect(payload.run.phase).toBe('CANCELLED');
    expect(cancel).toHaveBeenCalled();
    expect(executeAfterApproval).not.toHaveBeenCalled();
  });

  it('terminal cancel fails closed', async () => {
    getRun.mockResolvedValueOnce(baseRun({ phase: 'COMPLETED', status: 'COMPLETED' }));
    cancel.mockRejectedValueOnce(new AgentRunError('TERMINAL_STATE', 'terminal'));
    const response = await postJson(
      '/api/workspace/agent/run/run-1/cancel',
      {},
      () => import('./run/[runId]/cancel/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(409);
  });

  it('rejects malformed goal', async () => {
    const response = await postJson(
      '/api/workspace/agent/run',
      { goal: '' },
      () => import('./run/route'),
    );
    expect(response.status).toBe(400);
  });

  it('rejects path-traversal runId', async () => {
    const { GET } = await import('./run/[runId]/route');
    const response = await GET(
      new Request('http://localhost:3000/api/workspace/agent/run/../escape', {
        method: 'GET',
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: '../escape' }) },
    );
    expect(response.status).toBe(400);
  });

  it('status view does not leak changePlan or raw bodies', async () => {
    getRun.mockResolvedValueOnce(
      baseRun({
        phase: 'AWAITING_GATE2',
        status: 'AWAITING_GATE2',
        references: { preparationId: 'prep-1' },
      }),
    );
    const { GET } = await import('./run/[runId]/route');
    const response = await GET(
      new Request('http://localhost:3000/api/workspace/agent/run/run-1', {
        method: 'GET',
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    const text = await response.text();
    expect(text).not.toMatch(/changePlan|screenshot|stdout|api_key|bearer /i);
  });

  it('maps workspace runtime apply conflicts to 409', async () => {
    getRun.mockResolvedValueOnce(baseRun({ phase: 'AWAITING_GATE2', status: 'AWAITING_GATE2' }));
    executeAfterApproval.mockRejectedValueOnce(
      new WorkspaceRuntimeError('PREPARATION_NOT_FOUND', 'gone'),
    );
    const response = await postJson(
      '/api/workspace/agent/run/run-1/approve',
      { approved: true },
      () => import('./run/[runId]/approve/route'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(409);
  });

  it('GET explain returns artifact without mutating and enforces workspace isolation', async () => {
    getRun.mockResolvedValueOnce(baseRun({ phase: 'COMPLETED', status: 'COMPLETED' }));
    getExplainArtifact.mockResolvedValueOnce({
      run: baseRun({ phase: 'COMPLETED', status: 'COMPLETED' }),
      explain: {
        schemaVersion: 1,
        runId: 'run-1',
        projectId: 'builder-ai',
        goal: 'Add banner',
        generatedAt: '2026-08-21T10:00:00.000Z',
        understood: { availability: { status: 'AVAILABLE' }, goal: 'Add banner' },
        plan: { availability: { status: 'UNAVAILABLE', reason: 'missing' } },
        changes: { availability: { status: 'UNAVAILABLE', reason: 'missing' } },
        verification: { availability: { status: 'UNAVAILABLE', reason: 'missing' } },
        browserVerification: { availability: { status: 'UNAVAILABLE', reason: 'missing' } },
        failures: [],
        corrections: { availability: { status: 'UNAVAILABLE', reason: 'none' } },
        approvals: { availability: { status: 'UNAVAILABLE', reason: 'none' } },
        toolLoop: { availability: { status: 'UNAVAILABLE', reason: 'none' } },
        finalResult: { runPhase: 'COMPLETED', runStatus: 'COMPLETED' },
        evidence: {},
        summary: 'Completed.',
      },
      persisted: true,
    });
    const { GET } = await import('./run/[runId]/explain/route');
    const response = await GET(
      new Request('http://localhost:3000/api/workspace/agent/run/run-1/explain', {
        method: 'GET',
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      explain: { summary: string };
      persisted: boolean;
    };
    expect(body.persisted).toBe(true);
    expect(body.explain.summary).toBe('Completed.');
    expect(explain).not.toHaveBeenCalled();
    expect(executeAfterApproval).not.toHaveBeenCalled();

    getRun.mockResolvedValueOnce(baseRun({ projectId: 'other-project' }));
    const isolated = await GET(
      new Request('http://localhost:3000/api/workspace/agent/run/run-1/explain', {
        method: 'GET',
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(isolated.status).toBe(404);
    expect(getExplainArtifact).toHaveBeenCalledTimes(1);
  });
});
