import type { ProjectChangePlan } from '../../../core/change-planner';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type { WorkspaceCompletion } from '../workspace-runtime.types';
import { CorrectionCancellationRegistry } from './correction-cancellation.registry';
import { classifyCorrectionFailure, completionToBeginInput } from './correction-failure-classifier';
import { buildCorrectionDiagnostic, digestChangePlan } from './correction-diagnostic.service';
import { detectCorrectionLoop, listChangedPaths } from './correction-loop-detection';
import {
  assertCorrectionTransition,
  isTerminalCorrectionState,
} from './correction-loop-transitions';
import {
  validateCorrectionChangePlanScope,
  type CorrectionScopeValidationInput,
} from './correction-scope-validator';
import {
  CORRECTION_LOOP_SCHEMA_VERSION,
  DEFAULT_CORRECTION_LOOP_CONFIGURATION,
  type CorrectionAttemptRecord,
  type CorrectionLoopBeginInput,
  type CorrectionLoopBeginResult,
  type CorrectionLoopConfiguration,
  type CorrectionLoopSession,
} from './correction-loop.types';
import { buildCorrectionRequest } from './correction-request-builder';

export class CorrectionLoopCancelledError extends Error {
  constructor(readonly workflowId: string) {
    super(`Correction workflow ${workflowId} was cancelled.`);
    this.name = 'CorrectionLoopCancelledError';
  }
}

export class CorrectionPersistenceError extends Error {
  constructor(
    readonly workflowId: string,
    cause: unknown,
  ) {
    super(
      `Failed to persist correction session ${workflowId}: ${
        cause instanceof Error ? cause.message : 'unknown error'
      }`,
    );
    this.name = 'CorrectionPersistenceError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export interface CorrectionLoopPersistencePort {
  save(session: CorrectionLoopSession): Promise<void>;
  load(workflowId: string): Promise<CorrectionLoopSession | undefined>;
  list?(): Promise<readonly CorrectionLoopSession[]>;
}

export class CorrectionLoopService {
  private readonly sessions = new Map<string, CorrectionLoopSession>();
  readonly cancellationRegistry = new CorrectionCancellationRegistry();
  private hydration: Promise<void> = Promise.resolve();
  private hydrated = false;

  constructor(
    private readonly configuration: CorrectionLoopConfiguration = DEFAULT_CORRECTION_LOOP_CONFIGURATION,
    private readonly now: () => Date = () => new Date(),
    private readonly persistence?: CorrectionLoopPersistencePort,
  ) {}

  /**
   * Await before serving correction routes. Hydration restores sessions for operator
   * inspection only — it never auto-approves or auto-applies.
   */
  async whenReady(): Promise<void> {
    if (this.hydrated) return;
    await this.hydration;
  }

  async hydratePersistedSessions(): Promise<void> {
    this.hydration = this.runHydration();
    await this.hydration;
  }

  private async runHydration(): Promise<void> {
    if (this.persistence?.list === undefined) {
      this.hydrated = true;
      return;
    }
    const sessions = await this.persistence.list();
    for (const session of sessions) {
      // Hydrate for inspection/resume gating only — never continue APPLY/APPROVE.
      this.sessions.set(session.workflowId, session);
    }
    this.hydrated = true;
  }

  async getSessionAsync(workflowId: string): Promise<CorrectionLoopSession | undefined> {
    await this.whenReady();
    let session = this.sessions.get(workflowId);
    if (session === undefined && this.persistence !== undefined) {
      const loaded = await this.persistence.load(workflowId);
      if (loaded !== undefined) {
        if (isTerminalCorrectionState(loaded.state)) {
          return structuredClone(loaded);
        }
        this.sessions.set(workflowId, loaded);
        session = loaded;
      }
    }
    if (session === undefined) return undefined;
    if (this.cancellationRegistry.isCancelled(workflowId)) {
      return structuredClone(this.cancelledSession(session));
    }
    if (this.isExpired(session)) {
      return this.commitSession(
        this.withState(session, 'CORRECTION_FAILED', {
          blockCode: 'CORRECTION_DEADLINE_EXCEEDED',
          blockMessage: 'Correction workflow deadline exceeded.',
        }),
      );
    }
    return structuredClone(session);
  }

  getSession(workflowId: string): CorrectionLoopSession | undefined {
    const session = this.sessions.get(workflowId);
    if (session === undefined) return undefined;
    if (this.cancellationRegistry.isCancelled(workflowId)) {
      return structuredClone(this.cancelledSession(session));
    }
    if (this.isExpired(session)) {
      const expired = this.withState(session, 'CORRECTION_FAILED', {
        blockCode: 'CORRECTION_DEADLINE_EXCEEDED',
        blockMessage: 'Correction workflow deadline exceeded.',
      });
      this.sessions.set(workflowId, expired);
      return structuredClone(expired);
    }
    return structuredClone(session);
  }

  registerCancellation(
    workflowId: string,
    token: ExecutionCancellationToken,
    cleanup?: () => void | Promise<void>,
  ): void {
    this.cancellationRegistry.register(workflowId, token, cleanup);
    if (this.cancellationRegistry.isCancelled(workflowId)) {
      void this.markCancelled(workflowId);
    }
  }

  async cancelCorrection(workflowId: string, reason?: string): Promise<CorrectionLoopSession> {
    await this.whenReady();
    await this.cancellationRegistry.cancel(workflowId, reason);
    return this.markCancelled(workflowId);
  }

  async beginCorrection(
    input: CorrectionLoopBeginInput & {
      readonly originalTaskSummary?: string;
      readonly sourcePreparationId?: string;
      readonly priorRequestSummary?: string;
      readonly investigationEvidencePaths?: readonly string[];
      readonly explicitlyAuthorizedPaths?: readonly string[];
    },
    options: { readonly cancellation?: ExecutionCancellationToken } = {},
  ): Promise<CorrectionLoopBeginResult> {
    await this.whenReady();
    await this.assertNotCancelled(input.workflowId);
    if (options.cancellation !== undefined) {
      this.registerCancellation(input.workflowId, options.cancellation);
    }

    const existing = this.sessions.get(input.workflowId);
    const attempt = (existing?.attemptHistory.length ?? 0) + 1;
    const maximumAttempts = Math.min(
      this.configuration.maximumCorrectionAttempts,
      this.configuration.hardMaximumCorrectionAttempts,
    );

    if (attempt > maximumAttempts) {
      const exhausted = await this.finalizeSession(
        input.workflowId,
        existing,
        'CORRECTION_EXHAUSTED',
        {
          blockCode: 'CORRECTION_ATTEMPTS_EXHAUSTED',
          blockMessage: 'Maximum correction attempts reached.',
        },
      );
      return {
        session: exhausted,
        correctionRequest: '',
        canPrepare: false,
      };
    }

    await this.assertNotCancelled(input.workflowId);

    const startedAt = this.now().toISOString();
    let session: CorrectionLoopSession = {
      schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
      workflowId: input.workflowId,
      state: 'CORRECTION_DIAGNOSING',
      attempt,
      maximumAttempts,
      startedAt,
      deadlineAt: new Date(
        this.now().getTime() + this.configuration.workflowDeadlineMs,
      ).toISOString(),
      ...(input.originalTaskSummary === undefined
        ? {}
        : { originalTaskSummary: input.originalTaskSummary }),
      ...(input.sourcePreparationId === undefined
        ? {}
        : { sourcePreparationId: input.sourcePreparationId }),
      ...(input.priorRequestSummary === undefined
        ? {}
        : { priorRequestSummary: input.priorRequestSummary }),
      attemptHistory: existing?.attemptHistory ?? [],
    };
    session = await this.commitSession(session);

    const classification = classifyCorrectionFailure(input);
    if (!classification.correctable) {
      session = await this.commitSession(
        this.withState(session, 'CORRECTION_BLOCKED', {
          blockCode: classification.category,
          blockMessage: classification.summary,
        }),
      );
      return { session, correctionRequest: '', canPrepare: false };
    }

    await this.assertNotCancelled(input.workflowId);

    const diagnostic = buildCorrectionDiagnostic({
      workflowId: input.workflowId,
      attempt,
      classification,
      beginInput: input,
    });

    if (!diagnostic.sufficientEvidence) {
      session = await this.commitSession(
        this.withState(session, 'CORRECTION_BLOCKED', {
          currentDiagnostic: diagnostic,
          blockCode: 'INSUFFICIENT_EVIDENCE',
          blockMessage: 'Not enough bounded evidence to attempt correction.',
        }),
      );
      return { session, correctionRequest: '', canPrepare: false };
    }

    const loopDetection = detectCorrectionLoop({
      diagnostic,
      attemptHistory: session.attemptHistory,
    });
    if (loopDetection.kind === 'LOOP_DETECTED' || loopDetection.kind === 'SAME_FAILURE_SAME_PLAN') {
      session = await this.commitSession(
        this.withState(session, 'CORRECTION_LOOP_DETECTED', {
          currentDiagnostic: diagnostic,
          blockCode: loopDetection.classification,
          blockMessage: loopDetection.reason,
        }),
      );
      return { session, correctionRequest: '', canPrepare: false };
    }

    const correctionRequest = buildCorrectionRequest({
      diagnostic,
      originalTaskSummary: input.originalTaskSummary,
      priorRequestSummary: input.priorRequestSummary,
      attempt,
      maximumAttempts: maximumAttempts,
    });

    session = await this.commitSession(
      this.withState(session, 'CORRECTION_PREPARING', {
        currentDiagnostic: diagnostic,
        correctionRequest,
      }),
    );
    return { session, correctionRequest, canPrepare: true };
  }

  async recordPrepared(
    workflowId: string,
    preparationId: string,
    changePlan: ProjectChangePlan,
    scopeInput: Omit<CorrectionScopeValidationInput, 'diagnostic' | 'changePlan'> = {},
  ): Promise<CorrectionLoopSession> {
    await this.whenReady();
    await this.assertNotCancelled(workflowId);
    const session = await this.requireActiveSession(workflowId);
    assertCorrectionTransition(session, 'CORRECTION_WAITING_FOR_APPROVAL');

    const scopeResult = validateCorrectionChangePlanScope({
      diagnostic: session.currentDiagnostic!,
      changePlan,
      ...scopeInput,
    });
    if (!scopeResult.ok) {
      return this.commitSession(
        this.withState(session, 'CORRECTION_BLOCKED', {
          preparationId,
          blockCode: scopeResult.code,
          blockMessage: scopeResult.message,
        }),
      );
    }

    const changePlanDigest = digestChangePlan(changePlan);
    const loopDetection = detectCorrectionLoop({
      diagnostic: session.currentDiagnostic!,
      changePlan,
      attemptHistory: session.attemptHistory,
    });
    if (loopDetection.kind === 'LOOP_DETECTED' || loopDetection.kind === 'SAME_FAILURE_SAME_PLAN') {
      return this.commitSession(
        this.withState(session, 'CORRECTION_LOOP_DETECTED', {
          preparationId,
          changePlanDigest,
          blockCode: loopDetection.classification,
          blockMessage: loopDetection.reason,
        }),
      );
    }
    return this.commitSession(
      this.withState(session, 'CORRECTION_WAITING_FOR_APPROVAL', {
        preparationId,
        changePlanDigest,
      }),
    );
  }

  async rejectCorrection(workflowId: string): Promise<CorrectionLoopSession> {
    return this.cancelCorrection(workflowId, 'operator rejected correction');
  }

  async recordApplying(workflowId: string): Promise<CorrectionLoopSession> {
    await this.whenReady();
    await this.assertNotCancelled(workflowId);
    const session = await this.requireActiveSession(workflowId);
    assertCorrectionTransition(session, 'CORRECTION_APPLYING');
    return this.commitSession(this.withState(session, 'CORRECTION_APPLYING'));
  }

  async recordVerificationComplete(
    workflowId: string,
    completion: WorkspaceCompletion,
  ): Promise<CorrectionLoopSession> {
    await this.whenReady();
    await this.assertNotCancelled(workflowId);
    const session = await this.requireActiveSession(workflowId);
    assertCorrectionTransition(session, 'CORRECTION_VERIFYING');
    let next = this.withState(session, 'CORRECTION_VERIFYING');

    const passed = verificationPassed(completion);
    const attemptRecord: CorrectionAttemptRecord = {
      attempt: session.attempt,
      failureCategory: session.currentDiagnostic?.failureCategory ?? 'UNKNOWN_VERIFICATION_FAILURE',
      diagnosticDigest: session.currentDiagnostic?.diagnosticDigest ?? 'unknown',
      ...(session.changePlanDigest === undefined
        ? {}
        : { changePlanDigest: session.changePlanDigest }),
      changedPaths: listChangedPathsFromSession(session),
      ...(session.preparationId === undefined ? {} : { preparationId: session.preparationId }),
      completedAt: this.now().toISOString(),
    };
    next = {
      ...next,
      attemptHistory: [...next.attemptHistory, attemptRecord],
    };

    if (completion.applyResult.status === 'PARTIALLY_APPLIED') {
      return this.commitSession(
        this.withState(next, 'CORRECTION_BLOCKED', {
          attemptHistory: next.attemptHistory,
          blockCode: 'RECOVERY_REQUIRED',
          blockMessage: 'Partial apply stopped the correction loop.',
        }),
      );
    }

    if (passed) {
      const committed = await this.commitSession(
        this.withState(next, 'CORRECTION_PASSED', { attemptHistory: next.attemptHistory }),
      );
      this.cancellationRegistry.clear(workflowId);
      return committed;
    }

    if (next.attempt >= next.maximumAttempts) {
      return this.commitSession(
        this.withState(next, 'CORRECTION_EXHAUSTED', {
          attemptHistory: next.attemptHistory,
          blockCode: 'CORRECTION_ATTEMPTS_EXHAUSTED',
          blockMessage: 'Correction attempts exhausted after verification failure.',
        }),
      );
    }

    return this.commitSession(
      this.withState(next, 'CORRECTION_FAILED', { attemptHistory: next.attemptHistory }),
    );
  }

  async beginFromCompletion(
    workflowId: string,
    completion: WorkspaceCompletion,
    metadata: {
      readonly originalTaskSummary?: string;
      readonly sourcePreparationId?: string;
      readonly priorRequestSummary?: string;
      readonly investigationEvidencePaths?: readonly string[];
      readonly explicitlyAuthorizedPaths?: readonly string[];
    } = {},
    options: { readonly cancellation?: ExecutionCancellationToken } = {},
  ): Promise<CorrectionLoopBeginResult> {
    return this.beginCorrection(
      {
        ...completionToBeginInput(completion, workflowId),
        ...metadata,
      },
      options,
    );
  }

  private async markCancelled(workflowId: string): Promise<CorrectionLoopSession> {
    const session = this.sessions.get(workflowId);
    if (session === undefined) {
      const cancelled: CorrectionLoopSession = {
        schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
        workflowId,
        state: 'CORRECTION_CANCELLED',
        attempt: 0,
        maximumAttempts: Math.min(
          this.configuration.maximumCorrectionAttempts,
          this.configuration.hardMaximumCorrectionAttempts,
        ),
        startedAt: this.now().toISOString(),
        deadlineAt: new Date(
          this.now().getTime() + this.configuration.workflowDeadlineMs,
        ).toISOString(),
        attemptHistory: [],
        blockCode: 'CANCELLATION',
        blockMessage: 'Correction was cancelled.',
      };
      return this.commitSession(cancelled);
    }
    if (session.state === 'CORRECTION_CANCELLED') {
      return structuredClone(session);
    }
    try {
      assertCorrectionTransition(session, 'CORRECTION_CANCELLED');
    } catch {
      // Force cancellation cleanup even from unexpected states.
    }
    return this.commitSession(
      this.withState(session, 'CORRECTION_CANCELLED', {
        blockCode: 'CANCELLATION',
        blockMessage:
          this.cancellationRegistry.cancellationReason(workflowId) ?? 'Correction was cancelled.',
      }),
    );
  }

  private cancelledSession(session: CorrectionLoopSession): CorrectionLoopSession {
    if (session.state === 'CORRECTION_CANCELLED') return session;
    return {
      ...session,
      state: 'CORRECTION_CANCELLED',
      blockCode: 'CANCELLATION',
      blockMessage:
        this.cancellationRegistry.cancellationReason(session.workflowId) ??
        'Correction was cancelled.',
    };
  }

  private async assertNotCancelled(workflowId: string): Promise<void> {
    if (this.cancellationRegistry.isCancelled(workflowId)) {
      await this.markCancelled(workflowId);
      throw new CorrectionLoopCancelledError(workflowId);
    }
  }

  private async requireSession(workflowId: string): Promise<CorrectionLoopSession> {
    const session = await this.getSessionAsync(workflowId);
    if (session === undefined) {
      throw new Error('Correction session was not found.');
    }
    return session;
  }

  private async requireActiveSession(workflowId: string): Promise<CorrectionLoopSession> {
    const session = await this.requireSession(workflowId);
    if (isTerminalCorrectionState(session.state)) {
      throw new Error(`Correction session is terminal (${session.state}).`);
    }
    return session;
  }

  private isExpired(session: CorrectionLoopSession): boolean {
    return this.now().getTime() >= Date.parse(session.deadlineAt);
  }

  private async finalizeSession(
    workflowId: string,
    existing: CorrectionLoopSession | undefined,
    state: CorrectionLoopSession['state'],
    extras: Partial<CorrectionLoopSession> = {},
  ): Promise<CorrectionLoopSession> {
    const session: CorrectionLoopSession = {
      schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
      workflowId,
      state,
      attempt: existing?.attempt ?? 0,
      maximumAttempts: Math.min(
        this.configuration.maximumCorrectionAttempts,
        this.configuration.hardMaximumCorrectionAttempts,
      ),
      startedAt: existing?.startedAt ?? this.now().toISOString(),
      deadlineAt:
        existing?.deadlineAt ??
        new Date(this.now().getTime() + this.configuration.workflowDeadlineMs).toISOString(),
      attemptHistory: existing?.attemptHistory ?? [],
      ...extras,
    };
    return this.commitSession(session);
  }

  private withState(
    session: CorrectionLoopSession,
    state: CorrectionLoopSession['state'],
    extras: Partial<CorrectionLoopSession> = {},
  ): CorrectionLoopSession {
    if (session.state !== state) {
      assertCorrectionTransition(session, state);
    }
    return { ...session, state, ...extras };
  }

  private async commitSession(session: CorrectionLoopSession): Promise<CorrectionLoopSession> {
    const snapshot = structuredClone(session);
    this.sessions.set(session.workflowId, snapshot);
    if (this.persistence !== undefined) {
      try {
        await this.persistence.save(structuredClone(snapshot));
      } catch (error: unknown) {
        throw new CorrectionPersistenceError(session.workflowId, error);
      }
    }
    return structuredClone(snapshot);
  }
}

function verificationPassed(completion: WorkspaceCompletion): boolean {
  const verificationOk =
    completion.verificationReport === undefined ||
    completion.verificationReport.status === 'PASSED';
  const runtimeOk =
    completion.runtimeBrowserVerificationReport === undefined ||
    completion.runtimeBrowserVerificationReport.status === 'PASSED';
  return completion.applyResult.status === 'APPLIED' && verificationOk && runtimeOk;
}

function listChangedPathsFromSession(session: CorrectionLoopSession): readonly string[] {
  return session.currentDiagnostic?.affectedFiles.slice(0, 8) ?? [];
}

export { listChangedPaths };
