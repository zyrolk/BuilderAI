/**
 * @vitest-environment node
 *
 * P1-B B1–B10 production hardening smoke matrix.
 * Freeze tip: 76d12de (ancestry efd4a7b → 326507d → 16c9790 → 7a3d16b → 76d12de).
 * Asserts frozen security/architecture invariants without redesigning B1–B10.
 */
import { describe, expect, it } from 'vitest';

import {
  createOpenAIConfiguration,
  FakeOpenAIResponsesClient,
} from '../../../providers/openai/test/openai-provider.fixture';
import { OpenAIProvider } from '../../../providers/openai';
import {
  createGeminiConfiguration,
  FakeGeminiClient,
} from '../../../providers/gemini/test/gemini-provider.fixture';
import { GeminiProvider } from '../../../providers/gemini';
import {
  createOpenRouterConfiguration,
  FakeOpenRouterChatClient,
} from '../../../providers/openrouter/test/openrouter-provider.fixture';
import { OpenRouterProvider } from '../../../providers/openrouter';
import {
  AUTONOMOUS_LOOP_PHASE_CAPABILITIES,
  DEFAULT_AGENT_LOOP_BUDGETS,
  parseProviderStructuredToolIntent,
  PROVIDER_AUTHORITY_FIELD_NAMES,
} from '../agent-loop';
import { assertAutonomousLoopToolAllowed } from '../agent-loop/agent-loop-phase-policy';
import type { ToolDefinition } from '../tool-registry/tool-registry.types';
import {
  assertNoProviderToolTurnAuthorityFields,
  assertNoToolTurnAuthorityFields,
} from '../../../app/api/workspace/agent/agent-route-helpers';
import { parseProviderIntentBatch } from './provider-structured-intent-emission.service';
import { WorkspaceRuntimeError } from '../workspace-runtime.types';
import { HttpAgentWorkflow } from '../../../ui/workspace/http-agent-workflow';

function gitWriteDefinition(): ToolDefinition {
  return {
    toolId: 'commit_git_snapshot',
    name: 'commit',
    description: 'probe',
    inputSchema: {},
    outputSchema: {},
    capabilityClass: 'GIT_WRITE',
    readOnly: false,
    riskLevel: 'HIGH',
    authorizationAction: 'INVESTIGATE',
    requiresGate2: false,
    approvalRequirement: 'OPERATOR',
    workspaceScoped: true,
    timeoutMs: 1_000,
    supportsCancellation: true,
    evidencePolicy: 'SUMMARY',
    auditPolicy: 'DIGEST',
    allowedPhases: ['VERIFYING'],
  };
}

describe('P1-B B1–B10 production hardening smoke', () => {
  it('keeps every production provider adapter toolCalling:false', () => {
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
  });

  it('keeps EXECUTING tool-free and GIT_WRITE outside autonomous loop', () => {
    expect(AUTONOMOUS_LOOP_PHASE_CAPABILITIES.EXECUTING).toBeNull();
    expect(AUTONOMOUS_LOOP_PHASE_CAPABILITIES.EXPLAINING).toBeNull();
    expect(AUTONOMOUS_LOOP_PHASE_CAPABILITIES.COMPLETED).toBeNull();
    for (const phase of Object.keys(AUTONOMOUS_LOOP_PHASE_CAPABILITIES) as Array<
      keyof typeof AUTONOMOUS_LOOP_PHASE_CAPABILITIES
    >) {
      const allowed = AUTONOMOUS_LOOP_PHASE_CAPABILITIES[phase];
      if (allowed !== null) {
        expect(allowed).not.toContain('GIT_WRITE');
      }
    }
    expect(assertAutonomousLoopToolAllowed('VERIFYING', gitWriteDefinition())).toMatchObject({
      ok: false,
      code: 'GIT_WRITE_OUTSIDE_AUTONOMOUS_LOOP',
    });
  });

  it('rejects authority, binding, FileApply, shell, MCP, and WEB on structured intents', () => {
    for (const field of [
      'approved',
      'applyAuthorizationToken',
      'operatorApproved',
      'browserObservationApproved',
      'projectId',
      'runId',
      'phase',
    ]) {
      expect(PROVIDER_AUTHORITY_FIELD_NAMES).toContain(field);
    }
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'search_repository',
        intentId: 'i1',
        browserObservationApproved: true,
        arguments: {},
      }),
    ).toThrow(/authority/i);
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'file_apply',
        intentId: 'i1',
        arguments: {},
      }),
    ).toThrow(/FileApply|FORBIDDEN/i);
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'run_shell',
        intentId: 'i1',
        arguments: {},
      }),
    ).toThrow(/not available/i);
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'mcp_tool',
        intentId: 'i1',
        arguments: {},
      }),
    ).toThrow(/not available/i);
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'open_web',
        intentId: 'i1',
        arguments: {},
      }),
    ).toThrow(/not available/i);
    expect(() =>
      parseProviderIntentBatch({
        schemaVersion: 1,
        approved: true,
        intents: [{ toolId: 'search_repository', intentId: 'x', arguments: {} }],
      }),
    ).toThrow(/authority|binding/i);
  });

  it('rejects forged authority on both HTTP tool-turn helpers', () => {
    expect(() => assertNoToolTurnAuthorityFields({ approved: true })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(() => assertNoToolTurnAuthorityFields({ applyAuthorizationToken: 'tok' })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(() => assertNoProviderToolTurnAuthorityFields({ intent: { toolId: 'x' } })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(() => assertNoProviderToolTurnAuthorityFields({ intents: [] })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(() => assertNoProviderToolTurnAuthorityFields({ approved: true })).toThrow(
      WorkspaceRuntimeError,
    );
  });

  it('preserves serial budgets and UI client surface (no local apply/tool engine)', () => {
    expect(DEFAULT_AGENT_LOOP_BUDGETS.concurrentToolExecutions).toBe(1);
    expect(DEFAULT_AGENT_LOOP_BUDGETS.maxToolCallsPerRun).toBeGreaterThan(0);
    expect(DEFAULT_AGENT_LOOP_BUDGETS.maxProviderTurnsPerRun).toBeGreaterThan(0);
    expect(DEFAULT_AGENT_LOOP_BUDGETS.maxBrowserObservationCallsPerRun).toBeGreaterThan(0);
    const client = new HttpAgentWorkflow();
    expect('apply' in client).toBe(false);
    expect(typeof client.toolTurn).toBe('function');
    expect(typeof client.providerToolTurn).toBe('function');
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    expect(names).not.toContain('executeTool');
    expect(names).not.toContain('approveAndApply');
  });
});
