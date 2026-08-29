import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type { AgentRunPhase } from '../agent-operating/agent-run.types';
import type { ToolExecutor } from '../tool-registry/tool-executor';
import type { ToolRegistry } from '../tool-registry/tool-registry';
import type {
  ToolCallIntent,
  ToolExecutionContext,
  ToolResult,
} from '../tool-registry/tool-registry.types';
import {
  assertWallClockRemaining,
  createInitialBudgetSnapshot,
  digestSummary,
  fingerprintToolCall,
  resolveBudgets,
} from './agent-loop-budgets';
import { parseProviderStructuredToolIntent } from './agent-loop-intent.validator';
import { assertAutonomousLoopToolAllowed } from './agent-loop-phase-policy';
import type { AgentLoopEvidenceStore } from './agent-loop.persistence';
import { extractBoundedVerificationEvidence } from './bounded-verification-evidence';
import { extractOperatorToolPlanningProjection } from './operator-tool-planning-projection';
import {
  AGENT_LOOP_SCHEMA_VERSION,
  AgentLoopError,
  type AgentLoopBudgetSnapshot,
  type AgentLoopBudgets,
  type AgentLoopPersistedState,
  type AgentLoopProviderTurnResult,
  type AgentLoopTurnResult,
  type AgentLoopTurnStatus,
  type BoundedToolEvidenceRecord,
  type ProviderStructuredToolIntent,
} from './agent-loop.types';

export interface AgentLoopServiceDeps {
  readonly projectId: string;
  readonly registry: ToolRegistry;
  readonly executor: ToolExecutor;
  readonly persistence: AgentLoopEvidenceStore;
  readonly budgets?: Partial<AgentLoopBudgets>;
  readonly clock?: { now(): Date };
}

export interface AgentLoopExecuteContext {
  readonly runId: string;
  readonly projectId: string;
  readonly phase: AgentRunPhase;
  readonly projectRoot: string;
  readonly principal: ToolExecutionContext['principal'];
  readonly securityProfile: ToolExecutionContext['securityProfile'];
  readonly securityEvidence: ToolExecutionContext['securityEvidence'];
  readonly cancellation: ExecutionCancellationToken;
  readonly preparationId?: string;
  readonly workflowId?: string;
  readonly investigationId?: string;
  readonly correctionWorkflowId?: string;
  readonly correlationId?: string;
}

/**
 * Server-owned bounded agent tool loop (ADR-042).
 * Providers remain toolCalling:false; this service alone executes tools.
 * GIT_WRITE and FileApply are never invoked by the autonomous loop.
 */
export class AgentLoopService {
  private readonly budgets: AgentLoopBudgets;
  private readonly clock: { now(): Date };
  private readonly states = new Map<string, AgentLoopPersistedState>();
  private readonly locks = new Set<string>();

  constructor(private readonly deps: AgentLoopServiceDeps) {
    this.budgets = resolveBudgets(deps.budgets);
    this.clock = deps.clock ?? { now: () => new Date() };
    if (this.budgets.concurrentToolExecutions !== 1) {
      throw new AgentLoopError(
        'INVALID_BUDGET',
        'ADR-042 requires concurrentToolExecutions === 1 (serial execution).',
      );
    }
  }

  /**
   * Restart-safe hydrate: loads bounded evidence only.
   * Never auto-approves Gate2, never auto-applies, never auto-commits Git.
   */
  async hydrate(runId: string): Promise<AgentLoopPersistedState | undefined> {
    const loaded = await this.deps.persistence.load(runId);
    if (loaded !== undefined) {
      const normalized = normalizePersistedState(loaded);
      this.states.set(runId, normalized);
      return normalized;
    }
    return loaded;
  }

  getBudget(runId: string): AgentLoopBudgetSnapshot | undefined {
    return this.states.get(runId)?.budget;
  }

  listEvidence(runId: string): readonly BoundedToolEvidenceRecord[] {
    return this.states.get(runId)?.evidence ?? [];
  }

  /**
   * Execute one provider turn: increment provider-turn budget, then run intents serially.
   */
  async executeProviderTurn(
    rawIntents: readonly unknown[],
    context: AgentLoopExecuteContext,
  ): Promise<AgentLoopProviderTurnResult> {
    this.assertProjectBinding(context);
    return this.withRunLock(context.runId, async () => {
      const state = await this.ensureState(context);
      const nowMs = this.clock.now().getTime();
      const wall = assertWallClockRemaining(state.budget, this.budgets, nowMs);
      if (!wall.ok) {
        return this.stopTurn(state, context, [], wall.code, wall.message);
      }
      if (state.budget.providerTurns >= this.budgets.maxProviderTurnsPerRun) {
        return this.stopTurn(
          state,
          context,
          [],
          'PROVIDER_TURN_BUDGET_EXHAUSTED',
          'Maximum provider turns for this run exceeded.',
        );
      }

      const nextBudget: AgentLoopBudgetSnapshot = {
        ...state.budget,
        providerTurns: state.budget.providerTurns + 1,
        identicalRepeatCounts: { ...state.budget.identicalRepeatCounts },
        completedIntentIds: [...state.budget.completedIntentIds],
      };
      let working: AgentLoopPersistedState = {
        ...state,
        budget: nextBudget,
        updatedAt: this.clock.now().toISOString(),
      };
      this.states.set(context.runId, working);
      await this.deps.persistence.save(working);

      const results: AgentLoopTurnResult[] = [];
      for (const raw of rawIntents) {
        const turn = await this.executeIntentUnlocked(raw, context, working);
        results.push(turn);
        working = this.states.get(context.runId) ?? working;
        if (
          turn.status === 'BUDGET_EXHAUSTED' ||
          working.stoppedReason !== undefined ||
          context.cancellation.cancelled
        ) {
          return {
            turnIndex: working.budget.providerTurns,
            results,
            budget: working.budget,
            stopped: true,
            stopReason: working.stoppedReason ?? turn.errorCode ?? 'STOPPED',
          };
        }
      }

      return {
        turnIndex: working.budget.providerTurns,
        results,
        budget: working.budget,
        stopped: working.stoppedReason !== undefined,
        ...(working.stoppedReason !== undefined ? { stopReason: working.stoppedReason } : {}),
      };
    });
  }

  async executeIntent(
    rawIntent: unknown,
    context: AgentLoopExecuteContext,
  ): Promise<AgentLoopTurnResult> {
    this.assertProjectBinding(context);
    return this.withRunLock(context.runId, async () => {
      const state = await this.ensureState(context);
      return this.executeIntentUnlocked(rawIntent, context, state);
    });
  }

  private assertProjectBinding(context: AgentLoopExecuteContext): void {
    if (context.projectId !== this.deps.projectId) {
      throw new AgentLoopError(
        'PROJECT_MISMATCH',
        'Loop projectId does not match execution context.',
      );
    }
    if (context.principal.projectId !== context.projectId) {
      throw new AgentLoopError(
        'PROJECT_MISMATCH',
        'Principal projectId does not match execution context.',
      );
    }
  }

  private async executeIntentUnlocked(
    rawIntent: unknown,
    context: AgentLoopExecuteContext,
    state: AgentLoopPersistedState,
  ): Promise<AgentLoopTurnResult> {
    if (context.projectId !== this.deps.projectId) {
      return this.rejectWithoutBudget(context, 'unknown', 'unknown', {
        code: 'PROJECT_MISMATCH',
        message: 'Loop projectId does not match execution context.',
      });
    }
    if (context.principal.projectId !== context.projectId) {
      return this.rejectWithoutBudget(context, 'unknown', 'unknown', {
        code: 'PROJECT_MISMATCH',
        message: 'Principal projectId does not match execution context.',
      });
    }

    const nowMs = this.clock.now().getTime();
    const wall = assertWallClockRemaining(state.budget, this.budgets, nowMs);
    if (!wall.ok) {
      return this.persistRejection(state, context, 'unknown', 'unknown', {
        status: 'BUDGET_EXHAUSTED',
        code: wall.code,
        message: wall.message,
      });
    }

    let intent: ProviderStructuredToolIntent;
    try {
      intent = parseProviderStructuredToolIntent(rawIntent);
    } catch (error: unknown) {
      const code = error instanceof AgentLoopError ? error.code : 'INVALID_INTENT_SCHEMA';
      const message = error instanceof Error ? error.message : 'Invalid intent.';
      return this.persistRejection(state, context, 'invalid', 'invalid', {
        status: 'REJECTED_BY_POLICY',
        code,
        message,
      });
    }

    // Idempotent replay remains available after budget stop (no re-execution).
    if (state.budget.completedIntentIds.includes(intent.intentId)) {
      const prior = state.evidence.filter((entry) => entry.intentId === intent.intentId).at(-1);
      const evidence =
        prior ??
        this.buildEvidence(context, intent, 'REPLAYED', 'Idempotent replay of completed intent.');
      return {
        intentId: intent.intentId,
        toolId: intent.toolId,
        status: 'REPLAYED',
        evidence,
        budget: state.budget,
        replayed: true,
        errorCode: 'IDEMPOTENT_REPLAY',
        errorMessage: 'Intent already completed for this run.',
      };
    }

    if (state.stoppedReason !== undefined) {
      return this.rejectWithoutBudget(context, intent.intentId, intent.toolId, {
        code: 'LOOP_STOPPED',
        message: `Loop previously stopped: ${state.stoppedReason}`,
      });
    }

    if (state.budget.toolCalls >= this.budgets.maxToolCallsPerRun) {
      return this.persistRejection(state, context, intent.intentId, intent.toolId, {
        status: 'BUDGET_EXHAUSTED',
        code: 'TOOL_CALL_BUDGET_EXHAUSTED',
        message: 'Maximum tool calls for this run exceeded.',
        stop: true,
      });
    }

    let handler;
    try {
      handler = this.deps.registry.require(intent.toolId);
    } catch {
      return this.persistRejection(state, context, intent.intentId, intent.toolId, {
        status: 'REJECTED_BY_POLICY',
        code: 'UNKNOWN_TOOL',
        message: `Unknown toolId "${intent.toolId}".`,
      });
    }

    const autonomous = assertAutonomousLoopToolAllowed(context.phase, handler.definition);
    if (!autonomous.ok) {
      return this.persistRejection(state, context, intent.intentId, intent.toolId, {
        status: 'REJECTED_BY_POLICY',
        code: autonomous.code,
        message: autonomous.message,
      });
    }

    const fingerprint = fingerprintToolCall(intent.toolId, intent.arguments ?? null);
    const priorRepeats = state.budget.identicalRepeatCounts[fingerprint] ?? 0;
    if (priorRepeats >= this.budgets.maxIdenticalToolArgsRepeats) {
      return this.persistRejection(state, context, intent.intentId, intent.toolId, {
        status: 'BUDGET_EXHAUSTED',
        code: 'IDENTICAL_REPEAT_BUDGET_EXHAUSTED',
        message: 'Maximum identical tool+args repeats exceeded.',
        stop: true,
      });
    }

    const isB4Verify = intent.toolId === 'run_verification_command';
    if (
      isB4Verify &&
      state.budget.b4VerificationCalls >= this.budgets.maxB4VerificationCallsPerRun
    ) {
      return this.persistRejection(state, context, intent.intentId, intent.toolId, {
        status: 'BUDGET_EXHAUSTED',
        code: 'B4_VERIFICATION_BUDGET_EXHAUSTED',
        message: 'Maximum B4 verification calls for this run exceeded.',
        stop: true,
      });
    }

    const isBrowserObservation = intent.toolId === 'run_local_browser_observation';
    if (
      isBrowserObservation &&
      state.budget.browserObservationCalls >= this.budgets.maxBrowserObservationCallsPerRun
    ) {
      return this.persistRejection(state, context, intent.intentId, intent.toolId, {
        status: 'BUDGET_EXHAUSTED',
        code: 'BROWSER_OBSERVATION_BUDGET_EXHAUSTED',
        message: 'Maximum browser observation calls for this run exceeded.',
        stop: true,
      });
    }

    if (context.cancellation.cancelled) {
      return this.persistRejection(state, context, intent.intentId, intent.toolId, {
        status: 'CANCELLED',
        code: 'CANCELLED',
        message: context.cancellation.reason ?? 'cancelled',
        stop: true,
      });
    }

    const callIntent: ToolCallIntent = {
      callId: intent.intentId,
      toolId: intent.toolId,
      args: intent.arguments ?? {},
      idempotencyKey: intent.intentId,
    };
    const toolContext: ToolExecutionContext = {
      runId: context.runId,
      projectId: context.projectId,
      projectRoot: context.projectRoot,
      phase: context.phase,
      principal: context.principal,
      securityProfile: context.securityProfile,
      securityEvidence: context.securityEvidence,
      cancellation: context.cancellation,
      preparationId: context.preparationId,
      workflowId: context.workflowId,
      investigationId: context.investigationId,
      correctionWorkflowId: context.correctionWorkflowId,
      correlationId: context.correlationId,
    };

    const toolResult = await this.deps.executor.execute(callIntent, toolContext);
    const status = mapToolStatus(toolResult);
    const nextIdentical = {
      ...state.budget.identicalRepeatCounts,
      [fingerprint]: priorRepeats + 1,
    };
    const nextBudget: AgentLoopBudgetSnapshot = {
      ...state.budget,
      toolCalls: state.budget.toolCalls + 1,
      b4VerificationCalls: state.budget.b4VerificationCalls + (isB4Verify ? 1 : 0),
      browserObservationCalls:
        state.budget.browserObservationCalls + (isBrowserObservation ? 1 : 0),
      identicalRepeatCounts: nextIdentical,
      completedIntentIds: [...state.budget.completedIntentIds, intent.intentId],
    };
    const evidence = this.buildEvidence(context, intent, status, toolResult.summary, toolResult);
    const nextState: AgentLoopPersistedState = {
      ...state,
      budget: nextBudget,
      evidence: [...state.evidence, evidence],
      updatedAt: this.clock.now().toISOString(),
    };
    this.states.set(context.runId, nextState);
    await this.deps.persistence.save(nextState);

    return {
      intentId: intent.intentId,
      toolId: intent.toolId,
      status,
      toolResult,
      evidence,
      budget: nextBudget,
      replayed: false,
      ...(toolResult.errorCode !== undefined ? { errorCode: toolResult.errorCode } : {}),
      ...(toolResult.errorMessage !== undefined ? { errorMessage: toolResult.errorMessage } : {}),
    };
  }

  private async ensureState(context: AgentLoopExecuteContext): Promise<AgentLoopPersistedState> {
    const existing = this.states.get(context.runId);
    if (existing !== undefined) return existing;
    const loaded = await this.deps.persistence.load(context.runId);
    if (loaded !== undefined) {
      const normalized = normalizePersistedState(loaded);
      this.states.set(context.runId, normalized);
      return normalized;
    }
    const created: AgentLoopPersistedState = {
      schemaVersion: AGENT_LOOP_SCHEMA_VERSION,
      runId: context.runId,
      projectId: context.projectId,
      budget: createInitialBudgetSnapshot(this.clock.now().getTime()),
      evidence: [],
      updatedAt: this.clock.now().toISOString(),
    };
    this.states.set(context.runId, created);
    await this.deps.persistence.save(created);
    return created;
  }

  private async withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
    if (this.locks.has(runId)) {
      throw new AgentLoopError(
        'CONCURRENT_EXECUTION_REJECTED',
        'Serial agent loop execution required; concurrent tool turns rejected.',
      );
    }
    this.locks.add(runId);
    try {
      return await work();
    } finally {
      this.locks.delete(runId);
    }
  }

  private async stopTurn(
    state: AgentLoopPersistedState,
    context: AgentLoopExecuteContext,
    results: AgentLoopTurnResult[],
    code: string,
    message: string,
  ): Promise<AgentLoopProviderTurnResult> {
    const stopped: AgentLoopPersistedState = {
      ...state,
      stoppedReason: code,
      updatedAt: this.clock.now().toISOString(),
    };
    this.states.set(context.runId, stopped);
    await this.deps.persistence.save(stopped);
    return {
      turnIndex: stopped.budget.providerTurns,
      results,
      budget: stopped.budget,
      stopped: true,
      stopReason: `${code}: ${message}`,
    };
  }

  private async persistRejection(
    state: AgentLoopPersistedState,
    context: AgentLoopExecuteContext,
    intentId: string,
    toolId: string,
    rejection: {
      readonly status: AgentLoopTurnStatus;
      readonly code: string;
      readonly message: string;
      readonly stop?: boolean;
    },
  ): Promise<AgentLoopTurnResult> {
    const evidence = this.buildEvidence(
      context,
      { intentId, toolId },
      rejection.status,
      rejection.message,
    );
    const countsTowardBudget =
      rejection.status === 'REJECTED_BY_POLICY' || rejection.status === 'BUDGET_EXHAUSTED';
    const nextBudget: AgentLoopBudgetSnapshot = countsTowardBudget
      ? {
          ...state.budget,
          toolCalls: state.budget.toolCalls + 1,
          identicalRepeatCounts: { ...state.budget.identicalRepeatCounts },
          completedIntentIds: [...state.budget.completedIntentIds],
        }
      : state.budget;
    const nextState: AgentLoopPersistedState = {
      ...state,
      budget: nextBudget,
      evidence: [...state.evidence, evidence],
      ...(rejection.stop ? { stoppedReason: rejection.code } : {}),
      updatedAt: this.clock.now().toISOString(),
    };
    this.states.set(context.runId, nextState);
    await this.deps.persistence.save(nextState);
    return {
      intentId,
      toolId,
      status: rejection.status,
      errorCode: rejection.code,
      errorMessage: rejection.message,
      evidence,
      budget: nextBudget,
      replayed: false,
    };
  }

  private rejectWithoutBudget(
    context: AgentLoopExecuteContext,
    intentId: string,
    toolId: string,
    rejection: { readonly code: string; readonly message: string },
  ): AgentLoopTurnResult {
    const evidence = this.buildEvidence(
      context,
      { intentId, toolId },
      'REJECTED_BY_POLICY',
      rejection.message,
    );
    const budget =
      this.states.get(context.runId)?.budget ??
      createInitialBudgetSnapshot(this.clock.now().getTime());
    return {
      intentId,
      toolId,
      status: 'REJECTED_BY_POLICY',
      errorCode: rejection.code,
      errorMessage: rejection.message,
      evidence,
      budget,
      replayed: false,
    };
  }

  private buildEvidence(
    context: AgentLoopExecuteContext,
    intent: { readonly intentId: string; readonly toolId: string },
    status: AgentLoopTurnStatus,
    summary: string,
    toolResult?: ToolResult,
  ): BoundedToolEvidenceRecord {
    const recordedAt = this.clock.now().toISOString();
    const summaryDigest = digestSummary(summary);
    const planningProjection =
      toolResult?.structured !== undefined
        ? extractOperatorToolPlanningProjection({
            runId: context.runId,
            toolId: intent.toolId,
            intentId: intent.intentId,
            phase: context.phase,
            status,
            recordedAt,
            summaryDigest,
            structured: toolResult.structured,
          })
        : undefined;
    const verificationEvidence =
      toolResult?.structured !== undefined
        ? extractBoundedVerificationEvidence({
            toolId: intent.toolId,
            structured: toolResult.structured,
          })
        : undefined;

    return {
      schemaVersion: AGENT_LOOP_SCHEMA_VERSION,
      runId: context.runId,
      projectId: context.projectId,
      phase: context.phase,
      toolId: intent.toolId,
      intentId: intent.intentId,
      status,
      recordedAt,
      summaryDigest,
      ...(planningProjection === undefined ? {} : { planningProjection }),
      ...(verificationEvidence === undefined ? {} : { verificationEvidence }),
      ...(toolResult !== undefined ? { resultStatus: toolResult.status } : {}),
      ...(toolResult?.errorCode !== undefined ? { errorCode: toolResult.errorCode } : {}),
      ...(context.preparationId !== undefined ? { preparationId: context.preparationId } : {}),
      ...(context.workflowId !== undefined ? { workflowId: context.workflowId } : {}),
    };
  }
}

function mapToolStatus(result: ToolResult): AgentLoopTurnStatus {
  switch (result.status) {
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'REJECTED_BY_POLICY':
      return 'REJECTED_BY_POLICY';
    default:
      return 'FAILED';
  }
}

function normalizePersistedState(state: AgentLoopPersistedState): AgentLoopPersistedState {
  return {
    ...state,
    budget: {
      ...state.budget,
      browserObservationCalls: state.budget.browserObservationCalls ?? 0,
      b4VerificationCalls: state.budget.b4VerificationCalls ?? 0,
    },
  };
}
