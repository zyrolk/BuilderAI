import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlueprintReaderService } from '../../../core/blueprint-reader';
import { ChangePlannerService } from '../../../core/change-planner';
import { ContextBuilderService } from '../../../core/context-builder';
import { FileApplyEngineService } from '../../../core/file-apply';
import { InMemoryFileSystemPort } from '../../../core/file-apply/test/file-apply.fixture';
import { loadCanonicalProjectBrain } from '../../../core/project-brain';
import { PromptOrchestratorService } from '../../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../../core/response-processor';
import { VerificationEngineService } from '../../../core/verification';
import { createPortHarness } from '../../../core/verification/test/verification.fixture';
import type { VerificationStagePortResult } from '../../../core/verification';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import { NullWorkspaceBaselinePort } from '../../../core/update-scope/test/workspace-baseline.fixture';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../../providers/openai';
import { CorrectionLoopService } from '../correction-loop';
import { WorkspaceRuntimeService } from '../workspace-runtime.service';
import { AgentOperatingService } from './agent-operating.service';
import { AgentRunPersistence } from './agent-run.persistence';
import { AgentRunService } from './agent-run.service';
import { ExplainArtifactPersistence } from './explain-artifact.persistence';
import type { AgentOperatingInvestigationPort } from './agent-operating.types';

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

describe('P1-A Step 2 production composition', () => {
  it('orchestrates start→plan→Gate2→approveAndApply→verify→explain via existing services', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-agent-comp-'));
    try {
      const fileSystem = new InMemoryFileSystemPort();
      const fileApply = new CountingFileApplyEngineService(fileSystem);
      const verification = createPortHarness();
      const runtime = createRuntime(fileSystem, verification.ports, fileApply);
      const investigation = createStubInvestigation();
      const correction = new CorrectionLoopService();
      const agentRuns = new AgentRunService(
        new AgentRunPersistence(stateRoot, 'builder-ai'),
        () => new Date('2026-08-21T15:00:00.000Z'),
      );
      const agent = new AgentOperatingService({
        projectId: 'builder-ai',
        agentRuns,
        explainArtifacts: new ExplainArtifactPersistence(stateRoot, 'builder-ai'),
        investigation,
        runtime,
        correction,
        ids: { generate: () => 'agent-run-comp-1' },
        clock: { now: () => new Date('2026-08-21T15:00:00.000Z') },
      });

      const started = await agent.startRun('Create the approved integration artifact.');
      expect(started.run.phase).toBe('UNDERSTANDING');
      expect(started.run.references.investigationId).toBe('inv-comp-1');
      expect(fileApply.calls).toBe(0);
      expect(fileSystem.mutationCalls).toEqual([]);

      const planned = await agent.plan('agent-run-comp-1');
      expect(planned.run.phase).toBe('PLANNING');
      expect(planned.run.references.preparationId).toBeDefined();
      expect(fileApply.calls).toBe(0);
      expect(fileSystem.mutationCalls).toEqual([]);

      const paused = await agent.pauseAtGate2('agent-run-comp-1');
      expect(paused.run.phase).toBe('AWAITING_GATE2');
      expect(paused.run.status).toBe('AWAITING_GATE2');
      expect(fileApply.calls).toBe(0);

      await expect(
        agent.executeAfterApproval('agent-run-comp-1', { approved: false }),
      ).rejects.toBeTruthy();
      expect(fileApply.calls).toBe(0);

      const executed = await agent.executeAfterApproval('agent-run-comp-1', { approved: true });
      expect('completion' in executed).toBe(true);
      if (!('completion' in executed)) throw new Error('expected success path');
      expect(executed.run.phase).toBe('VERIFYING');
      expect(executed.run.references.workflowId).toBe(planned.preparationId);
      expect(fileApply.calls).toBe(1);
      expect(fileSystem.mutationCalls).toEqual(['create:src/integration-output.ts']);
      expect(verification.calls).toContain('BUILD_VALIDATION');
      expect(executed.completion.verificationReport?.status).toBe('PASSED');

      const explained = await agent.explain('agent-run-comp-1');
      expect(explained.run.phase).toBe('COMPLETED');
      expect(explained.run.status).toBe('COMPLETED');
      expect(explained.explanation.references.workflowId).toBe(planned.preparationId);
      expect(fileApply.calls).toBe(1);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('verification failure uses CorrectionLoopService without auto-approve/apply', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-agent-fail-'));
    try {
      const fileSystem = new InMemoryFileSystemPort();
      const fileApply = new CountingFileApplyEngineService(fileSystem);
      const failedStage: VerificationStagePortResult = {
        status: 'FAILED',
        warnings: [],
        errors: [{ code: 'STAGE_FAILED', message: 'Simulated stage failure.' }],
        metadata: {},
      };
      const verification = createPortHarness({
        BUILD_VALIDATION: failedStage,
      });
      const runtime = createRuntime(fileSystem, verification.ports, fileApply);
      const correction = new CorrectionLoopService();
      const agent = new AgentOperatingService({
        projectId: 'builder-ai',
        agentRuns: new AgentRunService(
          new AgentRunPersistence(stateRoot, 'builder-ai'),
          () => new Date('2026-08-21T16:00:00.000Z'),
        ),
        explainArtifacts: new ExplainArtifactPersistence(stateRoot, 'builder-ai'),
        investigation: createStubInvestigation(),
        runtime,
        correction,
        ids: { generate: () => 'agent-run-fail-1' },
        clock: { now: () => new Date('2026-08-21T16:00:00.000Z') },
      });

      await agent.startRun('Create the approved integration artifact.');
      await agent.plan('agent-run-fail-1');
      await agent.pauseAtGate2('agent-run-fail-1');
      const result = await agent.executeAfterApproval('agent-run-fail-1', { approved: true });

      expect('correctionWorkflowId' in result).toBe(true);
      if (!('correctionWorkflowId' in result)) throw new Error('expected failure path');
      expect(result.run.phase).toBe('CORRECTING');
      expect(result.run.references.correctionWorkflowId).toBeDefined();
      expect(result.canPrepareCorrection).toBe(true);
      expect(fileApply.calls).toBe(1);
      const session = correction.getSession(result.correctionWorkflowId);
      expect(session).toBeDefined();
      expect(session?.state).not.toBe('CORRECTION_APPLYING');
      // No second apply / no auto approval path
      expect(fileApply.calls).toBe(1);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});

function createStubInvestigation(): AgentOperatingInvestigationPort {
  return {
    investigate: async (request) =>
      ({
        investigationId: 'inv-comp-1',
        request,
        report: {
          schemaVersion: 1,
          investigationId: 'inv-comp-1',
          summary: 'Composition investigation',
          confidence: 'MEDIUM',
          hypotheses: [],
          evidence: [],
          affectedAreas: [],
          recommendedNextSteps: ['prepare'],
          limitations: [],
        },
        searchResult: {
          schemaVersion: 1,
          matches: [],
          queries: [],
          truncated: false,
        },
        repositorySourcePaths: [],
        bounded: true,
      }) as never,
    resolveInvestigationHandoff: () => undefined,
  };
}

function createRuntime(
  fileSystem: InMemoryFileSystemPort,
  verificationPorts: ConstructorParameters<typeof VerificationEngineService>[0],
  fileApply: FileApplyEngineService,
): WorkspaceRuntimeService {
  let providerTick = 0;
  const providerClock = (): string =>
    new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async () => ({
        id: 'response-agent-comp',
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
    fileApply,
    verification: new VerificationEngineService(verificationPorts),
    clock: { now: () => new Date(timestamp) },
    ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
    logger: { record: () => undefined },
  });
}
