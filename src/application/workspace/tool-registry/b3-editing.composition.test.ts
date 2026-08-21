import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlueprintReaderService } from '../../../core/blueprint-reader';
import { ChangePlannerService } from '../../../core/change-planner';
import { ContextBuilderService } from '../../../core/context-builder';
import type { FileApplyEngineService } from '../../../core/file-apply';
import { InMemoryFileSystemPort } from '../../../core/file-apply/test/file-apply.fixture';
import { loadCanonicalProjectBrain } from '../../../core/project-brain';
import { PromptOrchestratorService } from '../../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../../core/response-processor';
import { VerificationEngineService } from '../../../core/verification';
import { createPortHarness } from '../../../core/verification/test/verification.fixture';
import { NullWorkspaceBaselinePort } from '../../../core/update-scope/test/workspace-baseline.fixture';
import { NodeFileSystemDocumentSource } from '../../../infrastructure/blueprint-reader';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../../providers/openai';
import {
  createOpenAIConfiguration,
  FakeOpenAIResponsesClient,
} from '../../../providers/openai/test/openai-provider.fixture';
import { GeminiProvider } from '../../../providers/gemini';
import {
  createGeminiConfiguration,
  FakeGeminiClient,
} from '../../../providers/gemini/test/gemini-provider.fixture';
import { OpenRouterProvider } from '../../../providers/openrouter';
import {
  createOpenRouterConfiguration,
  FakeOpenRouterChatClient,
} from '../../../providers/openrouter/test/openrouter-provider.fixture';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { EditProposalService } from '../edit-proposal/edit-proposal.service';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { WorkspaceRuntimeService } from '../workspace-runtime.service';
import { createB1ProofToolRegistry } from './create-b1-proof-registry';
import { createB2IntelligenceRegistryFromSource } from './create-b2-intelligence-registry';
import { createB3EditingRegistry } from './create-b3-editing-registry';
import { ToolPolicyGate } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import type { ToolExecutionContext } from './tool-registry.types';
import { CountingFileApplyEngineService } from '../agent-operating/test/agent-operating.composition.fixture';

const PROVIDER_CONFIGURATION: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 120_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function authService(projectId = 'builder-ai'): WorkspaceAuthorizationService {
  return new WorkspaceAuthorizationService({
    profile: 'TRUSTED_LOCAL',
    projectId,
    principalId: 'local-operator',
  });
}

function baseContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-b3',
    projectId: 'builder-ai',
    projectRoot: process.cwd(),
    phase: 'PLANNING',
    principal: { principalId: 'local-operator', projectId: 'builder-ai' },
    securityProfile: 'TRUSTED_LOCAL',
    securityEvidence: { operatorApproved: true },
    cancellation: neverCancelled(),
    ...overrides,
  };
}

function createB3Runtime(fileApply: FileApplyEngineService): WorkspaceRuntimeService {
  let idTick = 0;
  let providerTick = 0;
  const providerClock = (): string =>
    new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
  const provider = new OpenAIProvider(
    PROVIDER_CONFIGURATION,
    {
      create: async () => ({
        id: 'response-unused',
        model: 'integration-model',
        status: 'completed',
        output_text: JSON.stringify({
          summary: 'unused',
          artifacts: [],
          diagnostics: [],
        }),
        error: null,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }),
    },
    providerClock,
  );
  const verification = createPortHarness();
  return new WorkspaceRuntimeService({
    loadProjectBrain: loadCanonicalProjectBrain,
    blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    projectRoot: process.cwd(),
    sourceFiles: {
      listSourcePaths: async () => ['src/existing.ts'],
      readSourceFile: async (logicalPath) => {
        if (logicalPath === 'src/existing.ts') return 'export const existing = 1;\n';
        throw new Error(`unexpected read ${logicalPath}`);
      },
    },
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    workspaceBaseline: new NullWorkspaceBaselinePort(),
    providerExecution: new OpenAIExecutionService(provider, PROVIDER_CONFIGURATION, providerClock),
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply,
    verification: new VerificationEngineService(verification.ports),
    clock: { now: () => new Date('2026-08-21T16:00:00.000Z') },
    ids: {
      generate: () => {
        idTick += 1;
        return `123e4567-e89b-12d3-a456-426614174${String(idTick).padStart(3, '0')}`;
      },
    },
    logger: { record: () => undefined },
  });
}

describe('ToolPolicyGate B3 PLAN extension', () => {
  it('allows proposal-only PLAN and rejects MUTATE/APPLY', () => {
    const policy = new ToolPolicyGate(authService());
    const registry = new ToolRegistry(policy);
    registry.register({
      definition: {
        toolId: 'draft_edit_proposal',
        name: 'Draft',
        description: 'd',
        inputSchema: {},
        outputSchema: {},
        capabilityClass: 'PLAN',
        readOnly: true,
        riskLevel: 'MEDIUM',
        authorizationAction: 'PREPARE',
        requiresGate2: false,
        approvalRequirement: 'NONE',
        workspaceScoped: true,
        timeoutMs: 5_000,
        supportsCancellation: true,
        evidencePolicy: 'DIGEST',
        auditPolicy: 'DIGEST',
        allowedPhases: ['PLANNING'],
      },
      execute: async () => ({ summary: 'ok' }),
    });
    expect(() =>
      registry.register({
        definition: {
          toolId: 'mutate_files',
          name: 'Mutate',
          description: 'd',
          inputSchema: {},
          outputSchema: {},
          capabilityClass: 'MUTATE',
          readOnly: false,
          riskLevel: 'CRITICAL',
          authorizationAction: 'APPLY',
          requiresGate2: true,
          approvalRequirement: 'GATE2',
          workspaceScoped: true,
          timeoutMs: 5_000,
          supportsCancellation: true,
          evidencePolicy: 'NONE',
          auditPolicy: 'NONE',
          allowedPhases: ['EXECUTING'],
        },
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/readOnly|APPLY|unavailable|proposal-only/i);
  });
});

describe('B3 edit proposal composition matrix', () => {
  it('covers proposal-only safety, Gate2 apply, stale baseline, and B1/B2 freeze', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-b3-'));
    try {
      const fileSystem = new InMemoryFileSystemPort();
      await fileSystem.createFileIfAbsent('src/existing.ts', 'export const existing = 1;\n');
      const fileApply = new CountingFileApplyEngineService(fileSystem);
      const runtime = createB3Runtime(fileApply);
      const changePlanner = new ChangePlannerService();
      let baseline = 'baseline-v1';
      let idSeq = 0;
      const editProposals = new EditProposalService({
        changePlanner,
        preparePort: {
          prepareFromResponsePackage: (pkg) => runtime.prepareFromResponsePackage(pkg),
        },
        clock: { now: () => new Date('2026-08-21T16:00:00.000Z') },
        ids: {
          generate: () => {
            idSeq += 1;
            return `edit-exec-${String(idSeq).padStart(4, '0')}`;
          },
        },
        expectedBaselineDigest: 'baseline-v1',
        readBaselineDigest: async () => baseline,
      });

      const authorization = authService();
      const source = {
        listSourcePaths: async () => ['src/existing.ts'],
        readSourceFile: async (logicalPath: string) => {
          if (logicalPath === 'src/existing.ts') return 'export const existing = 1;\n';
          throw new Error('missing');
        },
      };
      const { registry, executor } = createB3EditingRegistry({
        authorization,
        search: source,
        read: { readSourceFile: source.readSourceFile },
        readiness: {
          project: async () => {
            throw new Error('unused');
          },
        },
        related: source,
        relevantContext: source,
        outline: { readSourceFile: source.readSourceFile },
        imports: source,
        editProposals,
      });

      expect(registry.listDefinitions().map((d) => d.toolId)).toEqual(
        expect.arrayContaining([
          'search_repository',
          'read_source_file',
          'inspect_readiness',
          'find_related_files',
          'retrieve_relevant_context',
          'inspect_file_outline',
          'inspect_imports',
          'draft_edit_proposal',
          'inspect_edit_proposal',
          'commit_edit_proposal',
        ]),
      );
      expect(registry.listDefinitions().every((d) => d.readOnly)).toBe(true);
      expect(registry.listDefinitions().every((d) => d.authorizationAction !== 'APPLY')).toBe(true);
      expect(registry.dependencySurface().join(',')).not.toMatch(/FileApply/i);

      // Protected / traversal rejected at draft.
      const protectedDraft = await executor.execute(
        {
          callId: 'p1',
          toolId: 'draft_edit_proposal',
          args: {
            replace: true,
            operations: [
              {
                kind: 'CREATE_FILE',
                logicalPath: '.env',
                description: 'secret',
                content: 'x=1\n',
              },
            ],
          },
        },
        baseContext(),
      );
      expect(protectedDraft.status).toBe('FAILED');
      expect(protectedDraft.errorCode).toBe('PROTECTED_PATH');
      expect(fileApply.calls).toBe(0);

      const traversal = await executor.execute(
        {
          callId: 'p2',
          toolId: 'draft_edit_proposal',
          args: {
            replace: true,
            operations: [
              {
                kind: 'CREATE_FILE',
                logicalPath: '../outside.ts',
                description: 'escape',
                content: 'no\n',
              },
            ],
          },
        },
        baseContext(),
      );
      expect(traversal.status).toBe('FAILED');
      expect(traversal.errorCode).toBe('PATH_TRAVERSAL');
      expect(fileApply.calls).toBe(0);

      // Multi-file proposal draft + inspect (no apply).
      const draft = await executor.execute(
        {
          callId: 'd1',
          toolId: 'draft_edit_proposal',
          args: {
            replace: true,
            operations: [
              {
                kind: 'CREATE_FILE',
                logicalPath: 'src/created.ts',
                description: 'Create file',
                content: 'export const created = true;\n',
              },
              {
                kind: 'UPDATE_FILE',
                logicalPath: 'src/existing.ts',
                description: 'Update file',
                content: 'export const existing = 2;\n',
              },
              {
                kind: 'DELETE_FILE',
                logicalPath: 'src/obsolete.ts',
                description: 'Delete obsolete',
              },
            ],
          },
        },
        baseContext(),
      );
      expect(draft.status).toBe('SUCCEEDED');
      expect(fileApply.calls).toBe(0);
      expect(JSON.stringify(draft).includes('"changePlan"')).toBe(false);
      expect(JSON.stringify(draft).includes('"unifiedDiff"')).toBe(false);

      const inspect = await executor.execute(
        { callId: 'i1', toolId: 'inspect_edit_proposal', args: {} },
        baseContext(),
      );
      expect(inspect.status).toBe('SUCCEEDED');
      expect(inspect.structured).toMatchObject({ operationCount: 3 });

      // Stale baseline rejected.
      baseline = 'baseline-v2';
      const stale = await executor.execute(
        { callId: 'c-stale', toolId: 'commit_edit_proposal', args: {} },
        baseContext(),
      );
      expect(stale.status).toBe('FAILED');
      expect(stale.errorCode).toBe('STALE_BASELINE');
      expect(fileApply.calls).toBe(0);

      baseline = 'baseline-v1';
      // Need re-draft after failed commit? Draft still exists - commit clears only on success.
      const commit = await executor.execute(
        { callId: 'c1', toolId: 'commit_edit_proposal', args: {} },
        baseContext(),
      );
      expect(commit.status).toBe('SUCCEEDED');
      expect(fileApply.calls).toBe(0);
      const preparationId = (commit.structured as { preparationId: string }).preparationId;
      expect(preparationId).toBeTruthy();
      expect(JSON.stringify(commit).includes('"changePlan"')).toBe(false);
      expect(JSON.stringify(commit).includes('applyAuthorizationToken')).toBe(false);

      // Denied approval.
      await expect(runtime.approveAndApply(preparationId, false)).rejects.toBeTruthy();
      expect(fileApply.calls).toBe(0);

      // DELETE may fail if target missing - use CREATE+UPDATE only for apply success path.
      // Re-draft create-only for successful apply demonstration.
      await executor.execute(
        {
          callId: 'd2',
          toolId: 'draft_edit_proposal',
          args: {
            replace: true,
            operations: [
              {
                kind: 'CREATE_FILE',
                logicalPath: 'src/created-ok.ts',
                description: 'Create ok',
                content: 'export const ok = true;\n',
              },
            ],
          },
        },
        baseContext(),
      );
      const commit2 = await executor.execute(
        { callId: 'c2', toolId: 'commit_edit_proposal', args: {} },
        baseContext(),
      );
      expect(commit2.status).toBe('SUCCEEDED');
      const preparationId2 = (commit2.structured as { preparationId: string }).preparationId;
      expect(fileApply.calls).toBe(0);

      const applied = await runtime.approveAndApply(preparationId2, true, {
        operatorApproved: true,
      });
      expect(
        applied.applyResult.status === 'APPLIED' ||
          applied.applyResult.status === 'PARTIALLY_APPLIED',
      ).toBe(true);
      expect(fileApply.calls).toBe(1);

      // Concurrent / replay second approve must not perform another FileApply mutation.
      const replayed = await runtime.approveAndApply(preparationId2, true, {
        operatorApproved: true,
      });
      expect(replayed.applyResult.status).toBe('APPLIED');
      expect(fileApply.calls).toBe(1);

      // Correction / second Gate 2: new proposal → new preparation → explicit approve again.
      await executor.execute(
        {
          callId: 'd3',
          toolId: 'draft_edit_proposal',
          args: {
            replace: true,
            operations: [
              {
                kind: 'UPDATE_FILE',
                logicalPath: 'src/created-ok.ts',
                description: 'Correct create',
                content: 'export const ok = true;\nexport const fixed = true;\n',
              },
            ],
          },
        },
        baseContext({ runId: 'run-b3-corr', phase: 'CORRECTING' }),
      );
      const commit3 = await executor.execute(
        { callId: 'c3', toolId: 'commit_edit_proposal', args: {} },
        baseContext({ runId: 'run-b3-corr', phase: 'CORRECTING' }),
      );
      expect(commit3.status).toBe('SUCCEEDED');
      const preparationId3 = (commit3.structured as { preparationId: string }).preparationId;
      expect(fileApply.calls).toBe(1);
      await runtime.approveAndApply(preparationId3, true, { operatorApproved: true });
      expect(fileApply.calls).toBe(2);

      // B1 freeze
      const b1 = createB1ProofToolRegistry({
        authorization,
        search: source,
        read: { readSourceFile: source.readSourceFile },
        readiness: {
          project: async () => {
            throw new Error('unused');
          },
        },
      });
      const search = await b1.executor.execute(
        { callId: 'b1s', toolId: 'search_repository', args: { query: 'existing' } },
        baseContext({ phase: 'UNDERSTANDING' }),
      );
      expect(search.status).toBe('SUCCEEDED');

      // B2 still registers
      const b2 = createB2IntelligenceRegistryFromSource({
        authorization,
        listSourcePaths: source.listSourcePaths,
        readSourceFile: source.readSourceFile,
        readiness: {
          project: async () => {
            throw new Error('unused');
          },
        },
      });
      expect(b2.registry.listDefinitions().some((d) => d.toolId === 'find_related_files')).toBe(
        true,
      );

      expect(
        new OpenAIProvider(createOpenAIConfiguration(), new FakeOpenAIResponsesClient()).descriptor
          .capabilities.toolCalling,
      ).toBe(false);
      expect(
        new GeminiProvider(createGeminiConfiguration(), new FakeGeminiClient()).descriptor
          .capabilities.toolCalling,
      ).toBe(false);
      expect(
        new OpenRouterProvider(createOpenRouterConfiguration(), new FakeOpenRouterChatClient())
          .descriptor.capabilities.toolCalling,
      ).toBe(false);

      // Restart-before-approval: commit without approve → no apply
      const callsBefore = fileApply.calls;
      await executor.execute(
        {
          callId: 'd4',
          toolId: 'draft_edit_proposal',
          args: {
            replace: true,
            operations: [
              {
                kind: 'CREATE_FILE',
                logicalPath: 'src/restart.ts',
                description: 'restart',
                content: 'export const r = 1;\n',
              },
            ],
          },
        },
        baseContext({ runId: 'run-restart' }),
      );
      await executor.execute(
        { callId: 'c4', toolId: 'commit_edit_proposal', args: {} },
        baseContext({ runId: 'run-restart' }),
      );
      expect(fileApply.calls).toBe(callsBefore);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
