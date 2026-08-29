/**
 * @vitest-environment node
 *
 * P1-D Slice 1 — B4 baseline verification must remain observable evidence only (ADR-049).
 */
import { describe, expect, it } from 'vitest';

import { ChangePlannerService } from '../../../core/change-planner';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../../core/target-project/test/external-target.fixture';
import { EditProposalService } from '../edit-proposal/edit-proposal.service';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { InMemoryAgentLoopEvidencePersistence } from '../agent-loop/create-agent-loop';
import { AgentLoopService } from '../agent-loop/agent-loop.service';
import {
  createB4TerminalRegistry,
  createControlledTerminalService,
} from '../tool-registry/create-b4-terminal-registry';
import { runVerificationCommandToolDefinition } from '../tool-registry/tools/run-verification-command.tool';
import type { ToolExecutionContext } from '../tool-registry/tool-registry.types';
import { buildOperatorToolPlanningContext } from './operator-tool-planning-context';

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

function verifyContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-p1d-verify',
    projectId: 'builder-ai',
    projectRoot: ZYRO_STYLE_FIXTURE_ROOT,
    phase: 'UNDERSTANDING',
    principal: { principalId: 'local-operator', projectId: 'builder-ai' },
    securityProfile: 'TRUSTED_LOCAL',
    securityEvidence: { operatorApproved: false },
    cancellation: neverCancelled(),
    ...overrides,
  };
}

describe('P1-D B4 planning isolation (ADR-049)', () => {
  it('declares ADR-049 allowedPhases without dead PLANNING entry', () => {
    expect(runVerificationCommandToolDefinition().allowedPhases).toEqual([
      'UNDERSTANDING',
      'VERIFYING',
      'DIAGNOSING',
      'CORRECTING',
    ]);
  });

  it('authorizes run_verification_command in UNDERSTANDING under PREPARE', async () => {
    const authorization = authService();
    const controlledTerminal = createControlledTerminalService();
    let idSeq = 0;
    const { registry, policy, executor } = createB4TerminalRegistry({
      authorization,
      search: {
        listSourcePaths: async () => [],
        readSourceFile: async () => '',
      },
      read: { readSourceFile: async () => '' },
      readiness: { project: async () => ({}) as never },
      related: {
        listSourcePaths: async () => [],
        readSourceFile: async () => '',
      },
      relevantContext: {
        listSourcePaths: async () => [],
        readSourceFile: async () => '',
      },
      outline: { readSourceFile: async () => '' },
      imports: {
        listSourcePaths: async () => [],
        readSourceFile: async () => '',
      },
      editProposals: new EditProposalService({
        changePlanner: new ChangePlannerService(),
        preparePort: {
          prepareFromResponsePackage: async () => {
            throw new Error('unused');
          },
        },
        clock: { now: () => new Date() },
        ids: {
          generate: () => {
            idSeq += 1;
            return `ep-${String(idSeq)}`;
          },
        },
      }),
      controlledTerminal,
    });
    const handler = registry.get('run_verification_command');
    expect(handler).toBeDefined();
    const decision = policy.authorizeInvoke(handler!, verifyContext());
    expect(decision.ok).toBe(true);

    const result = await executor.execute(
      {
        callId: 'p1d-build',
        toolId: 'run_verification_command',
        args: { commandId: 'npm-run-build' },
      },
      verifyContext(),
    );
    expect(result.status).toBe('SUCCEEDED');
  });

  it('does not produce planningProjection and is ignored by operator planning context', async () => {
    const authorization = authService();
    const controlledTerminal = createControlledTerminalService();
    let idSeq = 0;
    const { registry, executor } = createB4TerminalRegistry({
      authorization,
      search: {
        listSourcePaths: async () => ['src/index.ts'],
        readSourceFile: async () => 'export {};\n',
      },
      read: { readSourceFile: async () => 'export {};\n' },
      readiness: { project: async () => ({}) as never },
      related: {
        listSourcePaths: async () => ['src/index.ts'],
        readSourceFile: async () => 'export {};\n',
      },
      relevantContext: {
        listSourcePaths: async () => ['src/index.ts'],
        readSourceFile: async () => 'export {};\n',
      },
      outline: { readSourceFile: async () => 'export {};\n' },
      imports: {
        listSourcePaths: async () => ['src/index.ts'],
        readSourceFile: async () => 'export {};\n',
      },
      editProposals: new EditProposalService({
        changePlanner: new ChangePlannerService(),
        preparePort: {
          prepareFromResponsePackage: async () => {
            throw new Error('unused');
          },
        },
        clock: { now: () => new Date() },
        ids: {
          generate: () => {
            idSeq += 1;
            return `ep-${String(idSeq)}`;
          },
        },
      }),
      controlledTerminal,
    });

    const loop = new AgentLoopService({
      projectId: 'builder-ai',
      registry,
      executor,
      persistence: new InMemoryAgentLoopEvidencePersistence('builder-ai'),
    });

    const context = verifyContext({ runId: 'run-b4-isolation' });
    const verifyTurn = await loop.executeIntent(
      {
        toolId: 'run_verification_command',
        intentId: 'p1d-verify-1',
        arguments: { commandId: 'npm-run-build' },
      },
      context,
    );
    expect(verifyTurn.status).toBe('SUCCEEDED');
    expect(verifyTurn.evidence.planningProjection).toBeUndefined();
    expect(verifyTurn.evidence.verificationEvidence).toEqual(
      expect.objectContaining({
        commandId: 'npm-run-build',
        stage: 'BUILD_VALIDATION',
        executionStatus: 'SUCCEEDED',
        exitCode: 0,
      }),
    );
    expect(JSON.stringify(verifyTurn.evidence.verificationEvidence)).not.toContain(
      'diagnosticSummary',
    );

    const searchTurn = await loop.executeIntent(
      {
        toolId: 'search_repository',
        intentId: 'p1d-search-1',
        arguments: { query: 'export' },
      },
      context,
    );
    expect(searchTurn.evidence.planningProjection).toBeDefined();
    expect(searchTurn.evidence.verificationEvidence).toBeUndefined();

    const evidence = loop.listEvidence('run-b4-isolation');
    const operatorContext = buildOperatorToolPlanningContext(evidence);
    expect(operatorContext).toBeDefined();
    expect(
      operatorContext?.records.every((record) => record.toolId !== 'run_verification_command'),
    ).toBe(true);
    expect(evidence.some((item) => item.verificationEvidence !== undefined)).toBe(true);
  });
});
