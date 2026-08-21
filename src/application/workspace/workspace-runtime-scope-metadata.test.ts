import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BlueprintReaderService } from '../../core/blueprint-reader';
import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService, type ContextBuildInput } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { InMemoryFileSystemPort } from '../../core/file-apply/test/file-apply.fixture';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import { PromptOrchestratorService, type PromptBuildInput } from '../../core/prompt-orchestrator';
import {
  CORRECTION_OUTPUT_BOUNDING_METADATA,
  TruncationRetryCompactionService,
  TRUNCATION_RETRY_METADATA_ALLOWLIST,
} from '../../core/prompt-orchestrator/services/truncation-retry-compaction.service';
import { ResponseProcessorService } from '../../core/response-processor';
import { VerificationEngineService } from '../../core/verification';
import { createPortHarness } from '../../core/verification/test/verification.fixture';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../infrastructure/project/node-project-file-source';
import { NodeWorkspaceBaseline } from '../../infrastructure/workspace/node-workspace-baseline';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../providers/openai';
import type { ExecutionRequest } from '../../core/execution-engine';
import { buildIterationFeedbackFromGate2Rejection } from './iteration-feedback.service';
import {
  createIndexHtmlUpdateProviderResponse,
  LOCKED_ACCESSIBILITY_REQUEST,
  readSmokeAtelierIndexHtml,
  SMOKE_ATELIER_OPERATOR_REASON,
  SmokeAtelierBaselinePort,
  SmokeAtelierProjectFileSource,
} from './test/smoke-031-scope-metadata.fixture';
import { SMOKE_031_REJECTED_CHANGE_PLAN } from './test/smoke-031-preservation-rejection.fixture';
import type { ProviderExecutionPort, WorkspaceRuntimeLogger } from './workspace-runtime.types';
import { WorkspaceRuntimeService } from './workspace-runtime.service';

const configuration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 120_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

class RecordingContextBuilder extends ContextBuilderService {
  lastInput?: ContextBuildInput;

  override async build(
    input: ContextBuildInput,
    ...parameters: Parameters<ContextBuilderService['build']> extends [
      ContextBuildInput,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) {
    this.lastInput = input;
    return super.build(input, ...parameters);
  }
}

class RecordingPromptOrchestrator extends PromptOrchestratorService {
  lastBuildInput?: PromptBuildInput;

  override async build(input: PromptBuildInput) {
    this.lastBuildInput = input;
    return super.build(input);
  }
}

class RecordingProviderExecutionPort implements ProviderExecutionPort {
  readonly executionRequests: ExecutionRequest[] = [];

  constructor(private readonly inner: ProviderExecutionPort) {}

  async execute(request: ExecutionRequest) {
    this.executionRequests.push(request);
    return this.inner.execute(request);
  }
}

function assertHardIndexHtmlScopeMetadata(
  metadata: Record<string, string | number | boolean>,
): void {
  expect(metadata['update-scope-mode']).toBe('HARD');
  expect(metadata['update-scope-preferred-paths']).toBe('index.html');
  expect(metadata['update-scope-preferred-maximum-operations']).toBe(1);
}

function createSmokeAtelierRuntime(options?: { readonly indexHtml?: string }) {
  const indexHtml = options?.indexHtml ?? readSmokeAtelierIndexHtml();
  const contextBuilder = new RecordingContextBuilder();
  const promptOrchestrator = new RecordingPromptOrchestrator();
  const fileSystem = new InMemoryFileSystemPort();
  const verification = createPortHarness();
  let providerTick = 0;
  const providerClock = (): string =>
    new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async () => ({
        id: 'response-smoke-scope',
        model: 'integration-model',
        status: 'completed',
        output_text: createIndexHtmlUpdateProviderResponse(
          `${indexHtml.replace(
            '<span id="counter-value">0</span>',
            '<span id="counter-value" aria-live="polite">0</span>',
          )}`,
        ),
        error: null,
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      }),
    },
    providerClock,
  );
  const innerExecution = new OpenAIExecutionService(provider, configuration, providerClock);
  const runtimeLogger: WorkspaceRuntimeLogger = { record: () => undefined };
  const providerExecution = new RecordingProviderExecutionPort(innerExecution);
  const timestamp = new Date('2026-07-31T13:00:00.000Z');
  const service = new WorkspaceRuntimeService({
    loadProjectBrain: loadCanonicalProjectBrain,
    blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    sourceFiles: new SmokeAtelierProjectFileSource({
      'index.html': indexHtml,
      'assets/app.js': 'const x = 1;\n',
      'assets/styles.css': 'body {}\n',
      'assets/quotes.json': '[]\n',
    }),
    contextBuilder,
    promptOrchestrator,
    workspaceBaseline: new SmokeAtelierBaselinePort(indexHtml),
    providerExecution,
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(
      undefined,
      undefined,
      new SmokeAtelierBaselinePort(indexHtml),
    ),
    fileApply: new FileApplyEngineService(fileSystem),
    verification: new VerificationEngineService(verification.ports),
    clock: { now: () => new Date(timestamp) },
    ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
    logger: runtimeLogger,
  });
  return { service, contextBuilder, promptOrchestrator, providerExecution };
}

describe('WorkspaceRuntimeService ADR-031 scope metadata (Slice 3b)', () => {
  it('Test A — initial prepare carries HARD index.html scope metadata on final ChangePlan', async () => {
    const { service, contextBuilder, promptOrchestrator } = createSmokeAtelierRuntime();
    const preparation = await service.prepare(LOCKED_ACCESSIBILITY_REQUEST);

    assertHardIndexHtmlScopeMetadata(preparation.changePlan.metadata);
    expect(
      contextBuilder.lastInput?.pinnedBaselineFiles?.some(
        ({ priority }) => priority === 'PINNED_BASELINE',
      ),
    ).toBe(true);
    expect(
      contextBuilder.lastInput?.pinnedBaselineFiles?.some(({ path }) => path === 'index.html'),
    ).toBe(true);
    expect(promptOrchestrator.lastBuildInput?.preservationContract?.scope.mode).toBe('HARD');
    expect(
      promptOrchestrator.lastBuildInput?.preservationContract?.scope.preferredUpdatePaths,
    ).toEqual(['index.html']);
    expect(
      promptOrchestrator.lastBuildInput?.preservationContract?.scope
        .preferredMaximumUpdateOperations,
    ).toBe(1);
    expect(
      promptOrchestrator.lastBuildInput?.preservationContract?.baselines.some(
        ({ logicalPath }) => logicalPath === 'index.html',
      ),
    ).toBe(true);
    expect(preparation.changePlan.changeSet.operations).toHaveLength(1);
    expect(preparation.changePlan.changeSet.operations[0]?.logicalPath).toBe('index.html');
  });

  it('Test B — Gate 2 preservation correction retains HARD index.html scope metadata', async () => {
    const { service, promptOrchestrator } = createSmokeAtelierRuntime();
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      rejectedPreparationId: '85454a81-915c-4dab-aae7-7eff15dcd03f',
      sourcePreparationId: '85454a81-915c-4dab-aae7-7eff15dcd03f',
      operatorReason: SMOKE_ATELIER_OPERATOR_REASON,
      priorRequestSummary: LOCKED_ACCESSIBILITY_REQUEST,
    });

    expect(feedback.preservationRejection).toBeDefined();
    expect(feedback.apply.updatedPaths).toEqual(['index.html']);

    const preparation = await service.prepare(LOCKED_ACCESSIBILITY_REQUEST, feedback);

    assertHardIndexHtmlScopeMetadata(preparation.changePlan.metadata);
    expect(promptOrchestrator.lastBuildInput?.preservationContract?.scope.mode).toBe('HARD');
    expect(
      promptOrchestrator.lastBuildInput?.preservationContract?.scope
        .preferredMaximumUpdateOperations,
    ).toBe(1);
    expect(
      promptOrchestrator.lastBuildInput?.iterationFeedback?.preservationRejection,
    ).toBeDefined();
    expect(preparation.changePlan.metadata['update-scope-preferred-maximum-operations']).not.toBe(
      2,
    );
  });

  it('Gate 2 correction keeps the original request as scope-planner task text', async () => {
    const { service, contextBuilder } = createSmokeAtelierRuntime();
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      rejectedPreparationId: '85454a81-915c-4dab-aae7-7eff15dcd03f',
      operatorReason: SMOKE_ATELIER_OPERATOR_REASON,
      priorRequestSummary: LOCKED_ACCESSIBILITY_REQUEST,
    });

    await service.prepare(LOCKED_ACCESSIBILITY_REQUEST, feedback);

    expect(contextBuilder.lastInput?.projectBrain.tasks.at(-1)?.description).toBe(
      LOCKED_ACCESSIBILITY_REQUEST,
    );
  });

  it('ADR-029 Gate 2 correction bounding uses index.html allowlist on provider attempt metadata', async () => {
    const { service, providerExecution } = createSmokeAtelierRuntime();
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      rejectedPreparationId: '85454a81-915c-4dab-aae7-7eff15dcd03f',
      operatorReason: SMOKE_ATELIER_OPERATOR_REASON,
      priorRequestSummary: LOCKED_ACCESSIBILITY_REQUEST,
    });

    await service.prepare(LOCKED_ACCESSIBILITY_REQUEST, feedback);

    const executionRequest = providerExecution.executionRequests.at(-1);
    expect(executionRequest?.prompt.sections.some(({ kind }) => kind === 'ITERATION')).toBe(true);

    const compaction = new TruncationRetryCompactionService();
    const resolution = compaction.resolveAttempt({ prompt: executionRequest!.prompt, attempt: 1 });
    expect(resolution.boundingActive).toBe(true);
    expect(resolution.allowlist).toEqual(['index.html']);
    expect(resolution.allowlist.length).toBe(1);

    const attemptMetadata = compaction.appendAttemptMetadata({}, resolution);
    expect(attemptMetadata[CORRECTION_OUTPUT_BOUNDING_METADATA]).toBe(true);
    expect(attemptMetadata[TRUNCATION_RETRY_METADATA_ALLOWLIST]).toBe('index.html');
  });

  it('NodeProjectFileSource indexing enables HARD scope metadata for static root layouts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-scope-static-'));
    try {
      const indexHtml = readSmokeAtelierIndexHtml();
      await mkdir(path.join(root, 'assets'), { recursive: true });
      await writeFile(path.join(root, 'index.html'), indexHtml);
      await writeFile(path.join(root, 'assets', 'app.js'), 'console.log(true);\n');
      await writeFile(path.join(root, 'assets', 'styles.css'), 'body {}\n');
      await writeFile(path.join(root, 'assets', 'quotes.json'), '[]\n');

      const sourceFiles = new NodeProjectFileSource(root);
      expect(await sourceFiles.listSourcePaths()).toContain('index.html');

      const contextBuilder = new RecordingContextBuilder();
      const promptOrchestrator = new RecordingPromptOrchestrator();
      const fileSystem = new InMemoryFileSystemPort();
      const verification = createPortHarness();
      let providerTick = 0;
      const providerClock = (): string =>
        new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
      const provider = new OpenAIProvider(
        configuration,
        {
          create: async () => ({
            id: 'response-static-indexing',
            model: 'integration-model',
            status: 'completed',
            output_text: createIndexHtmlUpdateProviderResponse(
              `${indexHtml.replace(
                '<span id="counter-value">0</span>',
                '<span id="counter-value" aria-live="polite">0</span>',
              )}`,
            ),
            error: null,
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          }),
        },
        providerClock,
      );
      const innerExecution = new OpenAIExecutionService(provider, configuration, providerClock);
      const runtimeLogger: WorkspaceRuntimeLogger = { record: () => undefined };
      const providerExecution = new RecordingProviderExecutionPort(innerExecution);
      const baseline = new NodeWorkspaceBaseline(root);
      const service = new WorkspaceRuntimeService({
        loadProjectBrain: loadCanonicalProjectBrain,
        blueprintReader: new BlueprintReaderService(
          new NodeFileSystemDocumentSource(process.cwd()),
        ),
        sourceFiles,
        contextBuilder,
        promptOrchestrator,
        workspaceBaseline: baseline,
        providerExecution,
        responseProcessor: new ResponseProcessorService(),
        changePlanner: new ChangePlannerService(undefined, undefined, baseline),
        fileApply: new FileApplyEngineService(fileSystem),
        verification: new VerificationEngineService(verification.ports),
        clock: { now: () => new Date('2026-07-31T13:00:00.000Z') },
        ids: { generate: () => '123e4567-e89b-12d3-a456-426614174001' },
        logger: runtimeLogger,
      });

      const preparation = await service.prepare(LOCKED_ACCESSIBILITY_REQUEST);
      assertHardIndexHtmlScopeMetadata(preparation.changePlan.metadata);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
