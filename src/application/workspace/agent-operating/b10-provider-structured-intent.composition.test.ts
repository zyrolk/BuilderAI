/**
 * @vitest-environment node
 *
 * P1-B B10 — AgentOperating provider-assisted tool turn (ADR-046).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ChangePlannerService } from '../../../core/change-planner';
import {
  createOpenAIConfiguration,
  FakeOpenAIResponsesClient,
} from '../../../providers/openai/test/openai-provider.fixture';
import { OpenAIProvider } from '../../../providers/openai';
import { InMemoryAppliedFileApplyBindingStore } from '../controlled-git/applied-file-apply-binding.port';
import { ControlledTerminalService } from '../controlled-terminal/controlled-terminal.service';
import { CorrectionLoopService } from '../correction-loop';
import { EditProposalService } from '../edit-proposal/edit-proposal.service';
import type { ExternalTargetReadiness } from '../external-target-readiness/external-target-readiness.types';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import type { ProviderExecutionPort } from '../workspace-runtime.types';
import { createControlledGitService } from '../tool-registry/create-b5-git-registry';
import { createControlledLocalBrowserService } from '../tool-registry/create-b7-browser-registry';
import { createAgentLoopComposition } from '../agent-loop';
import { AgentLoopEvidencePersistence } from '../agent-loop/agent-loop.persistence';
import { AgentOperatingService } from './agent-operating.service';
import { AgentRunPersistence } from './agent-run.persistence';
import { AgentRunService } from './agent-run.service';
import { ExplainArtifactPersistence } from './explain-artifact.persistence';
import { createStubInvestigation } from './test/agent-operating.composition.fixture';

function readinessStub(projectId = 'builder-ai'): ExternalTargetReadiness {
  return {
    schemaVersion: 1,
    status: 'READY',
    profile: 'EXTERNAL_TARGET',
    projectId,
    projectName: 'BuilderAI',
    projectRootDisplay: '.',
    runtimeConnected: true,
    sourceRoots: ['src'],
    testRoots: [],
    governanceDocuments: [],
    indexedFileCount: 1,
    protectedAreas: [],
    verification: {
      build: true,
      test: true,
      lint: false,
      typecheck: false,
      format: false,
      devServer: false,
      browserVerification: false,
    },
    warnings: [],
    blockers: [],
  };
}

describe('ADR-046 B10 provider-assisted tool turn', { timeout: 60_000 }, () => {
  it('proposes via providerExecution then executes only through AgentLoop; toolCalling stays false', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-b10-'));
    const projectId = 'builder-ai';
    try {
      const authorization = new WorkspaceAuthorizationService({
        profile: 'TRUSTED_LOCAL',
        projectId,
        principalId: 'local-operator',
      });
      const source = {
        listSourcePaths: async () => ['src/a.ts'],
        readSourceFile: async () => 'export const a = 1;\n',
      };
      let idSeq = 0;
      const editProposals = new EditProposalService({
        changePlanner: new ChangePlannerService(),
        preparePort: {
          prepareFromResponsePackage: async () => {
            throw new Error('unused');
          },
        },
        clock: { now: () => new Date('2026-08-23T12:00:00.000Z') },
        ids: {
          generate: () => {
            idSeq += 1;
            return `b10-${String(idSeq).padStart(4, '0')}`;
          },
        },
        expectedBaselineDigest: 'b',
        readBaselineDigest: async () => 'b',
      });
      const controlledTerminal = new ControlledTerminalService({
        createRunner: () => ({
          execute: async () => ({
            exitCode: 0,
            signal: null,
            timedOut: false,
            cancelled: false,
            policyBlocked: false,
            stdout: '',
            stderr: '',
            stdoutLimited: false,
            stderrLimited: false,
            outputLimited: false,
          }),
        }),
        discoverScripts: () => ({
          hasBuild: true,
          hasTest: true,
          lintScript: undefined,
          typecheckScript: undefined,
          formatScript: undefined,
        }),
      });
      const controlledGit = createControlledGitService({
        appliedBindings: new InMemoryAppliedFileApplyBindingStore(),
      });
      const controlledBrowser = createControlledLocalBrowserService({
        serverManagerFactory: () => ({
          start: async () => ({
            descriptorId: 'npm-run-dev',
            status: 'UNAVAILABLE',
            startupDurationMs: 0,
            policyBlockCode: 'TEST_STUB',
          }),
          shutdown: async () => undefined,
        }),
        browserRunner: {
          verify: async () => ({
            status: 'UNAVAILABLE',
            durationMs: 0,
            routes: [],
            consoleErrorCount: 0,
            pageExceptionCount: 0,
            failedRequestCount: 0,
          }),
        },
      });
      const composed = createAgentLoopComposition({
        projectId,
        authorization,
        search: source,
        read: { readSourceFile: source.readSourceFile },
        readiness: { project: async () => readinessStub(projectId) },
        related: source,
        relevantContext: source,
        outline: { readSourceFile: source.readSourceFile },
        imports: source,
        editProposals,
        controlledTerminal,
        controlledGit,
        controlledBrowser,
        persistence: new AgentLoopEvidencePersistence(stateRoot, projectId),
        clock: { now: () => new Date('2026-08-23T12:00:00.000Z') },
      });

      const providerExecution: ProviderExecutionPort = {
        execute: vi.fn(async () => ({
          providerResponse: {
            schemaVersion: 1,
            providerId: 'test-provider',
            model: 'test-model',
            status: 'SUCCEEDED',
            artifacts: [
              {
                kind: 'STRUCTURED_DATA' as const,
                data: {
                  schemaVersion: 1,
                  intents: [
                    {
                      toolId: 'search_repository',
                      intentId: 'psi-b10-1',
                      arguments: { query: 'export' },
                    },
                  ],
                },
              },
            ],
            metadata: { values: {} },
          },
          executionResult: {
            schemaVersion: 1,
            executionId: 'exec-b10',
            status: 'SUCCEEDED',
            diagnostics: [],
            timing: {
              queuedAt: '2026-08-23T12:00:00.000Z',
              startedAt: '2026-08-23T12:00:00.000Z',
              completedAt: '2026-08-23T12:00:00.000Z',
              durationMs: 1,
            },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            artifacts: [],
            errors: [],
            metadata: { values: {} },
          },
        })) as unknown as ProviderExecutionPort['execute'],
      };

      const agentRuns = new AgentRunService(
        new AgentRunPersistence(stateRoot, projectId),
        () => new Date('2026-08-23T12:00:00.000Z'),
      );
      const agent = new AgentOperatingService({
        projectId,
        agentRuns,
        explainArtifacts: new ExplainArtifactPersistence(stateRoot, projectId),
        investigation: createStubInvestigation('inv-b10'),
        runtime: {
          prepare: async () => {
            throw new Error('prepare unused');
          },
          approveAndApply: async () => {
            throw new Error('approveAndApply must not run from provider-assisted turns');
          },
        },
        correction: new CorrectionLoopService(),
        ids: { generate: () => 'run-b10-1' },
        clock: { now: () => new Date('2026-08-23T12:00:00.000Z') },
        loop: composed.loop,
        projectRoot: process.cwd(),
        security: {
          profile: 'TRUSTED_LOCAL',
          projectId,
          principalId: 'local-operator',
        },
        providerExecution,
      });

      const started = await agent.startRun('Find exports.');
      expect(started.run.phase).toBe('UNDERSTANDING');

      const turn = await agent.executeProviderAssistedToolTurn(started.run.runId, {});
      expect(providerExecution.execute).toHaveBeenCalledTimes(1);
      expect(turn.evidence.length).toBeGreaterThan(0);
      expect(turn.evidence.some((entry) => entry.toolId === 'search_repository')).toBe(true);

      await expect(
        agent.executeProviderAssistedToolTurn(started.run.runId, {}),
      ).resolves.toBeTruthy();

      // EXECUTING remains tool-free even for provider-assisted path.
      await agentRuns.transition(started.run.runId, 'PLANNING');
      await agentRuns.transition(started.run.runId, 'AWAITING_GATE2');
      await agentRuns.transition(started.run.runId, 'EXECUTING');
      await expect(agent.executeProviderAssistedToolTurn(started.run.runId, {})).rejects.toThrow(
        /EXECUTING is tool-free/i,
      );

      const provider = new OpenAIProvider(
        createOpenAIConfiguration(),
        new FakeOpenAIResponsesClient(),
      );
      expect(provider.descriptor.capabilities.toolCalling).toBe(false);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when providerExecution is not composed', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-b10-bare-'));
    const projectId = 'builder-ai';
    try {
      const agentRuns = new AgentRunService(
        new AgentRunPersistence(stateRoot, projectId),
        () => new Date('2026-08-23T12:00:00.000Z'),
      );
      const agent = new AgentOperatingService({
        projectId,
        agentRuns,
        explainArtifacts: new ExplainArtifactPersistence(stateRoot, projectId),
        investigation: createStubInvestigation('inv-bare'),
        runtime: {
          prepare: async () => {
            throw new Error('unused');
          },
          approveAndApply: async () => {
            throw new Error('unused');
          },
        },
        correction: new CorrectionLoopService(),
        ids: { generate: () => 'bare-run' },
        clock: { now: () => new Date('2026-08-23T12:00:00.000Z') },
        // loop absent also fails; provide neither providerExecution
      });
      await expect(agent.executeProviderAssistedToolTurn('missing', {})).rejects.toBeTruthy();
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
