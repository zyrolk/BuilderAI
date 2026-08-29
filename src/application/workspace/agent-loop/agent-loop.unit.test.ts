/**
 * @vitest-environment node
 * Unit coverage for ADR-042 budgets, phase policy, and intent validation.
 */
import { describe, expect, it } from 'vitest';

import {
  assertWallClockRemaining,
  createInitialBudgetSnapshot,
  fingerprintToolCall,
  resolveBudgets,
} from './agent-loop-budgets';
import { parseProviderStructuredToolIntent } from './agent-loop-intent.validator';
import { assertAutonomousLoopToolAllowed } from './agent-loop-phase-policy';
import { DEFAULT_AGENT_LOOP_BUDGETS, AgentLoopError } from './agent-loop.types';
import type { ToolDefinition } from '../tool-registry/tool-registry.types';

function def(
  overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'toolId' | 'capabilityClass'>,
): ToolDefinition {
  return {
    name: 't',
    description: 'd',
    inputSchema: {},
    outputSchema: {},
    readOnly: true,
    riskLevel: 'LOW',
    authorizationAction: 'INVESTIGATE',
    requiresGate2: false,
    approvalRequirement: 'NONE',
    workspaceScoped: true,
    timeoutMs: 1_000,
    supportsCancellation: true,
    evidencePolicy: 'SUMMARY',
    auditPolicy: 'DIGEST',
    allowedPhases: ['UNDERSTANDING', 'VERIFYING'],
    ...overrides,
  };
}

describe('ADR-042 agent-loop unit matrix', () => {
  it('resolves frozen MVP budgets', () => {
    expect(resolveBudgets()).toEqual({ ...DEFAULT_AGENT_LOOP_BUDGETS });
    expect(resolveBudgets({ maxToolCallsPerRun: 5 }).maxToolCallsPerRun).toBe(5);
    expect(fingerprintToolCall('a', { z: 1, a: 2 })).toBe(fingerprintToolCall('a', { a: 2, z: 1 }));
    expect(assertWallClockRemaining(createInitialBudgetSnapshot(0), resolveBudgets(), 1).ok).toBe(
      true,
    );
    expect(
      assertWallClockRemaining(
        createInitialBudgetSnapshot(0),
        resolveBudgets({ hardWallClockMs: 10 }),
        11,
      ).ok,
    ).toBe(false);
  });

  it('enforces autonomous phase capability map and GIT_WRITE ban', () => {
    expect(
      assertAutonomousLoopToolAllowed(
        'UNDERSTANDING',
        def({ toolId: 'search_repository', capabilityClass: 'SEARCH' }),
      ).ok,
    ).toBe(true);
    expect(
      assertAutonomousLoopToolAllowed(
        'EXECUTING',
        def({ toolId: 'search_repository', capabilityClass: 'SEARCH' }),
      ),
    ).toMatchObject({ ok: false, code: 'PHASE_TOOLS_FORBIDDEN' });
    expect(
      assertAutonomousLoopToolAllowed(
        'VERIFYING',
        def({ toolId: 'run_local_browser_observation', capabilityClass: 'BROWSER' }),
      ).ok,
    ).toBe(true);
    expect(
      assertAutonomousLoopToolAllowed(
        'UNDERSTANDING',
        def({ toolId: 'run_local_browser_observation', capabilityClass: 'BROWSER' }),
      ),
    ).toMatchObject({ ok: false, code: 'PHASE_CAPABILITY_DENIED' });
    expect(
      assertAutonomousLoopToolAllowed(
        'VERIFYING',
        def({ toolId: 'stage_git_paths', capabilityClass: 'GIT_WRITE' }),
      ),
    ).toMatchObject({ ok: false, code: 'GIT_WRITE_OUTSIDE_AUTONOMOUS_LOOP' });
    expect(
      assertAutonomousLoopToolAllowed(
        'AWAITING_GATE2',
        def({ toolId: 'draft_edit_proposal', capabilityClass: 'PLAN' }),
      ),
    ).toMatchObject({ ok: false, code: 'PHASE_CAPABILITY_DENIED' });
    expect(
      assertAutonomousLoopToolAllowed(
        'UNDERSTANDING',
        def({ toolId: 'file_apply', capabilityClass: 'MUTATE' }),
      ),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN_TOOL' });
  });

  it('allows VERIFY in UNDERSTANDING and denies VERIFY in PLANNING and EXECUTING (P1-D Slice 1)', () => {
    const verifyTool = def({
      toolId: 'run_verification_command',
      capabilityClass: 'VERIFY',
      authorizationAction: 'PREPARE',
      riskLevel: 'HIGH',
    });
    expect(assertAutonomousLoopToolAllowed('UNDERSTANDING', verifyTool).ok).toBe(true);
    expect(assertAutonomousLoopToolAllowed('PLANNING', verifyTool)).toMatchObject({
      ok: false,
      code: 'PHASE_CAPABILITY_DENIED',
    });
    expect(assertAutonomousLoopToolAllowed('EXECUTING', verifyTool)).toMatchObject({
      ok: false,
      code: 'PHASE_TOOLS_FORBIDDEN',
    });
    expect(assertAutonomousLoopToolAllowed('VERIFYING', verifyTool).ok).toBe(true);
    expect(assertAutonomousLoopToolAllowed('DIAGNOSING', verifyTool).ok).toBe(true);
  });

  it('validates intents and rejects shell/push/authority', () => {
    expect(parseProviderStructuredToolIntent({ toolId: 'a', intentId: 'b' }).toolId).toBe('a');
    expect(() => parseProviderStructuredToolIntent(null)).toThrow(AgentLoopError);
    expect(() => parseProviderStructuredToolIntent({ toolId: 'run_shell', intentId: 'x' })).toThrow(
      AgentLoopError,
    );
    try {
      parseProviderStructuredToolIntent({ toolId: 'run_shell', intentId: 'x' });
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'FORBIDDEN_TOOL' });
    }
    expect(() => parseProviderStructuredToolIntent({ toolId: 'git_push', intentId: 'x' })).toThrow(
      AgentLoopError,
    );
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'search_repository',
        intentId: 'x',
        repositoryRoot: '/evil',
      }),
    ).toThrow(AgentLoopError);
  });
});
