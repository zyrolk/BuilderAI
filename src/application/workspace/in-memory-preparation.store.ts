import type { ProjectChangePlan } from '../../core/change-planner';
import type { WorkspaceCompletion, WorkspaceRuntimeClock } from './workspace-runtime.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

interface PreparationRecord {
  readonly id: string;
  readonly plan: ProjectChangePlan;
  readonly expiresAt: number;
  state: 'READY' | 'APPLYING' | 'COMPLETED';
  completion?: WorkspaceCompletion;
}

export class InMemoryPreparationStore {
  private readonly records = new Map<string, PreparationRecord>();

  constructor(
    private readonly clock: WorkspaceRuntimeClock,
    private readonly maximumRecords: number,
  ) {}

  save(id: string, plan: ProjectChangePlan, expiresAt: Date): void {
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
      expiresAt: expiresAt.getTime(),
      state: 'READY',
    });
  }

  claim(
    id: string,
  ):
    | { readonly kind: 'CLAIMED'; readonly plan: ProjectChangePlan }
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
    return { kind: 'CLAIMED', plan: structuredClone(record.plan) };
  }

  complete(id: string, completion: WorkspaceCompletion): void {
    const record = this.records.get(id);
    if (record === undefined || record.state !== 'APPLYING') {
      throw new WorkspaceRuntimeError('WORKFLOW_FAILED', 'Preparation state is inconsistent.');
    }
    record.state = 'COMPLETED';
    record.completion = structuredClone(completion);
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
