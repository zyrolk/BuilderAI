import type { ProjectChangePlan } from '../../core/change-planner';
import type { Gate2ReviewProjection } from './gate2-review';
import type {
  FeatureTaskPreparationBinding,
  WorkspaceCompletion,
  WorkspaceRuntimeClock,
} from './workspace-runtime.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

/**
 * Maximum number of total Apply attempts permitted for one preparationId (P1-6 / ADR-020): the
 * original attempt plus at most one explicit, caller-driven retry. Reclaim is granted only when the
 * previous attempt's `FileApplyResult` proves zero filesystem mutations occurred; every other outcome
 * (`PARTIALLY_APPLIED`, `APPLIED`, or a zero-mutation failure that has already used both attempts)
 * remains permanently terminal.
 */
export const MAXIMUM_APPLY_ATTEMPTS = 2;

interface PreparationRecord {
  readonly id: string;
  readonly plan: ProjectChangePlan;
  readonly gate2Review: Gate2ReviewProjection;
  readonly expiresAt: number;
  readonly featureTaskBinding?: FeatureTaskPreparationBinding;
  readonly applyAuthorizationToken?: string;
  state: 'READY' | 'APPLYING' | 'RECLAIMABLE' | 'COMPLETED';
  attempts: number;
  completion?: WorkspaceCompletion;
}

export class InMemoryPreparationStore {
  private readonly records = new Map<string, PreparationRecord>();

  constructor(
    private readonly clock: WorkspaceRuntimeClock,
    private readonly maximumRecords: number,
  ) {}

  save(
    id: string,
    plan: ProjectChangePlan,
    gate2Review: Gate2ReviewProjection,
    expiresAt: Date,
    featureTaskBinding?: FeatureTaskPreparationBinding,
    applyAuthorizationToken?: string,
  ): void {
    this.removeExpired();
    while (this.records.size >= this.maximumRecords) {
      const oldest = [...this.records.values()].find(({ state }) => state !== 'APPLYING')?.id;
      if (oldest === undefined) {
        throw new WorkspaceRuntimeError(
          'WORKFLOW_FAILED',
          'Preparation capacity is temporarily unavailable.',
        );
      }
      this.records.delete(oldest);
    }
    this.records.set(id, {
      id,
      plan: structuredClone(plan),
      gate2Review: structuredClone(gate2Review),
      expiresAt: expiresAt.getTime(),
      ...(featureTaskBinding === undefined ? {} : { featureTaskBinding }),
      ...(applyAuthorizationToken === undefined ? {} : { applyAuthorizationToken }),
      state: 'READY',
      attempts: 0,
    });
  }

  readApplyAuthorizationToken(id: string): string | undefined {
    return this.records.get(id)?.applyAuthorizationToken;
  }

  /**
   * `READY` and `RECLAIMABLE` records are claimed identically; the original `expiresAt` set once by
   * `save()` is never reset or extended by a reclaim, so the bounded retry window can never outlive the
   * preparation's original TTL.
   */
  claim(id: string):
    | {
        readonly kind: 'CLAIMED';
        readonly plan: ProjectChangePlan;
        readonly attempt: number;
        readonly featureTaskBinding?: FeatureTaskPreparationBinding;
      }
    | { readonly kind: 'COMPLETED'; readonly completion: WorkspaceCompletion } {
    const record = this.records.get(id);
    if (record === undefined) {
      throw new WorkspaceRuntimeError('PREPARATION_NOT_FOUND', 'Preparation was not found.');
    }
    if (record.state === 'APPLYING') {
      throw new WorkspaceRuntimeError('WORKFLOW_FAILED', 'Preparation is already being applied.');
    }
    if (record.expiresAt <= this.clock.now().getTime()) {
      this.records.delete(id);
      throw new WorkspaceRuntimeError('PREPARATION_EXPIRED', 'Preparation has expired.');
    }
    if (record.state === 'COMPLETED' && record.completion !== undefined) {
      return { kind: 'COMPLETED', completion: structuredClone(record.completion) };
    }
    record.state = 'APPLYING';
    record.attempts += 1;
    return {
      kind: 'CLAIMED',
      plan: structuredClone(record.plan),
      attempt: record.attempts,
      ...(record.featureTaskBinding === undefined
        ? {}
        : { featureTaskBinding: structuredClone(record.featureTaskBinding) }),
    };
  }

  /** Permanently terminal: the record becomes replay-only for the rest of its lifetime. */
  complete(id: string, completion: WorkspaceCompletion): void {
    const record = this.records.get(id);
    if (record === undefined || record.state !== 'APPLYING') {
      throw new WorkspaceRuntimeError('WORKFLOW_FAILED', 'Preparation state is inconsistent.');
    }
    record.state = 'COMPLETED';
    record.completion = structuredClone(completion);
  }

  /**
   * Releases a record that was claimed and whose Apply attempt provably produced zero filesystem
   * mutations back to a reclaimable state, so a subsequent explicit `claim()` triggers a genuine new
   * `FileApplyEngineService.apply()` call (fresh preflight included). Callers must only invoke this when
   * `attempt < MAXIMUM_APPLY_ATTEMPTS`; the store does not itself decide retry eligibility from the
   * `FileApplyResult`, it only enforces the state transition and the attempt bound already recorded by
   * `claim()`.
   */
  releaseForRetry(id: string): void {
    const record = this.records.get(id);
    if (record === undefined || record.state !== 'APPLYING') {
      throw new WorkspaceRuntimeError('WORKFLOW_FAILED', 'Preparation state is inconsistent.');
    }
    record.state = 'RECLAIMABLE';
  }

  readForApprovalValidation(id: string):
    | {
        readonly plan: ProjectChangePlan;
        readonly gate2Review: Gate2ReviewProjection;
        readonly expiresAt: number;
      }
    | undefined {
    const record = this.records.get(id);
    if (record === undefined) return undefined;
    if (record.state === 'APPLYING' || record.state === 'COMPLETED') return undefined;
    if (record.expiresAt <= this.clock.now().getTime()) {
      this.records.delete(id);
      return undefined;
    }
    return {
      plan: structuredClone(record.plan),
      gate2Review: structuredClone(record.gate2Review),
      expiresAt: record.expiresAt,
    };
  }

  fail(id: string): void {
    this.records.delete(id);
  }

  private removeExpired(): void {
    const now = this.clock.now().getTime();
    for (const [id, record] of this.records) {
      if (record.state !== 'APPLYING' && record.expiresAt <= now) this.records.delete(id);
    }
  }
}
