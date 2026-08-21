import { describe, expect, it } from 'vitest';

import { mkdtempSync } from 'node:fs';
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
import { createAppliedResult } from '../../../core/verification/test/verification.fixture';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import { NullWorkspaceBaselinePort } from '../../../core/update-scope/test/workspace-baseline.fixture';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../../providers/openai';
import { buildIterationFeedbackFromCompletion } from '../iteration-feedback.service';
import { WorkspaceRuntimeService } from '../workspace-runtime.service';
import {
  CORRECTED_CHANGE_PLAN,
  VERIFICATION_REPORT,
} from '../../../ui/workspace/test/workspace.fixture';
import { CorrectionLoopService } from './correction-loop.service';

const configuration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 120_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

describe('P0-9 production correction composition', () => {
  it('uses CorrectionLoopService with normal PREPARE, approval, APPLY, and verification', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const verification = createPortHarness();
    const runtime = createRuntime(fileSystem, verification.ports);
    const correction = new CorrectionLoopService();

    await runtime.prepare('Create the approved integration artifact.');
    const failedCompletion = {
      applyResult: createAppliedResult({ updatedFiles: ['src/integration-output.ts'] }),
      verificationReport: { ...VERIFICATION_REPORT, status: 'FAILED' as const },
    };

    const began = await correction.beginFromCompletion('wf-prod', failedCompletion, {
      originalTaskSummary: 'Create the approved integration artifact.',
    });
    expect(began.canPrepare).toBe(true);

    const iterationFeedback = buildIterationFeedbackFromCompletion(failedCompletion);
    const correctionPrepare = await runtime.prepare(began.correctionRequest, iterationFeedback);
    const waiting = await correction.recordPrepared(
      'wf-prod',
      correctionPrepare.preparationId,
      correctionPrepare.changePlan,
    );
    expect(waiting.state).toBe('CORRECTION_WAITING_FOR_APPROVAL');

    await correction.recordApplying('wf-prod');
    const completion = await runtime.approveAndApply(correctionPrepare.preparationId, true);
    expect(completion.runtimeBrowserVerificationReport?.status).toBe('PASSED');
    const verified = await correction.recordVerificationComplete('wf-prod', completion);
    expect(verified.state).toBe('CORRECTION_PASSED');
  });

  it('blocks out-of-scope correction ChangePlans server-side', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginFromCompletion(
      'wf-scope',
      {
        applyResult: createAppliedResult({ updatedFiles: ['src/example.ts'] }),
        verificationReport: {
          ...VERIFICATION_REPORT,
          status: 'FAILED',
        },
      },
      { originalTaskSummary: 'Fix example.ts' },
    );
    const blocked = await correction.recordPrepared('wf-scope', 'prep-1', CORRECTED_CHANGE_PLAN);
    expect(blocked.state).toBe('CORRECTION_BLOCKED');
    expect(blocked.blockCode).toBe('CORRECTION_SCOPE_VIOLATION');
  });
});

function createRuntime(
  fileSystem: InMemoryFileSystemPort,
  verificationPorts: ConstructorParameters<typeof VerificationEngineService>[0],
): WorkspaceRuntimeService {
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async () => ({
        id: 'response-integration',
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
    () => new Date().toISOString(),
  );

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
    providerExecution: new OpenAIExecutionService(provider, configuration),
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply: new FileApplyEngineService(fileSystem),
    verification: new VerificationEngineService(verificationPorts),
    runtimeBrowserVerification: {
      async verify() {
        return {
          schemaVersion: 1 as const,
          status: 'PASSED' as const,
          server: {
            descriptorId: 'npm-run-dev',
            status: 'READY' as const,
            url: 'http://127.0.0.1:39990',
            port: 39_990,
            startupDurationMs: 1,
          },
          browser: {
            status: 'PASSED' as const,
            durationMs: 1,
            routes: [
              {
                path: '/',
                status: 'PASSED' as const,
                durationMs: 1,
                consoleErrors: [],
                pageExceptions: [],
                failedRequests: [],
              },
            ],
            consoleErrorCount: 0,
            pageExceptionCount: 0,
            failedRequestCount: 0,
          },
          durationMs: 2,
          metadata: {},
        };
      },
    },
    projectRoot: mkdtempSync(path.join(tmpdir(), 'builderai-p09-')),
    clock: { now: () => new Date('2026-07-31T13:00:00.000Z') },
    ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
    logger: { record: () => undefined },
  });
}
