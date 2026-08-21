import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlueprintReaderService } from '../../../../core/blueprint-reader';
import { ChangePlannerService } from '../../../../core/change-planner';
import { ContextBuilderService } from '../../../../core/context-builder';
import { FileApplyEngineService } from '../../../../core/file-apply';
import { InMemoryFileSystemPort } from '../../../../core/file-apply/test/file-apply.fixture';
import { loadCanonicalProjectBrain } from '../../../../core/project-brain';
import { PromptOrchestratorService } from '../../../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../../../core/response-processor';
import { VerificationEngineService } from '../../../../core/verification';
import { createPortHarness } from '../../../../core/verification/test/verification.fixture';
import type { VerificationStagePortResult } from '../../../../core/verification';
import { NodeFileSystemDocumentSource } from '../../../../infrastructure/blueprint-reader';
import { NullWorkspaceBaselinePort } from '../../../../core/update-scope/test/workspace-baseline.fixture';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../../../providers/openai';
import {
  AgentOperatingService,
  AgentRunPersistence,
  AgentRunService,
  ExplainArtifactPersistence,
} from '../../../../application/workspace/agent-operating';
import { CorrectionLoopService } from '../../../../application/workspace/correction-loop';
import { WorkspaceRuntimeService } from '../../../../application/workspace/workspace-runtime.service';

const configuration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 120_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

class CountingFileApplyEngineService extends FileApplyEngineService {
  calls = 0;

  override async apply(
    ...parameters: Parameters<FileApplyEngineService['apply']>
  ): Promise<Awaited<ReturnType<FileApplyEngineService['apply']>>> {
    this.calls += 1;
    return super.apply(...parameters);
  }
}

let agentService: AgentOperatingService;
let fileApply: CountingFileApplyEngineService;
let fileSystem: InMemoryFileSystemPort;
let stateRoot: string;
let verificationHarness: ReturnType<typeof createPortHarness>;

vi.mock('../../../../infrastructure/workspace/local-feature-workflow-runtime', () => ({
  getReadyLocalAgentOperatingService: async () => agentService,
  getLocalWorkspaceSecurityConfiguration: () => ({
    profile: 'TRUSTED_LOCAL',
    projectId: 'builder-ai',
    principalId: 'local-operator',
  }),
}));

describe('Agent HTTP production composition', () => {
  beforeEach(async () => {
    stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-agent-http-'));
    fileSystem = new InMemoryFileSystemPort();
    fileApply = new CountingFileApplyEngineService(fileSystem);
    verificationHarness = createPortHarness();
    const runtime = createRuntime(fileSystem, verificationHarness.ports, fileApply);
    agentService = new AgentOperatingService({
      projectId: 'builder-ai',
      agentRuns: new AgentRunService(
        new AgentRunPersistence(stateRoot, 'builder-ai'),
        () => new Date('2026-08-21T18:00:00.000Z'),
      ),
      explainArtifacts: new ExplainArtifactPersistence(stateRoot, 'builder-ai'),
      investigation: {
        investigate: async (request) =>
          ({
            investigationId: 'inv-http-1',
            request,
            report: {
              schemaVersion: 1,
              investigationId: 'inv-http-1',
              summary: 'ok',
              confidence: 'MEDIUM',
              hypotheses: [],
              evidence: [],
              affectedAreas: [],
              recommendedNextSteps: [],
              limitations: [],
            },
            searchResult: { schemaVersion: 1, matches: [], queries: [], truncated: false },
            repositorySourcePaths: [],
            bounded: true,
          }) as never,
        resolveInvestigationHandoff: () => undefined,
      },
      runtime,
      correction: new CorrectionLoopService(),
      ids: { generate: () => 'agent-http-run-1' },
      clock: { now: () => new Date('2026-08-21T18:00:00.000Z') },
    });
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it('HTTP start→plan→approve→FileApply→verify→COMPLETED', async () => {
    const start = await (
      await import('./run/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'Create the approved integration artifact.' }),
      }),
    );
    expect(start.status).toBe(200);
    expect(fileApply.calls).toBe(0);

    const planned = await (
      await import('./run/[runId]/plan/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run/agent-http-run-1/plan', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: 'agent-http-run-1' }) },
    );
    const planBody = (await planned.json()) as {
      run: { phase: string; references: { preparationId?: string } };
      awaitingGate2: boolean;
    };
    expect(planned.status).toBe(200);
    expect(planBody.run.phase).toBe('AWAITING_GATE2');
    expect(planBody.awaitingGate2).toBe(true);
    expect(fileApply.calls).toBe(0);
    expect(fileSystem.mutationCalls).toEqual([]);

    const status = await (
      await import('./run/[runId]/route')
    ).GET(
      new Request('http://localhost:3000/api/workspace/agent/run/agent-http-run-1', {
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'agent-http-run-1' }) },
    );
    const statusBody = (await status.json()) as { run: { awaitingGate2: boolean } };
    expect(statusBody.run.awaitingGate2).toBe(true);

    const approved = await (
      await import('./run/[runId]/approve/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run/agent-http-run-1/approve', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      }),
      { params: Promise.resolve({ runId: 'agent-http-run-1' }) },
    );
    const approveBody = (await approved.json()) as {
      run: { phase: string; references: { workflowId?: string } };
      applyStatus: string;
      verificationStatus: string;
    };
    expect(approved.status).toBe(200);
    expect(approveBody.run.phase).toBe('COMPLETED');
    expect(approveBody.applyStatus).toBe('APPLIED');
    expect(approveBody.verificationStatus).toBe('PASSED');
    expect(fileApply.calls).toBe(1);
    expect(fileSystem.mutationCalls).toEqual(['create:src/integration-output.ts']);
    expect(verificationHarness.calls).toContain('BUILD_VALIDATION');
    expect(approveBody.run.references.workflowId).toBeDefined();
  });

  it('concurrent approve — at most one APPLY', async () => {
    await (
      await import('./run/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'Create the approved integration artifact.' }),
      }),
    );
    await (
      await import('./run/[runId]/plan/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run/agent-http-run-1/plan', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: 'agent-http-run-1' }) },
    );

    const { POST: approve } = await import('./run/[runId]/approve/route');
    const makeApprove = () =>
      approve(
        new Request('http://localhost:3000/api/workspace/agent/run/agent-http-run-1/approve', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
          body: JSON.stringify({ approved: true }),
        }),
        { params: Promise.resolve({ runId: 'agent-http-run-1' }) },
      );

    const [first, second] = await Promise.all([makeApprove(), makeApprove()]);
    expect(fileApply.calls).toBe(1);
    expect([first.status, second.status].some((status) => status === 200)).toBe(true);
    // Second may fail closed (409) or idempotently replay completion (200); never a second APPLY.
    expect(fileSystem.mutationCalls).toEqual(['create:src/integration-output.ts']);
  });

  it('AWAITING_GATE2 survives AgentRun reload via GET', async () => {
    await (
      await import('./run/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'Create the approved integration artifact.' }),
      }),
    );
    await (
      await import('./run/[runId]/plan/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run/agent-http-run-1/plan', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: 'agent-http-run-1' }) },
    );

    agentService = new AgentOperatingService({
      projectId: 'builder-ai',
      agentRuns: new AgentRunService(
        new AgentRunPersistence(stateRoot, 'builder-ai'),
        () => new Date('2026-08-21T19:00:00.000Z'),
      ),
      explainArtifacts: new ExplainArtifactPersistence(stateRoot, 'builder-ai'),
      investigation: {
        investigate: async () => {
          throw new Error('should not re-investigate');
        },
        resolveInvestigationHandoff: () => undefined,
      },
      runtime: {
        prepare: async () => {
          throw new Error('should not re-plan');
        },
        approveAndApply: async () => {
          throw new Error('should not apply');
        },
      },
      correction: new CorrectionLoopService(),
      ids: { generate: () => 'unused' },
      clock: { now: () => new Date('2026-08-21T19:00:00.000Z') },
    });

    const status = await (
      await import('./run/[runId]/route')
    ).GET(
      new Request('http://localhost:3000/api/workspace/agent/run/agent-http-run-1', {
        headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
      }),
      { params: Promise.resolve({ runId: 'agent-http-run-1' }) },
    );
    const body = (await status.json()) as { run: { phase: string; awaitingGate2: boolean } };
    expect(status.status).toBe(200);
    expect(body.run.phase).toBe('AWAITING_GATE2');
    expect(body.run.awaitingGate2).toBe(true);
    expect(fileApply.calls).toBe(0);
  });

  it('verification failure enters CORRECTING without auto second APPLY', async () => {
    const failed: VerificationStagePortResult = {
      status: 'FAILED',
      warnings: [],
      errors: [{ code: 'STAGE_FAILED', message: 'fail' }],
      metadata: {},
    };
    const harness = createPortHarness({ BUILD_VALIDATION: failed });
    fileSystem = new InMemoryFileSystemPort();
    fileApply = new CountingFileApplyEngineService(fileSystem);
    agentService = new AgentOperatingService({
      projectId: 'builder-ai',
      agentRuns: new AgentRunService(
        new AgentRunPersistence(stateRoot, 'builder-ai'),
        () => new Date('2026-08-21T20:00:00.000Z'),
      ),
      explainArtifacts: new ExplainArtifactPersistence(stateRoot, 'builder-ai'),
      investigation: {
        investigate: async (request) =>
          ({
            investigationId: 'inv-fail',
            request,
            report: {
              schemaVersion: 1,
              investigationId: 'inv-fail',
              summary: 'ok',
              confidence: 'MEDIUM',
              hypotheses: [],
              evidence: [],
              affectedAreas: [],
              recommendedNextSteps: [],
              limitations: [],
            },
            searchResult: { schemaVersion: 1, matches: [], queries: [], truncated: false },
            repositorySourcePaths: [],
            bounded: true,
          }) as never,
        resolveInvestigationHandoff: () => undefined,
      },
      runtime: createRuntime(fileSystem, harness.ports, fileApply),
      correction: new CorrectionLoopService(),
      ids: { generate: () => 'agent-http-fail-1' },
      clock: { now: () => new Date('2026-08-21T20:00:00.000Z') },
    });

    await (
      await import('./run/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'Create the approved integration artifact.' }),
      }),
    );
    await (
      await import('./run/[runId]/plan/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run/agent-http-fail-1/plan', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: 'agent-http-fail-1' }) },
    );
    const approved = await (
      await import('./run/[runId]/approve/route')
    ).POST(
      new Request('http://localhost:3000/api/workspace/agent/run/agent-http-fail-1/approve', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      }),
      { params: Promise.resolve({ runId: 'agent-http-fail-1' }) },
    );
    const body = (await approved.json()) as {
      run: { phase: string };
      correctionWorkflowId?: string;
      awaitingCorrectionApproval?: boolean;
    };
    expect(approved.status).toBe(200);
    expect(body.run.phase).toBe('CORRECTING');
    expect(body.correctionWorkflowId).toBeDefined();
    expect(body.awaitingCorrectionApproval).toBe(true);
    expect(fileApply.calls).toBe(1);
  });
});

function createRuntime(
  fsPort: InMemoryFileSystemPort,
  verificationPorts: ConstructorParameters<typeof VerificationEngineService>[0],
  applyEngine: FileApplyEngineService,
): WorkspaceRuntimeService {
  let providerTick = 0;
  const providerClock = (): string =>
    new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async () => ({
        id: 'response-agent-http',
        model: 'integration-model',
        status: 'completed',
        output_text: JSON.stringify({
          summary: 'Created an integration artifact.',
          artifacts: [
            {
              logicalPath: 'src/integration-output.ts',
              type: 'SOURCE_FILE',
              content: 'export const integrated = true;\n',
              metadata: {
                description: 'Create the integration artifact',
                'change-operation': 'CREATE_FILE',
              },
            },
          ],
          diagnostics: [],
        }),
        error: null,
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      }),
    },
    providerClock,
  );
  const timestamp = new Date('2026-07-31T13:00:00.000Z');
  return new WorkspaceRuntimeService({
    loadProjectBrain: loadCanonicalProjectBrain,
    blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    sourceFiles: {
      listSourcePaths: async () => [],
      readSourceFile: async () => {
        throw new Error('No source reads expected.');
      },
    },
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    workspaceBaseline: new NullWorkspaceBaselinePort(),
    providerExecution: new OpenAIExecutionService(provider, configuration, providerClock),
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply: applyEngine,
    verification: new VerificationEngineService(verificationPorts),
    clock: { now: () => new Date(timestamp) },
    ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
    logger: { record: () => undefined },
  });
}
