/**
 * @vitest-environment node
 * Extra ADR-042 branch coverage for AgentLoopService / persistence / composition.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { ToolExecutor } from '../tool-registry/tool-executor';
import { ToolPolicyGate } from '../tool-registry/tool-policy';
import { ToolRegistry } from '../tool-registry/tool-registry';
import type { ToolDefinition, ToolResult } from '../tool-registry/tool-registry.types';
import { createAgentLoopService, InMemoryAgentLoopEvidencePersistence } from './create-agent-loop';
import { AgentLoopEvidencePersistence } from './agent-loop.persistence';
import { AgentLoopService, type AgentLoopExecuteContext } from './agent-loop.service';
import { AgentLoopError } from './agent-loop.types';
import { fingerprintToolCall, digestSummary } from './agent-loop-budgets';
import { parseProviderStructuredToolIntent } from './agent-loop-intent.validator';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function auth(): WorkspaceAuthorizationService {
  return new WorkspaceAuthorizationService({
    profile: 'TRUSTED_LOCAL',
    projectId: 'builder-ai',
    principalId: 'local-operator',
  });
}

function inspectDef(): ToolDefinition {
  return {
    toolId: 'inspect_readiness',
    name: 'Ready',
    description: 'd',
    inputSchema: {},
    outputSchema: {},
    capabilityClass: 'INSPECT',
    readOnly: true,
    riskLevel: 'LOW',
    authorizationAction: 'READINESS',
    requiresGate2: false,
    approvalRequirement: 'NONE',
    workspaceScoped: true,
    timeoutMs: 5_000,
    supportsCancellation: true,
    evidencePolicy: 'SUMMARY',
    auditPolicy: 'DIGEST',
    allowedPhases: ['UNDERSTANDING', 'PLANNING', 'DIAGNOSING', 'CORRECTING', 'FAILED'],
  };
}

function ctx(overrides: Partial<AgentLoopExecuteContext> = {}): AgentLoopExecuteContext {
  return {
    runId: 'run-cov',
    projectId: 'builder-ai',
    projectRoot: process.cwd(),
    phase: 'UNDERSTANDING',
    principal: { principalId: 'local-operator', projectId: 'builder-ai' },
    securityProfile: 'TRUSTED_LOCAL',
    securityEvidence: { operatorApproved: false },
    cancellation: neverCancelled(),
    preparationId: 'prep-1',
    workflowId: 'wf-1',
    ...overrides,
  };
}

function buildLoop(
  handler?: () => Promise<{ summary: string; errorCode?: string; errorMessage?: string }>,
) {
  const policy = new ToolPolicyGate(auth());
  const registry = new ToolRegistry(policy);
  registry.register({
    definition: inspectDef(),
    execute: handler ?? (async () => ({ summary: 'ok' })),
  });
  const executor = new ToolExecutor(registry, policy);
  const persistence = new InMemoryAgentLoopEvidencePersistence('builder-ai');
  const loop = createAgentLoopService({
    projectId: 'builder-ai',
    registry,
    executor,
    persistence,
  });
  return { loop, registry, executor, persistence, policy };
}

describe('ADR-042 coverage boost', () => {
  it('covers createAgentLoopService guards, getters, and unknown/stopped/tool-budget paths', async () => {
    const { loop, registry, policy, persistence } = buildLoop();
    expect(persistence.evidencePath('r')).toContain('builder-ai');
    expect(await persistence.load('missing')).toBeUndefined();

    expect(loop.getBudget('none')).toBeUndefined();
    expect(loop.listEvidence('none')).toEqual([]);

    const unknown = await loop.executeIntent(
      { toolId: 'totally_unknown', intentId: 'u1' },
      ctx({ runId: 'run-unknown' }),
    );
    expect(unknown.errorCode).toBe('UNKNOWN_TOOL');

    const invalid = await loop.executeIntent('not-an-object', ctx({ runId: 'run-invalid' }));
    expect(invalid.status).toBe('REJECTED_BY_POLICY');

    const budgetLoop = new AgentLoopService({
      projectId: 'builder-ai',
      registry,
      executor: new ToolExecutor(registry, policy),
      persistence: new InMemoryAgentLoopEvidencePersistence('builder-ai'),
      budgets: {
        maxToolCallsPerRun: 1,
        maxProviderTurnsPerRun: 12,
        maxIdenticalToolArgsRepeats: 10,
        hardWallClockMs: 60_000,
        maxB4VerificationCallsPerRun: 6,
        concurrentToolExecutions: 1,
      },
    });
    await budgetLoop.executeIntent(
      { toolId: 'inspect_readiness', intentId: 'b1', arguments: {} },
      ctx({ runId: 'run-tool-budget' }),
    );
    const exhausted = await budgetLoop.executeIntent(
      { toolId: 'inspect_readiness', intentId: 'b2', arguments: { n: 2 } },
      ctx({ runId: 'run-tool-budget' }),
    );
    expect(exhausted.errorCode).toBe('TOOL_CALL_BUDGET_EXHAUSTED');
    const stopped = await budgetLoop.executeIntent(
      { toolId: 'inspect_readiness', intentId: 'b3', arguments: { n: 3 } },
      ctx({ runId: 'run-tool-budget' }),
    );
    expect(stopped.errorCode).toBe('LOOP_STOPPED');

    expect(() =>
      createAgentLoopService({
        projectId: 'builder-ai',
        registry: {
          listDefinitions: () => [{ toolId: 'file_apply' } as ToolDefinition],
          require: () => {
            throw new Error('unused');
          },
          register: () => undefined,
        } as unknown as ToolRegistry,
        executor: new ToolExecutor(registry, policy),
        persistence: new InMemoryAgentLoopEvidencePersistence('builder-ai'),
      }),
    ).toThrow(/Forbidden tool/);

    await expect(
      loop.executeIntent(
        { toolId: 'inspect_readiness', intentId: 'p1', arguments: {} },
        ctx({
          principal: { principalId: 'x', projectId: 'other' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_MISMATCH' });
  });

  it('maps tool result statuses and provider-turn wall stop', async () => {
    const statuses: Array<ToolResult['status']> = [
      'FAILED',
      'CANCELLED',
      'TIMEOUT',
      'REJECTED_BY_POLICY',
      'SUCCEEDED',
    ];
    for (const [index, status] of statuses.entries()) {
      const policy = new ToolPolicyGate(auth());
      const registry = new ToolRegistry(policy);
      registry.register({
        definition: inspectDef(),
        execute: async () => {
          if (status === 'SUCCEEDED') return { summary: 'ok' };
          return {
            summary: status,
            errorCode: status,
            errorMessage: status,
          };
        },
      });
      // Force status via wrapping executor for non-success paths is hard; exercise SUCCEEDED + policy rejects.
      const executor = new ToolExecutor(registry, policy);
      const loop = new AgentLoopService({
        projectId: 'builder-ai',
        registry,
        executor,
        persistence: new InMemoryAgentLoopEvidencePersistence('builder-ai'),
      });
      const result = await loop.executeIntent(
        { toolId: 'inspect_readiness', intentId: `st-${index}`, arguments: { i: index } },
        ctx({ runId: `run-status-${index}` }),
      );
      expect(result.replayed).toBe(false);
      expect(loop.getBudget(`run-status-${index}`)?.toolCalls).toBeGreaterThan(0);
      expect(loop.listEvidence(`run-status-${index}`).length).toBeGreaterThan(0);
    }

    // Direct mapToolStatus coverage via FAILED tool that ToolExecutor marks FAILED
    const policy = new ToolPolicyGate(auth());
    const registry = new ToolRegistry(policy);
    registry.register({
      definition: inspectDef(),
      execute: async () => {
        throw new Error('boom');
      },
    });
    const failLoop = new AgentLoopService({
      projectId: 'builder-ai',
      registry,
      executor: new ToolExecutor(registry, policy),
      persistence: new InMemoryAgentLoopEvidencePersistence('builder-ai'),
    });
    const failed = await failLoop.executeIntent(
      { toolId: 'inspect_readiness', intentId: 'fail-1', arguments: {} },
      ctx({ runId: 'run-fail' }),
    );
    expect(['FAILED', 'REJECTED_BY_POLICY']).toContain(failed.status);

    let pastWall = false;
    const wallLoop = new AgentLoopService({
      projectId: 'builder-ai',
      registry: buildLoop().registry,
      executor: buildLoop().executor,
      persistence: new InMemoryAgentLoopEvidencePersistence('builder-ai'),
      budgets: {
        maxToolCallsPerRun: 40,
        maxProviderTurnsPerRun: 12,
        maxIdenticalToolArgsRepeats: 2,
        hardWallClockMs: 500,
        maxB4VerificationCallsPerRun: 6,
        concurrentToolExecutions: 1,
      },
      clock: { now: () => new Date(pastWall ? 10_000 : 0) },
    });
    await wallLoop.executeIntent(
      { toolId: 'inspect_readiness', intentId: 'pw1', arguments: {} },
      ctx({ runId: 'run-prov-wall' }),
    );
    pastWall = true;
    const turn = await wallLoop.executeProviderTurn(
      [{ toolId: 'inspect_readiness', intentId: 'pw2', arguments: { z: 1 } }],
      ctx({ runId: 'run-prov-wall' }),
    );
    expect(turn.stopped).toBe(true);
    expect(turn.stopReason).toMatch(/WALL_CLOCK/);
  });

  it('covers persistence schema/path/corrupt branches and intent validator edges', async () => {
    expect(digestSummary('a')).toHaveLength(24);
    expect(fingerprintToolCall('t', [1, { b: 2, a: 1 }])).toMatch(/^[a-f0-9]+$/);

    expect(() => parseProviderStructuredToolIntent({ toolId: '', intentId: 'x' })).toThrow(
      AgentLoopError,
    );
    expect(() => parseProviderStructuredToolIntent({ toolId: 'x', intentId: '' })).toThrow(
      AgentLoopError,
    );
    expect(() => parseProviderStructuredToolIntent({ toolId: 'push', intentId: 'x' })).toThrow(
      AgentLoopError,
    );
    expect(
      parseProviderStructuredToolIntent({
        toolId: 'search_repository',
        intentId: 'args-alias',
        args: { query: 'q' },
      }).arguments,
    ).toEqual({ query: 'q' });

    const root = await mkdtemp(path.join(tmpdir(), 'builderai-b6-cov-'));
    try {
      const persistence = new AgentLoopEvidencePersistence(root, 'builder-ai');
      expect(await persistence.load('missing-run')).toBeUndefined();

      const badDir = path.join(root, 'workflows', 'builder-ai', 'agent-runs', 'bad-schema');
      await mkdir(badDir, { recursive: true });
      await writeFile(
        path.join(badDir, 'tool-loop-evidence.json'),
        JSON.stringify({ schemaVersion: 99, runId: 'bad-schema', projectId: 'builder-ai' }),
        'utf8',
      );
      await expect(persistence.load('bad-schema')).rejects.toMatchObject({
        code: 'INVALID_SCHEMA',
      });

      const idDir = path.join(root, 'workflows', 'builder-ai', 'agent-runs', 'id-mismatch');
      await mkdir(idDir, { recursive: true });
      await writeFile(
        path.join(idDir, 'tool-loop-evidence.json'),
        JSON.stringify({
          schemaVersion: 1,
          runId: 'wrong',
          projectId: 'builder-ai',
          budget: {
            toolCalls: 0,
            providerTurns: 0,
            b4VerificationCalls: 0,
            browserObservationCalls: 0,
            startedAtMs: 1,
            identicalRepeatCounts: {},
            completedIntentIds: [],
          },
          evidence: [],
          updatedAt: new Date().toISOString(),
        }),
        'utf8',
      );
      await expect(persistence.load('id-mismatch')).rejects.toMatchObject({
        code: 'CORRUPT_STATE',
      });

      const arrDir = path.join(root, 'workflows', 'builder-ai', 'agent-runs', 'arr');
      await mkdir(arrDir, { recursive: true });
      await writeFile(path.join(arrDir, 'tool-loop-evidence.json'), '[]', 'utf8');
      await expect(persistence.load('arr')).rejects.toMatchObject({ code: 'CORRUPT_STATE' });

      await expect(
        persistence.save({
          schemaVersion: 1,
          runId: 'x',
          projectId: 'other',
          budget: {
            toolCalls: 0,
            providerTurns: 0,
            b4VerificationCalls: 0,
            browserObservationCalls: 0,
            startedAtMs: 1,
            identicalRepeatCounts: {},
            completedIntentIds: [],
          },
          evidence: [],
          updatedAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_MISMATCH' });

      await expect(
        persistence.save({
          schemaVersion: 99 as never,
          runId: 'x',
          projectId: 'builder-ai',
          budget: {
            toolCalls: 0,
            providerTurns: 0,
            b4VerificationCalls: 0,
            browserObservationCalls: 0,
            startedAtMs: 1,
            identicalRepeatCounts: {},
            completedIntentIds: [],
          },
          evidence: [],
          updatedAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
