import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createAgentCompositionHarness,
  type AgentCompositionHarness,
} from '../../../../application/workspace/agent-operating/test/agent-operating.composition.fixture';

let harness: AgentCompositionHarness;
let stateRoot: string;

vi.mock('../../../../infrastructure/workspace/local-feature-workflow-runtime', () => ({
  getReadyLocalAgentOperatingService: async () => harness.agent,
  getLocalWorkspaceSecurityConfiguration: () => ({
    profile: 'TRUSTED_LOCAL',
    projectId: 'builder-ai',
    principalId: 'local-operator',
  }),
}));

describe('P1-A Step 6 HTTP E2E', () => {
  beforeEach(async () => {
    stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-http-'));
    harness = createAgentCompositionHarness({
      stateRoot,
      runId: 'http-e2e-run',
      includeBrowserVerification: true,
    });
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it('E2E-6 HTTP: start→plan→status→approve→explain without client mutation', async () => {
    const { POST: startPost } = await import('./run/route');
    const startResponse = await startPost(
      new Request('http://localhost:3000/api/workspace/agent/run', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'Create the approved integration artifact.' }),
      }),
    );
    expect(startResponse.status).toBe(200);
    const started = (await startResponse.json()) as { run: { runId: string; phase: string } };
    expect(started.run.phase).toBe('UNDERSTANDING');
    expect(harness.fileApply.calls).toBe(0);

    const { POST: planPost } = await import('./run/[runId]/plan/route');
    const planResponse = await planPost(
      new Request('http://localhost:3000/api/workspace/agent/run/http-e2e-run/plan', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: 'http-e2e-run' }) },
    );
    expect(planResponse.status).toBe(200);
    const planned = (await planResponse.json()) as {
      awaitingGate2: boolean;
      run: { phase: string };
    };
    expect(planned.awaitingGate2).toBe(true);
    expect(planned.run.phase).toBe('AWAITING_GATE2');
    expect(harness.fileApply.calls).toBe(0);

    const { GET: statusGet } = await import('./run/[runId]/route');
    const statusResponse = await statusGet(
      new Request('http://localhost:3000/api/workspace/agent/run/http-e2e-run', {
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'http-e2e-run' }) },
    );
    const statusBody = (await statusResponse.json()) as { run: { phase: string } };
    expect(statusBody.run.phase).toBe('AWAITING_GATE2');

    const { POST: approvePost } = await import('./run/[runId]/approve/route');
    const denyResponse = await approvePost(
      new Request('http://localhost:3000/api/workspace/agent/run/http-e2e-run/approve', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ approved: false }),
      }),
      { params: Promise.resolve({ runId: 'http-e2e-run' }) },
    );
    expect(denyResponse.status).toBeGreaterThanOrEqual(400);
    expect(harness.fileApply.calls).toBe(0);

    const approveResponse = await approvePost(
      new Request('http://localhost:3000/api/workspace/agent/run/http-e2e-run/approve', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      }),
      { params: Promise.resolve({ runId: 'http-e2e-run' }) },
    );
    expect(approveResponse.status).toBe(200);
    const approved = (await approveResponse.json()) as {
      run: { status: string };
      explain: {
        changes: { applyStatus?: string };
        browserVerification: { overallStatus?: string };
      };
    };
    expect(approved.run.status).toBe('COMPLETED');
    expect(approved.explain.changes.applyStatus).toBe('APPLIED');
    expect(harness.fileApply.calls).toBe(1);

    const { GET: explainGet } = await import('./run/[runId]/explain/route');
    const explainResponse = await explainGet(
      new Request('http://localhost:3000/api/workspace/agent/run/http-e2e-run/explain', {
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'http-e2e-run' }) },
    );
    expect(explainResponse.status).toBe(200);
    const explainBody = (await explainResponse.json()) as {
      persisted: boolean;
      explain: { finalResult: { runStatus: string } };
    };
    expect(explainBody.persisted).toBe(true);
    expect(explainBody.explain.finalResult.runStatus).toBe('COMPLETED');

    // Client cannot inject ChangePlan through plan.
    const inject = await planPost(
      new Request('http://localhost:3000/api/workspace/agent/run/http-e2e-run/plan', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ changePlan: { schemaVersion: 1 } }),
      }),
      { params: Promise.resolve({ runId: 'http-e2e-run' }) },
    );
    expect(inject.status).toBeGreaterThanOrEqual(400);
    expect(harness.fileApply.calls).toBe(1);
  });

  it('E2E-6 HTTP: cancel at Gate 2 leaves zero mutations', async () => {
    await harness.agent.startRun('Create the approved integration artifact.');
    await harness.agent.plan('http-e2e-run');
    await harness.agent.pauseAtGate2('http-e2e-run');

    const { POST: cancelPost } = await import('./run/[runId]/cancel/route');
    const cancelResponse = await cancelPost(
      new Request('http://localhost:3000/api/workspace/agent/run/http-e2e-run/cancel', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'stop' }),
      }),
      { params: Promise.resolve({ runId: 'http-e2e-run' }) },
    );
    expect(cancelResponse.status).toBe(200);
    expect(harness.fileApply.calls).toBe(0);
    expect((await harness.agent.getRun('http-e2e-run')).phase).toBe('CANCELLED');
  });
});
