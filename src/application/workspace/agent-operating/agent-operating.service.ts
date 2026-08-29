import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { AgentRunError } from './agent-run.types';
import type { AgentRunService } from './agent-run.service';
import type {
  AgentOperatingDependencies,
  AgentOperatingExecuteResult,
  AgentOperatingExplainArtifactResult,
  AgentOperatingExplainResult,
  AgentOperatingFailureResult,
  AgentOperatingGate2PauseResult,
  AgentOperatingPlanResult,
  AgentOperatingStartResult,
  AgentOperatingToolEvidenceResult,
  AgentOperatingToolTurnResult,
  AgentRunEphemeralEvidence,
  AgentRunExplanation,
} from './agent-operating.types';
import type { WorkspaceRequestSecurityEvidence } from '../workspace-authorization.types';
import type { WorkspaceCompletion } from '../workspace-runtime.types';
import { isCorrectionEligibleCompletion } from '../correction-loop/correction-failure-classifier';
import { buildIterationFeedbackFromCompletion } from '../iteration-feedback.service';
import { assembleExplainArtifact } from './explain-artifact.assembler';
import type { ExplainArtifact } from './explain-artifact.types';
import type {
  AgentLoopBudgetSnapshot,
  BoundedToolEvidenceRecord,
} from '../agent-loop/agent-loop.types';
import type { AgentLoopExecuteContext } from '../agent-loop/agent-loop.service';
import { AgentLoopError } from '../agent-loop/agent-loop.types';
import { createWorkspaceAuthorizationContext } from '../workspace-authorization.service';
import { ProviderStructuredIntentEmissionService } from './provider-structured-intent-emission.service';
import { isInvestigationHandoffFeedback } from '../investigation/investigation-handoff';
import { buildOperatorToolPlanningContext } from './operator-tool-planning-context';
import { mergeOperatorToolPlanningWithHandoff } from './operator-tool-planning-merge';
import {
  assembleGate2PlanningProvenance,
  extractCorrectionPlanningPathHints,
} from './gate2-planning-provenance.assembler';
import type { InvestigationHandoffFeedback } from '../investigation/investigation-handoff';
import type { OperatorToolPlanningContext } from './operator-tool-planning-context';
import type { OperatorToolPlanningMergeInput } from './operator-tool-planning-prepare-input';
import { deriveVerificationPlanningProjection } from './verification-planning-projection';
import { buildAgentOperatingPlanPrepareInput } from './verification-planning-prepare-input';

const EXPLAIN_SUMMARY_MAX = 1_200;

/**
 * P1-A Step 2: thin orchestration façade over existing P0 services.
 * Never mutates files, never approves Gate 2, never constructs ChangePlans.
 */
export class AgentOperatingService {
  private readonly ephemeral = new Map<string, AgentRunEphemeralEvidence>();
  private readonly inFlightExecute = new Set<string>();

  constructor(private readonly dependencies: AgentOperatingDependencies) {}

  async whenReady(): Promise<void> {
    await this.dependencies.agentRuns.whenReady();
    await this.dependencies.correction.whenReady();
  }

  async getRun(runId: string) {
    return this.dependencies.agentRuns.require(runId);
  }

  /**
   * B8: run-bound, phase-gated tool turn via existing AgentLoopService.
   * Does not transition AgentRun phase and never applies FileApply / Gate2.
   */
  async executeToolTurn(
    runId: string,
    input: {
      readonly intents: readonly unknown[];
      readonly securityEvidence?: WorkspaceRequestSecurityEvidence;
      readonly cancellation?: ExecutionCancellationToken;
    },
  ): Promise<AgentOperatingToolTurnResult> {
    await this.whenReady();
    const loop = this.requireLoop();
    const run = await this.dependencies.agentRuns.require(runId);
    this.assertRunProjectBinding(run.projectId);
    if (
      run.phase === 'COMPLETED' ||
      run.phase === 'FAILED' ||
      run.phase === 'CANCELLED' ||
      run.phase === 'EXPLAINING'
    ) {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        `Tool turns are not allowed in phase ${run.phase}.`,
      );
    }
    if (run.phase === 'EXECUTING') {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        'EXECUTING is tool-free; Gate2 → approveAndApply → FileApply is the sole source mutation path.',
      );
    }

    const context = this.buildLoopContext(run, input.securityEvidence, input.cancellation);
    await loop.hydrate(runId);

    try {
      if (input.intents.length === 0) {
        throw new AgentRunError('INVALID_GOAL', 'At least one structured tool intent is required.');
      }
      const turn =
        input.intents.length === 1
          ? await loop.executeIntent(input.intents[0], context)
          : await loop.executeProviderTurn(input.intents, context);
      const budget =
        'budget' in turn && turn.budget !== undefined
          ? turn.budget
          : (loop.getBudget(runId) ?? {
              toolCalls: 0,
              providerTurns: 0,
              b4VerificationCalls: 0,
              browserObservationCalls: 0,
              startedAtMs: this.dependencies.clock.now().getTime(),
              identicalRepeatCounts: {},
              completedIntentIds: [],
            });
      return {
        run,
        turn,
        evidence: loop.listEvidence(runId),
        budget,
      };
    } catch (error: unknown) {
      if (error instanceof AgentLoopError) {
        if (error.code === 'CONCURRENT_EXECUTION_REJECTED') {
          throw new AgentRunError('INVALID_TRANSITION', error.message);
        }
        if (error.code === 'PROJECT_MISMATCH') {
          throw new AgentRunError('NOT_FOUND', error.message);
        }
        throw new AgentRunError('INVALID_TRANSITION', error.message);
      }
      throw error;
    }
  }

  /**
   * B10 / ADR-046: provider proposes structured intents (toolCalling:false); server executes
   * exclusively via existing executeToolTurn / AgentLoop. Explicit trigger only — no auto-continue.
   */
  async executeProviderAssistedToolTurn(
    runId: string,
    input: {
      readonly securityEvidence?: WorkspaceRequestSecurityEvidence;
      readonly cancellation?: ExecutionCancellationToken;
    } = {},
  ): Promise<AgentOperatingToolTurnResult> {
    await this.whenReady();
    this.requireLoop();
    const providerExecution = this.dependencies.providerExecution;
    if (providerExecution === undefined) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'Provider structured-intent emission is not composed for this AgentOperating instance.',
      );
    }
    const run = await this.dependencies.agentRuns.require(runId);
    this.assertRunProjectBinding(run.projectId);
    if (
      run.phase === 'COMPLETED' ||
      run.phase === 'FAILED' ||
      run.phase === 'CANCELLED' ||
      run.phase === 'EXPLAINING'
    ) {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        `Tool turns are not allowed in phase ${run.phase}.`,
      );
    }
    if (run.phase === 'EXECUTING') {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        'EXECUTING is tool-free; Gate2 → approveAndApply → FileApply is the sole source mutation path.',
      );
    }

    const emission = new ProviderStructuredIntentEmissionService({
      providerExecution,
      ids: this.dependencies.ids,
      clock: this.dependencies.clock,
      ...(this.dependencies.providerTimeoutMs === undefined
        ? {}
        : { providerTimeoutMs: this.dependencies.providerTimeoutMs }),
    });
    const { intents, digest } = await emission.proposeIntentsWithDigest({
      run,
      ...(input.cancellation === undefined ? {} : { cancellation: input.cancellation }),
    });
    const turnResult = await this.executeToolTurn(runId, {
      intents,
      ...(input.securityEvidence === undefined ? {} : { securityEvidence: input.securityEvidence }),
      ...(input.cancellation === undefined ? {} : { cancellation: input.cancellation }),
    });
    return { ...turnResult, providerAssisted: digest };
  }

  /** Bounded tool-loop digests for operator visibility (hydrate-only; never auto-continues). */
  async getToolEvidence(runId: string): Promise<AgentOperatingToolEvidenceResult> {
    await this.whenReady();
    const run = await this.dependencies.agentRuns.require(runId);
    this.assertRunProjectBinding(run.projectId);
    const loop = this.dependencies.loop;
    if (loop === undefined) {
      return { run, evidence: [] };
    }
    await loop.hydrate(runId);
    return {
      run,
      evidence: loop.listEvidence(runId),
      ...(loop.getBudget(runId) === undefined ? {} : { budget: loop.getBudget(runId) }),
    };
  }

  /**
   * Create AgentRun, remain UNDERSTANDING, run existing investigation (no mutation).
   */
  async startRun(
    goal: string,
    options: { readonly runId?: string } = {},
  ): Promise<AgentOperatingStartResult> {
    await this.whenReady();
    const createdAt = this.dependencies.clock.now().toISOString();
    const run = await this.dependencies.agentRuns.create({
      runId: options.runId ?? this.dependencies.ids.generate(),
      projectId: this.dependencies.projectId,
      goal,
      createdAt,
    });
    const investigation = await this.dependencies.investigation.investigate(goal);
    const updated = await this.dependencies.agentRuns.updateReferences(run.runId, {
      investigationId: investigation.investigationId,
    });
    return { run: updated, investigation };
  }

  /**
   * PLANNING via existing prepare. Does not apply. Does not store ChangePlan on AgentRun.
   * From CORRECTING: prepares a correction plan via CorrectionLoopService (still no apply).
   */
  async plan(
    runId: string,
    options: { readonly cancellation?: ExecutionCancellationToken } = {},
  ): Promise<AgentOperatingPlanResult> {
    await this.whenReady();
    let run = await this.dependencies.agentRuns.require(runId);
    if (run.phase === 'CORRECTING') {
      return this.planCorrection(runId, options);
    }
    if (run.phase === 'UNDERSTANDING' || run.phase === 'AWAITING_GATE2') {
      run = await this.dependencies.agentRuns.transition(runId, 'PLANNING');
    } else if (run.phase !== 'PLANNING') {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        `plan requires UNDERSTANDING, PLANNING, AWAITING_GATE2, or CORRECTING (was ${run.phase}).`,
      );
    }

    const rawHandoff =
      run.references.investigationId === undefined
        ? undefined
        : this.dependencies.investigation.resolveInvestigationHandoff(
            run.references.investigationId,
          );
    const handoff = isInvestigationHandoffFeedback(rawHandoff) ? rawHandoff : undefined;

    let prepareInput: unknown = handoff;
    let operatorContext: OperatorToolPlanningContext | undefined;
    let mergedForProvenance:
      OperatorToolPlanningMergeInput | InvestigationHandoffFeedback | undefined = handoff;
    let verificationPlanning = undefined as
      ReturnType<typeof deriveVerificationPlanningProjection> | undefined;
    const loop = this.dependencies.loop;
    if (loop !== undefined) {
      await loop.hydrate(runId);
      const evidence = loop.listEvidence(runId);
      operatorContext = buildOperatorToolPlanningContext(evidence);
      const merged = mergeOperatorToolPlanningWithHandoff({ handoff, operatorContext });
      if (merged !== undefined) {
        prepareInput = merged;
        mergedForProvenance = merged;
      }
      // ADR-051: same projection object feeds prepare and Gate2 provenance (transparency).
      verificationPlanning = deriveVerificationPlanningProjection(evidence);
      if (verificationPlanning !== undefined) {
        prepareInput = buildAgentOperatingPlanPrepareInput({
          ...(merged !== undefined
            ? { planning: merged }
            : handoff !== undefined
              ? { planning: handoff }
              : {}),
          verificationPlanning,
        });
      }
    }

    const preparation = await this.dependencies.runtime.prepare(
      run.goal,
      prepareInput,
      options.cancellation,
    );

    const planningProvenance = assembleGate2PlanningProvenance({
      handoff,
      operatorContext,
      merged: mergedForProvenance,
      gate2Review: preparation.gate2Review,
      ...(verificationPlanning === undefined ? {} : { verificationPlanning }),
    });

    run = await this.dependencies.agentRuns.updateReferences(runId, {
      preparationId: preparation.preparationId,
      workflowId: preparation.preparationId,
    });

    const priorCycles = this.ephemeral.get(runId)?.gate2CyclesObserved;
    this.ephemeral.set(runId, {
      gate2Review: preparation.gate2Review,
      preparationId: preparation.preparationId,
      expiresAt: preparation.expiresAt,
      planningProvenance,
      ...(preparation.applyAuthorizationToken === undefined
        ? {}
        : { applyAuthorizationToken: preparation.applyAuthorizationToken }),
      ...(preparation.outcome === undefined
        ? {}
        : { preparationOutcome: preparation.outcome.kind }),
      ...(priorCycles === undefined ? {} : { gate2CyclesObserved: priorCycles }),
    });

    return {
      run,
      gate2Review: preparation.gate2Review,
      preparationId: preparation.preparationId,
      expiresAt: preparation.expiresAt,
      planningProvenance,
      ...(preparation.applyAuthorizationToken === undefined
        ? {}
        : { applyAuthorizationToken: preparation.applyAuthorizationToken }),
    };
  }

  /**
   * Real Gate 2 interrupt. Does not approve. Does not apply.
   * Also used after correction planning (CORRECTING → AWAITING_GATE2).
   */
  async pauseAtGate2(runId: string): Promise<AgentOperatingGate2PauseResult> {
    await this.whenReady();
    const evidence = this.requireEphemeral(runId);
    let run = await this.dependencies.agentRuns.require(runId);
    if (run.phase === 'PLANNING' || run.phase === 'CORRECTING') {
      run = await this.dependencies.agentRuns.transition(runId, 'AWAITING_GATE2');
    } else if (run.phase !== 'AWAITING_GATE2') {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        `pauseAtGate2 requires PLANNING, CORRECTING, or AWAITING_GATE2 (was ${run.phase}).`,
      );
    }
    const gate2CyclesObserved = (evidence.gate2CyclesObserved ?? 0) + 1;
    this.ephemeral.set(runId, { ...evidence, gate2CyclesObserved });
    return {
      run,
      gate2Review: evidence.gate2Review,
      preparationId: evidence.preparationId,
      expiresAt: evidence.expiresAt,
      ...(evidence.planningProvenance === undefined
        ? {}
        : { planningProvenance: evidence.planningProvenance }),
      ...(evidence.applyAuthorizationToken === undefined
        ? {}
        : { applyAuthorizationToken: evidence.applyAuthorizationToken }),
    };
  }

  /**
   * Delegates to existing approveAndApply. Caller must pass approved=true and any
   * security evidence; this service never invents approval.
   */
  async executeAfterApproval(
    runId: string,
    approval: {
      readonly approved: boolean;
      readonly evidence?: Omit<WorkspaceRequestSecurityEvidence, 'operatorApproved'>;
      readonly cancellation?: ExecutionCancellationToken;
    },
  ): Promise<AgentOperatingExecuteResult | AgentOperatingFailureResult> {
    if (this.inFlightExecute.has(runId)) {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        'Execute already in progress for this AgentRun.',
      );
    }
    this.inFlightExecute.add(runId);
    try {
      await this.whenReady();
      return await this.executeAfterApprovalLocked(runId, approval);
    } finally {
      this.inFlightExecute.delete(runId);
    }
  }

  private async executeAfterApprovalLocked(
    runId: string,
    approval: {
      readonly approved: boolean;
      readonly evidence?: Omit<WorkspaceRequestSecurityEvidence, 'operatorApproved'>;
      readonly cancellation?: ExecutionCancellationToken;
    },
  ): Promise<AgentOperatingExecuteResult | AgentOperatingFailureResult> {
    let run = await this.dependencies.agentRuns.require(runId);
    if (run.phase !== 'AWAITING_GATE2') {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        `executeAfterApproval requires AWAITING_GATE2 (was ${run.phase}).`,
      );
    }
    const preparationId = run.references.preparationId;
    if (preparationId === undefined) {
      throw new AgentRunError('INVALID_REFERENCE', 'AgentRun has no preparationId.');
    }
    const correctionWorkflowId = run.references.correctionWorkflowId;

    const evidence: WorkspaceRequestSecurityEvidence = {
      ...(approval.evidence ?? {}),
      operatorApproved: approval.approved,
    };

    // Keep Gate 2 interrupt real: do not leave AWAITING_GATE2 until approval is accepted.
    if (!approval.approved) {
      await this.dependencies.runtime.approveAndApply(
        preparationId,
        false,
        evidence,
        approval.cancellation,
      );
      throw new AgentRunError(
        'INVALID_TRANSITION',
        'Explicit Gate 2 approval is required before executeAfterApproval.',
      );
    }

    run = await this.dependencies.agentRuns.transition(runId, 'EXECUTING');

    if (correctionWorkflowId !== undefined) {
      await this.dependencies.correction.recordApplying(correctionWorkflowId);
    }

    let completion: WorkspaceCompletion;
    try {
      completion = await this.dependencies.runtime.approveAndApply(
        preparationId,
        true,
        evidence,
        approval.cancellation,
      );
    } catch (error: unknown) {
      await this.dependencies.agentRuns.transition(runId, 'FAILED');
      throw error;
    }

    run = await this.dependencies.agentRuns.transition(runId, 'VERIFYING');
    if (correctionWorkflowId === undefined) {
      run = await this.dependencies.agentRuns.updateReferences(runId, {
        workflowId: preparationId,
      });
    }

    const prior = this.ephemeral.get(runId);
    this.ephemeral.set(runId, {
      gate2Review: prior?.gate2Review ?? {
        schemaVersion: 1,
        operationDiffs: [],
        totalCharacterCount: 0,
        truncated: false,
      },
      preparationId,
      expiresAt: prior?.expiresAt ?? run.updatedAt,
      ...(prior?.applyAuthorizationToken === undefined
        ? {}
        : { applyAuthorizationToken: prior.applyAuthorizationToken }),
      ...(prior?.preparationOutcome === undefined
        ? {}
        : { preparationOutcome: prior.preparationOutcome }),
      ...(prior?.gate2CyclesObserved === undefined
        ? {}
        : { gate2CyclesObserved: prior.gate2CyclesObserved }),
      completion,
    });

    if (correctionWorkflowId !== undefined) {
      await this.dependencies.correction.recordVerificationComplete(
        correctionWorkflowId,
        completion,
      );
    }

    if (isVerificationFailure(completion)) {
      return this.beginExistingCorrection(runId, completion);
    }

    return { run, completion };
  }

  /**
   * Lifecycle explain step: assemble deterministic artifact, persist, mark COMPLETED.
   * Does not call a provider.
   */
  async explain(runId: string): Promise<AgentOperatingExplainResult> {
    await this.whenReady();
    let run = await this.dependencies.agentRuns.require(runId);
    if (run.phase === 'VERIFYING' || run.phase === 'DIAGNOSING') {
      run = await this.dependencies.agentRuns.transition(runId, 'EXPLAINING');
    } else if (run.phase !== 'EXPLAINING') {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        `explain requires VERIFYING, DIAGNOSING, or EXPLAINING (was ${run.phase}).`,
      );
    }

    run = await this.dependencies.agentRuns.transition(runId, 'COMPLETED');
    const explain = await this.buildAndPersistExplain(run);
    const explanation = toLegacyExplanation(explain, run);
    return { run, explanation, explain };
  }

  /**
   * Read-only Explain projection. Never mutates workspace or AgentRun phase.
   * Prefers durable artifact; otherwise assembles from available evidence.
   */
  async getExplainArtifact(runId: string): Promise<AgentOperatingExplainArtifactResult> {
    await this.whenReady();
    const run = await this.dependencies.agentRuns.require(runId);
    const persisted = await this.dependencies.explainArtifacts.load(runId);
    if (persisted !== undefined) {
      return { run, explain: persisted, persisted: true };
    }
    const explain = await this.assembleFromAvailableEvidence(run);
    return { run, explain, persisted: false };
  }

  async cancel(
    runId: string,
    reason = 'agent run cancelled',
  ): Promise<{ readonly run: Awaited<ReturnType<AgentRunService['cancel']>> }> {
    await this.whenReady();
    const current = await this.dependencies.agentRuns.require(runId);
    if (current.references.correctionWorkflowId !== undefined) {
      await this.dependencies.correction.cancelCorrection(
        current.references.correctionWorkflowId,
        reason,
      );
    }
    const run = await this.dependencies.agentRuns.cancel(runId);
    return { run };
  }

  /** Restart-safe: load AgentRun only. Never approves or applies. */
  async hydrate(): Promise<void> {
    await this.whenReady();
  }

  /**
   * Correction plan via existing CorrectionLoopService + runtime.prepare.
   * Remains CORRECTING until pauseAtGate2 (explicit Gate 2). Never applies.
   */
  private async planCorrection(
    runId: string,
    options: { readonly cancellation?: ExecutionCancellationToken },
  ): Promise<AgentOperatingPlanResult> {
    const run = await this.dependencies.agentRuns.require(runId);
    const correctionWorkflowId = run.references.correctionWorkflowId;
    if (correctionWorkflowId === undefined) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'AgentRun has no correctionWorkflowId for correction planning.',
      );
    }
    const session =
      (await this.dependencies.correction.getSessionAsync(correctionWorkflowId)) ??
      this.dependencies.correction.getSession(correctionWorkflowId);
    if (session === undefined || session.correctionRequest === undefined) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'Correction session / request is not available for planning.',
      );
    }
    const prior = this.ephemeral.get(runId);
    if (prior?.completion === undefined) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'Prior completion evidence is required to plan a correction.',
      );
    }
    if (prior.correctionCanPrepare === false) {
      throw new AgentRunError(
        'INVALID_TRANSITION',
        'CorrectionLoopService reported canPrepare=false.',
      );
    }

    const iterationFeedback = buildIterationFeedbackFromCompletion(prior.completion);
    const correctionPathHints = extractCorrectionPlanningPathHints(iterationFeedback);
    const preparation = await this.dependencies.runtime.prepare(
      session.correctionRequest,
      iterationFeedback,
      options.cancellation,
    );

    const planningProvenance = assembleGate2PlanningProvenance({
      gate2Review: preparation.gate2Review,
      correctionPathHints,
    });

    const recorded = await this.dependencies.correction.recordPrepared(
      correctionWorkflowId,
      preparation.preparationId,
      preparation.changePlan,
    );
    if (
      recorded.state === 'CORRECTION_BLOCKED' ||
      recorded.state === 'CORRECTION_LOOP_DETECTED' ||
      recorded.state === 'CORRECTION_EXHAUSTED'
    ) {
      await this.dependencies.agentRuns.transition(runId, 'FAILED');
      throw new AgentRunError(
        'INVALID_TRANSITION',
        recorded.blockMessage ?? `Correction planning blocked (${recorded.state}).`,
      );
    }

    const updated = await this.dependencies.agentRuns.updateReferences(runId, {
      preparationId: preparation.preparationId,
    });

    this.ephemeral.set(runId, {
      gate2Review: preparation.gate2Review,
      preparationId: preparation.preparationId,
      expiresAt: preparation.expiresAt,
      planningProvenance,
      ...(preparation.applyAuthorizationToken === undefined
        ? {}
        : { applyAuthorizationToken: preparation.applyAuthorizationToken }),
      ...(preparation.outcome === undefined
        ? {}
        : { preparationOutcome: preparation.outcome.kind }),
      completion: prior.completion,
      correctionCanPrepare: true,
      ...(prior.gate2CyclesObserved === undefined
        ? {}
        : { gate2CyclesObserved: prior.gate2CyclesObserved }),
    });

    return {
      run: updated,
      gate2Review: preparation.gate2Review,
      preparationId: preparation.preparationId,
      expiresAt: preparation.expiresAt,
      planningProvenance,
      ...(preparation.applyAuthorizationToken === undefined
        ? {}
        : { applyAuthorizationToken: preparation.applyAuthorizationToken }),
    };
  }

  private async beginExistingCorrection(
    runId: string,
    completion: WorkspaceCompletion,
  ): Promise<AgentOperatingFailureResult> {
    let run = await this.dependencies.agentRuns.transition(runId, 'DIAGNOSING');
    const workflowId =
      run.references.correctionWorkflowId ??
      run.references.workflowId ??
      run.references.preparationId;
    if (workflowId === undefined) {
      throw new AgentRunError('INVALID_REFERENCE', 'AgentRun has no workflowId for correction.');
    }
    if (!isCorrectionEligibleCompletion(completion)) {
      run = await this.dependencies.agentRuns.transition(runId, 'FAILED');
      throw new AgentRunError(
        'INVALID_TRANSITION',
        'Completion is not eligible for the existing correction loop.',
      );
    }

    const began = await this.dependencies.correction.beginFromCompletion(workflowId, completion, {
      originalTaskSummary: run.goal,
      sourcePreparationId: run.references.preparationId,
      priorRequestSummary: run.goal,
    });

    run = await this.dependencies.agentRuns.updateReferences(runId, {
      correctionWorkflowId: workflowId,
      workflowId,
    });
    run = await this.dependencies.agentRuns.transition(runId, 'CORRECTING');

    const prior = this.ephemeral.get(runId);
    if (prior !== undefined) {
      this.ephemeral.set(runId, {
        ...prior,
        completion,
        correctionCanPrepare: began.canPrepare,
      });
    }

    // Persist a correction-state explain snapshot (orchestration metadata only).
    await this.buildAndPersistExplain(run);

    return {
      run,
      completion,
      correctionWorkflowId: workflowId,
      canPrepareCorrection: began.canPrepare,
    };
  }

  private async buildAndPersistExplain(
    run: Awaited<ReturnType<AgentRunService['require']>>,
  ): Promise<ExplainArtifact> {
    const explain = await this.assembleFromAvailableEvidence(run);
    await this.dependencies.explainArtifacts.save(explain);
    return explain;
  }

  private async assembleFromAvailableEvidence(
    run: Awaited<ReturnType<AgentRunService['require']>>,
  ): Promise<ExplainArtifact> {
    const evidence = this.ephemeral.get(run.runId);
    let correctionSession =
      run.references.correctionWorkflowId === undefined
        ? undefined
        : await this.dependencies.correction.getSessionAsync(run.references.correctionWorkflowId);
    if (correctionSession === undefined && run.references.correctionWorkflowId !== undefined) {
      correctionSession = this.dependencies.correction.getSession(
        run.references.correctionWorkflowId,
      );
    }
    return assembleExplainArtifact({
      run,
      generatedAt: this.dependencies.clock.now().toISOString(),
      ...(evidence?.preparationOutcome === undefined
        ? {}
        : { preparationOutcome: evidence.preparationOutcome }),
      ...(evidence?.gate2Review === undefined ? {} : { gate2Review: evidence.gate2Review }),
      ...(evidence?.completion === undefined ? {} : { completion: evidence.completion }),
      ...(correctionSession === undefined ? {} : { correctionSession }),
      ...(evidence?.correctionCanPrepare === undefined
        ? {}
        : { correctionCanPrepare: evidence.correctionCanPrepare }),
      ...(evidence?.gate2CyclesObserved === undefined
        ? {}
        : { gate2CyclesObserved: evidence.gate2CyclesObserved }),
      ...(await this.toolLoopExplainProjection(run.runId)),
    });
  }

  private async toolLoopExplainProjection(runId: string): Promise<{
    readonly toolEvidence?: readonly BoundedToolEvidenceRecord[];
    readonly toolBudget?: AgentLoopBudgetSnapshot;
  }> {
    const loop = this.dependencies.loop;
    if (loop === undefined) {
      return {};
    }
    await loop.hydrate(runId);
    const evidence = loop.listEvidence(runId);
    const budget = loop.getBudget(runId);
    if (evidence.length === 0 && budget === undefined) {
      return {};
    }
    return {
      ...(evidence.length === 0 ? {} : { toolEvidence: evidence }),
      ...(budget === undefined ? {} : { toolBudget: budget }),
    };
  }

  private requireEphemeral(runId: string): AgentRunEphemeralEvidence {
    const evidence = this.ephemeral.get(runId);
    if (evidence === undefined) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'Gate 2 material is not available for this AgentRun (plan first).',
      );
    }
    return evidence;
  }

  private requireLoop() {
    const loop = this.dependencies.loop;
    if (loop === undefined) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'AgentLoop is not composed for this AgentOperatingService (B8 required).',
      );
    }
    return loop;
  }

  private assertRunProjectBinding(projectId: string): void {
    if (projectId !== this.dependencies.projectId) {
      throw new AgentRunError('NOT_FOUND', 'AgentRun not found.');
    }
  }

  private buildLoopContext(
    run: Awaited<ReturnType<AgentRunService['require']>>,
    securityEvidence: WorkspaceRequestSecurityEvidence | undefined,
    cancellation: ExecutionCancellationToken | undefined,
  ): AgentLoopExecuteContext {
    const projectRoot = this.dependencies.projectRoot;
    const security = this.dependencies.security;
    if (projectRoot === undefined || security === undefined) {
      throw new AgentRunError(
        'INVALID_REFERENCE',
        'AgentOperating projectRoot/security are required for tool turns.',
      );
    }
    const authContext = createWorkspaceAuthorizationContext({
      configuration: security,
      action: 'INVESTIGATE',
      evidence: {
        // Soft tools authorize via profile; never invent Gate2 / Git APPLY approval from tool turns.
        operatorApproved: false,
        browserObservationApproved: securityEvidence?.browserObservationApproved === true,
        ...(securityEvidence?.bearerToken === undefined
          ? {}
          : { bearerToken: securityEvidence.bearerToken }),
        ...(securityEvidence?.csrfToken === undefined
          ? {}
          : { csrfToken: securityEvidence.csrfToken }),
        // Never forward applyAuthorizationToken / forged Gate2 fields into the loop.
      },
    });
    return {
      runId: run.runId,
      projectId: run.projectId,
      phase: run.phase,
      projectRoot,
      principal: authContext.principal,
      securityProfile: security.profile,
      securityEvidence: authContext.evidence,
      cancellation: cancellation ?? { cancelled: false, subscribe: () => () => undefined },
      ...(run.references.preparationId === undefined
        ? {}
        : { preparationId: run.references.preparationId }),
      ...(run.references.workflowId === undefined ? {} : { workflowId: run.references.workflowId }),
      ...(run.references.investigationId === undefined
        ? {}
        : { investigationId: run.references.investigationId }),
      ...(run.references.correctionWorkflowId === undefined
        ? {}
        : { correctionWorkflowId: run.references.correctionWorkflowId }),
    };
  }
}

function isVerificationFailure(completion: WorkspaceCompletion): boolean {
  const status = completion.verificationReport?.status;
  return status === 'FAILED' || status === 'PARTIALLY_PASSED';
}

function toLegacyExplanation(
  explain: ExplainArtifact,
  run: Awaited<ReturnType<AgentRunService['require']>>,
): AgentRunExplanation {
  return {
    runId: explain.runId,
    projectId: explain.projectId,
    goal: explain.goal,
    phase: run.phase === 'COMPLETED' ? 'COMPLETED' : 'EXPLAINING',
    status: run.status === 'COMPLETED' ? 'COMPLETED' : 'RUNNING',
    references: run.references,
    ...(explain.plan.preparationOutcome === undefined
      ? {}
      : { preparationOutcome: explain.plan.preparationOutcome }),
    ...(explain.changes.applyStatus === undefined
      ? {}
      : { applyStatus: explain.changes.applyStatus }),
    ...(explain.verification.overallStatus === undefined
      ? {}
      : { verificationStatus: explain.verification.overallStatus }),
    ...(explain.corrections.state === undefined
      ? {}
      : { correctionState: explain.corrections.state }),
    summary: truncate(explain.summary, EXPLAIN_SUMMARY_MAX),
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
